// SPDX-License-Identifier: MIT
/**
 * Contract-first runtime pipeline.
 *
 * Composes the semantic runtime:
 *   TASK → BASELINE → RESEARCH → PLAN → PLAN_GATE → BUILD → VERIFY →
 *   REVIEWS → CONTROLLER → DONE | FIX | SPLIT | BLOCKED
 *
 * One run_id is created in the task contract and preserved everywhere. The
 * pipeline is deterministic and LLM-free: workers only provide validated
 * contracts, the controller decides.
 *
 * Structural invariants enforced here:
 *   - a failed BASELINE exits before RESEARCH (fail fast, no wasted work)
 *   - BUILD runs only after PLAN_GATE approved (plan cannot bypass the gate)
 *   - VERIFY is mandatory between BUILD and REVIEWS (build cannot bypass verify)
 *   - run_id is immutable: any worker-supplied run_id that differs from the
 *     task run_id aborts the run with CONTRACT_INVALID
 */
import { create as createTask } from '../contracts/task.mjs'
import { createBuildInput } from '../contracts/build.mjs'
import { create as createVerification } from '../contracts/verification.mjs'
import { runBaseline } from '../baseline/capability-preflight.mjs'
import { fromNativePlan, runNativeBuild, parsePlanText } from '../adapters/native-opencode.mjs'
import { evaluatePlanGate } from '../controller/plan-gate.mjs'
import { runVerification } from '../controller/verify.mjs'
import { decide } from '../controller/controller.mjs'
import { create as createDecisionContract } from '../contracts/decision.mjs'
import { firstBadBoundary } from '../controller/first-bad-boundary.mjs'
import { runResearch } from './research.mjs'
import { defaultReviewAnalyzers } from '../reviews/analyze.mjs'
import { createRunEvent, inputFingerprint, outputFingerprint, appendRunEvent } from '../observability/run-events.mjs'
import {
  classifyWorkerOutcome,
  escalationEvent,
  providerFallbackEvent,
  workerStartEvent,
  workerResultEvent,
  workerFailureEvent,
  enforceRouteRunId,
  parseUsage,
  aggregateUsage,
  usageEvent,
  costGateAllows,
  getCatalogEntry,
  DEFAULT_MODEL_CATALOG,
} from '../routing/index.mjs'

/**
 * run_id immutability guard. Every phase contract must keep the task run_id.
 * A worker that replaces the run_id triggers a deterministic abort.
 */
export function enforceRunId(runId, value, label) {
  if (value && typeof value === 'object' && value.run_id !== undefined && value.run_id !== null && value.run_id !== runId) {
    throw new Error(`CONTRACT_INVALID:${label}:run_id ${value.run_id} does not match task run_id ${runId}`)
  }
  return value
}

function collapseBoundaries(boundaries = []) {
  const byName = new Map()
  for (const boundary of boundaries) {
    if (boundary && boundary.name) byName.set(boundary.name, { name: boundary.name, status: boundary.status })
  }
  const order = ['TASK', 'BASELINE', 'ROUTING', 'RESEARCH', 'PLAN', 'PLAN_GATE', 'BUILD', 'VERIFY', 'REVIEWS', 'CONTROLLER']
  return order.filter((name) => byName.has(name)).map((name) => byName.get(name))
}

export async function runPipeline({
  taskInput = {},
  repoRoot = null,
  env = process.env,
  inventory = {},
  mcpProfile = null,
  nativePlan = {},
  buildExecutor,
  verifyChecks = [],
  reviewAnalyzers = defaultReviewAnalyzers,
  eventSink = null,
  max_attempts = 2,
  capability_status = {},
  required_skills = [],
  previousFailures = [],
  tool_grant = null,
  route = null,
  routing = null,
  cost_policy = null,
  routeExecutor = null,
  onWorkerFailure = null,
} = {}) {
  const task = taskInput.contract === 'ecosystem.task.v1'
    ? taskInput
    : createTask({ ...taskInput, max_attempts })
  const runId = task.run_id

  const events = []
  const boundaries = []
  const emit = async ({ phase, job, status, attempt = task.attempt, duration_ms = 0, ...extra }) => {
    const event = createRunEvent({ run_id: runId, phase, job, attempt, status, duration_ms, ...extra })
    events.push(event)
    if (eventSink) await appendRunEvent(eventSink, event)
  }
  const record = (name, status) => boundaries.push({ name, status })

  await emit({ phase: 'TASK', job: 'create-task', status: 'PASS', contract_in: task.contract })
  record('TASK', 'PASS')

  const planData = nativePlan?.plan || (nativePlan?.planText ? parsePlanText(nativePlan.planText) : null)
  const baseline = runBaseline({
    task,
    plan: planData,
    repoRoot,
    root: repoRoot,
    env,
    inventory,
    mcpProfile,
    required_skills,
    capability_status,
  })
  await emit({
    phase: 'BASELINE', job: 'capability-preflight', status: baseline.approved ? 'PASS' : 'FAIL',
    input_fingerprint: inputFingerprint({ required_capabilities: baseline.required_capabilities }),
    output_fingerprint: outputFingerprint({ approved: baseline.approved, errors: baseline.errors }),
    contract_out: baseline.contract,
  })
  record('BASELINE', baseline.approved ? 'PASS' : 'FAIL')

  // Fail fast: a missing required capability (or required MCP / skill) blocks
  // before any research, plan, or build work is performed.
  if (!baseline.approved) {
    const decision = decide({
      baseline,
      planGate: { approved: false, errors: ['BASELINE_FAILED'] },
      verification: null,
      reviews: [],
      attempt: task.attempt,
      max_attempts: task.max_attempts,
      boundaries,
    })
    return finishRun({
      runId, task, baseline, research: null, plan: null, planGate: { approved: false, errors: ['BASELINE_FAILED'] },
      buildResult: null, verification: null, reviews: [], attempt: task.attempt, max_attempts: task.max_attempts,
      failedAttempts: [...previousFailures], boundaries, events, eventSink, emit, record, decision,
    })
  }

  // Routing is runtime authority: when this run is routed, the ROUTING
  // boundary is recorded after BASELINE (requirements known) and before any
  // worker work. The route itself was resolved by runTask via the
  // deterministic routing policy.
  if (route) {
    record('ROUTING', 'PASS')
    await emit({
      phase: 'ROUTING', job: 'model.route.selected', status: 'PASS', attempt: task.attempt,
      provider: route.provider, model: route.model, strategy_delta: route.routing_reason,
      contract_out: 'routing.route.v1',
    })
  }

  const research = await runResearch({ run_id: runId, repoRoot })
  enforceRunId(runId, research, 'research')
  await emit({ phase: 'RESEARCH', job: 'research', status: 'PASS', contract_out: research.contract })
  record('RESEARCH', 'PASS')

  const plan = fromNativePlan({ run_id: runId, planText: nativePlan.planText || null, planData: nativePlan.plan || null })
  enforceRunId(runId, plan, 'plan')
  await emit({ phase: 'PLAN', job: 'native-plan', status: 'PASS', contract_out: plan.contract })
  record('PLAN', 'PASS')

  const planGate = evaluatePlanGate(plan)
  await emit({
    phase: 'PLAN_GATE', job: 'plan-gate', status: planGate.approved ? 'PASS' : 'FAIL',
    contract_in: plan.contract, contract_out: 'ecosystem.decision.v1',
  })
  record('PLAN_GATE', planGate.approved ? 'PASS' : 'FAIL')

  // A build is only allowed after the deterministic plan gate approved. No
  // alternative planner can authorize a build without passing this gate.
  if (!planGate.approved) {
    const decision = decide({
      baseline, plan, planGate, verification: null, reviews: [],
      attempt: task.attempt, max_attempts: task.max_attempts, boundaries,
    })
    return finishRun({
      runId, task, baseline, research, plan, planGate,
      buildResult: null, verification: null, reviews: [], attempt: task.attempt, max_attempts: task.max_attempts,
      failedAttempts: [...previousFailures], boundaries, events, eventSink, emit, record, decision,
    })
  }

  let attempt = 0
  let buildResult = null
  let verification = null
  const failedAttempts = [...previousFailures]
  // Route state: the assigned provider/model stays with the run. Model
  // escalation / provider fallback are distinct, bounded transitions that
  // change the route but NEVER the run_id.
  let routeState = route ? { ...route } : null
  let escalationCount = 0
  let fallbackCount = 0
  const routeHistory = route ? [{ provider: route.provider, model: route.model }] : []
  // Availability & cost governance (additive): usage observability and the
  // high-cost route budget for the routed build loop.
  const usageRecords = []
  const usedHighCostRoutes = new Set()
  let highCostRoutesUsed = 0

  while (true) {
    const buildInput = createBuildInput({
      run_id: runId,
      attempt,
      approved_plan: plan,
      approved_build_scope: plan.plan.build_scope,
      research,
      task,
    })
    const buildStart = Date.now()
    const activeExecutor = routeState && routeExecutor
      ? routeExecutor(routeState, { attempt })
      : buildExecutor
    const execute = activeExecutor ? (input) => activeExecutor(input, { tool_grant }) : null
    if (routeState) {
      await emit({ ...workerStartEvent({ run_id: runId, route: routeState, attempt }) })
    }
    const nativeBuild = await runNativeBuild({ buildInput, execute })
    // A worker cannot replace the run_id of this run.
    if (nativeBuild.outcome?.run_id && nativeBuild.outcome.run_id !== runId) {
      throw new Error(`CONTRACT_INVALID:build_worker:run_id ${nativeBuild.outcome.run_id} does not match task run_id ${runId}`)
    }
    buildResult = nativeBuild.build_result
    enforceRunId(runId, buildResult, 'build-result')
    const rawOutcome = nativeBuild.outcome || null
    const buildOk = buildResult.status === 'SUCCESS'
    if (routeState && rawOutcome?.failure_class) {
      await emit({ ...workerFailureEvent({ run_id: runId, route: routeState, failure_class: rawOutcome.failure_class, reason: rawOutcome.failure_reason || null, attempt }) })
    } else if (routeState) {
      await emit({ ...workerResultEvent({ run_id: runId, route: routeState, status: buildOk ? 'SUCCESS' : 'FAILURE', attempt }) })
    }
    if (routeState) {
      // Cost governance: track distinct high-cost routes used (bounded by
      // cost_policy.max_high_cost_routes via decideRouteAction).
      if (routeState.cost_tier === 'HIGH') usedHighCostRoutes.add(`${routeState.provider}/${routeState.model}`)
      highCostRoutesUsed = usedHighCostRoutes.size
      // Usage observability: parse worker usage; missing usage is recorded as
      // UNAVAILABLE, never zeroed (§38).
      const parsed = parseUsage(rawOutcome?.usage, {
        run_id: runId, phase: 'BUILD', attempt,
        route_index: routeState.route_index || 0,
        provider: routeState.provider, model: routeState.model,
      })
      if (parsed.ok) usageRecords.push(parsed.usage)
      await emit({
        ...usageEvent({
          run_id: runId,
          usage: parsed.ok ? parsed.usage : { usage_status: 'UNAVAILABLE', run_id: runId, attempt, provider: routeState.provider, model: routeState.model },
          phase: 'BUILD',
          attempt,
        }),
      })
    }
    await emit({
      phase: 'BUILD', job: 'native-build', status: buildOk ? 'PASS' : 'FAIL', attempt,
      provider: routeState?.provider || null, model: routeState?.model || null,
      input_fingerprint: inputFingerprint({ targets: plan.plan.targets, build_scope: plan.plan.build_scope }),
      output_fingerprint: outputFingerprint({ changed_files: buildResult.changed_files, errors: buildResult.errors }),
      duration_ms: Date.now() - buildStart,
      contract_out: buildResult.contract,
    })
    record('BUILD', buildOk ? 'PASS' : 'FAIL')

    if (buildOk) {
      verification = runVerification({ run_id: runId, checks: verifyChecks, strategy_delta: null })
    } else {
      verification = createVerification({
        run_id: runId,
        verification: {
          passed: false,
          failure_signature: `BUILD_FAILURE:${(buildResult.errors || []).join('_').slice(0, 96) || 'build'}`,
          strategy_delta: rawOutcome?.strategy_delta || null,
          checks: [{ command: 'native-build', passed: false, error: (buildResult.errors || []).join('; ') }],
        },
      })
    }
    if (verification.verification.passed === false && !verification.verification.strategy_delta && rawOutcome?.strategy_delta) {
      verification.verification.strategy_delta = rawOutcome.strategy_delta
    }
    enforceRunId(runId, verification, 'verification')
    await emit({
      phase: 'VERIFY', job: 'verify', status: verification.verification.passed ? 'PASS' : 'FAIL', attempt,
      failure_signature: verification.verification.failure_signature || null,
      strategy_delta: verification.verification.strategy_delta || null,
      contract_in: buildResult.contract, contract_out: verification.contract,
    })
    record('VERIFY', verification.verification.passed ? 'PASS' : 'FAIL')

    const intermediate = decide({
      baseline, plan, planGate, verification, reviews: [], attempt,
      max_attempts: task.max_attempts, previous_failures: failedAttempts,
      boundaries, build_status: buildOk ? 'PASS' : 'FAIL',
    })

    if (intermediate.decision === 'RETRY') {
      // Strict same-route retry: the model and provider do not change; a
      // meaningful strategy delta is required by the retry policy. This is
      // RETRY, never escalation.
      failedAttempts.push({
        failure_signature: verification.verification.failure_signature,
        strategy_delta: verification.verification.strategy_delta || null,
      })
      attempt += 1
      continue
    }

    // ROUTED escalation seam: after the canonical retry policy denies a
    // same-route retry, a classified failure may transition the ROUTE via the
    // deterministic routing policy (model escalation / provider fallback).
    // Both are bounded; the run_id never changes; terminal values stay with
    // the controller.
    if (routeState && onWorkerFailure && verification.verification.passed !== true) {
      const failureClass = rawOutcome?.failure_class
        || classifyWorkerOutcome({ status: buildOk ? 'SUCCESS' : 'FAILURE', error: (buildResult.errors || [])[0] })
      const transition = await onWorkerFailure({
        failure_class: failureClass,
        route: routeState,
        attempt,
        escalation_count: escalationCount,
        provider_fallback_count: fallbackCount,
        route_history: routeHistory,
        verification,
        build_result: buildResult,
        cost_policy,
        high_cost_routes_used: highCostRoutesUsed,
      })
      if (transition && transition.next_route && transition.next_route.provider && transition.next_route.model) {
        // Defensive cost gate (fail closed): when a cost_policy is active, a
        // transition target denied by the gate must not be applied. The
        // canonical decideRouteAction already gates targets; this is a
        // belt-and-suspenders check for custom seams. No-op without
        // cost_policy (backward compat).
        if (cost_policy) {
          const nextEntry = getCatalogEntry(DEFAULT_MODEL_CATALOG, transition.next_route.provider, transition.next_route.model)
          const nextCostTier = nextEntry ? nextEntry.cost_tier : (routeState.cost_tier || null)
          if (!costGateAllows({ entry: { cost_tier: nextCostTier }, current_tier: routeState.cost_tier || null, cost_policy, high_cost_routes_used })) {
            const routingTerminal = decide({
              baseline, plan, planGate, verification, reviews: [], attempt,
              max_attempts: task.max_attempts, previous_failures: failedAttempts,
              boundaries, build_status: buildOk ? 'PASS' : 'FAIL',
              routing_terminal: { reason_code: 'COST_GATE_DENIED', boundary: 'ROUTING' },
            })
            return finishRun({
              runId, task, baseline, research, plan, planGate, buildResult, verification,
              reviews: [], attempt, max_attempts: task.max_attempts, failedAttempts, boundaries, events, eventSink, emit, record,
              decision: routingTerminal,
              route: routeState,
              usage_records: usageRecords,
            })
          }
        }
        const isFallback = transition.next_route.provider !== routeState.provider
        if (isFallback) fallbackCount += 1
        else escalationCount += 1
        routeHistory.push({ provider: transition.next_route.provider, model: transition.next_route.model })
        routeState = {
          ...routeState,
          provider: transition.next_route.provider,
          model: transition.next_route.model,
          routing_reason: transition.routing_reason || (isFallback ? 'PROVIDER_FALLBACK' : 'ESCALATION'),
          route_index: (routeState.route_index || 0) + 1,
        }
        failedAttempts.push({
          failure_signature: verification.verification.failure_signature || `ROUTE_TRANSITION:${failureClass}`,
          strategy_delta: verification.verification.strategy_delta || transition.routing_reason || null,
        })
        await emit(isFallback
          ? { ...providerFallbackEvent({ run_id: runId, from: routeState, to: transition.next_route, failure_class: failureClass, routing_reason: transition.routing_reason, attempt, transition_reason: transition.transition_reason || null }) }
          : { ...escalationEvent({ run_id: runId, from: routeState, to: transition.next_route, failure_class: failureClass, routing_reason: transition.routing_reason, attempt, transition_reason: transition.transition_reason || null }) })
        attempt += 1
        continue
      }
      if (transition && transition.action === 'TERMINAL') {
        // The routing policy supplies the classified reason; the controller
        // supplies the terminal decision value (BLOCKED/SPLIT).
        const routingTerminal = decide({
          baseline, plan, planGate, verification, reviews: [], attempt,
          max_attempts: task.max_attempts, previous_failures: failedAttempts,
          boundaries, build_status: buildOk ? 'PASS' : 'FAIL',
          routing_terminal: { reason_code: transition.reason_code || transition.reason || 'ROUTING_TERMINAL', boundary: 'ROUTING' },
        })
        return finishRun({
          runId, task, baseline, research, plan, planGate, buildResult, verification,
          reviews: [], attempt, max_attempts: task.max_attempts, failedAttempts, boundaries, events, eventSink, emit, record,
          decision: routingTerminal,
          route: routeState,
          usage_records: usageRecords,
        })
      }
    }

    if (verification.verification.passed) break
    return finishRun({
      runId, task, baseline, research, plan, planGate, buildResult, verification,
      reviews: [], attempt, max_attempts: task.max_attempts, failedAttempts, boundaries, events, eventSink, emit, record,
      decision: intermediate,
      route: routeState,
      usage_records: usageRecords,
    })
  }

  // Verify passed → run independent reviews, then let the controller decide.
  const reviews = []
  let reviewsAllPass = true
  for (const [type, analyzer] of reviewAnalyzers) {
    const review = analyzer({ run_id: runId, buildResult, verification, repoRoot, changedFiles: buildResult?.changed_files })
    enforceRunId(runId, review, `review:${type}`)
    reviews.push(review)
    await emit({
      phase: 'REVIEWS', job: `${type}-review`, status: review.review.status === 'PASS' ? 'PASS' : 'FAIL', attempt,
      contract_out: review.contract,
    })
    if (review.review.status !== 'PASS') reviewsAllPass = false
  }
  record('REVIEWS', reviewsAllPass ? 'PASS' : 'FAIL')

  const decision = decide({
    baseline, plan, planGate, verification, reviews, attempt,
    max_attempts: task.max_attempts, previous_failures: failedAttempts, boundaries, build_status: 'PASS',
  })

  return finishRun({
    runId, task, baseline, research, plan, planGate, buildResult, verification,
    reviews, attempt, max_attempts: task.max_attempts, failedAttempts, boundaries, events, eventSink, emit, record,
    decision, route: routeState,
    usage_records: usageRecords,
  })
}

async function finishRun({
  runId, task, baseline, research, plan, planGate, buildResult, verification,
  reviews, attempt, max_attempts, failedAttempts, boundaries, events, eventSink, emit, record, decision,
  route = null,
  usage_records = [],
}) {
  enforceRunId(runId, decision, 'controller-decision')
  await emit({
    phase: 'CONTROLLER', job: 'deterministic-controller',
    status: decision.decision === 'DONE' ? 'PASS' : 'FAIL', attempt,
    contract_out: 'ecosystem.decision.v1',
    reason_code: decision.reason_code,
  })
  record('CONTROLLER', decision.decision === 'DONE' ? 'PASS' : 'FAIL')

  const phaseHistory = collapseBoundaries(boundaries)
  const firstBad = firstBadBoundary(phaseHistory)
  // The terminal decision is emitted as a validated ecosystem.decision.v1
  // contract: the controller is the sole terminal authority.
  const finalDecision = createDecisionContract({
    run_id: runId,
    decision: decision.decision,
    reason_code: decision.reason_code,
    first_bad_boundary: firstBad,
    phase_history: phaseHistory.map((boundary) => ({ ...boundary })),
  })

  return {
    run_id: runId,
    task,
    baseline,
    research,
    plan,
    plan_gate: planGate,
    route,
    build_result: buildResult,
    verification,
    reviews,
    decision: finalDecision,
    events,
    boundaries,
    // Availability & cost governance (additive): usage evidence for cost
    // governance — never a completion authority.
    usage: aggregateUsage(usage_records),
    usage_records: usage_records,
  }
}
