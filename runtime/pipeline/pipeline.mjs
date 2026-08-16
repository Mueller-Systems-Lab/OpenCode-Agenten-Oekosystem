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
 */
import { create as createTask } from '../contracts/task.mjs'
import { createBuildInput } from '../contracts/build.mjs'
import { create as createVerification } from '../contracts/verification.mjs'
import { runBaseline } from '../baseline/capability-preflight.mjs'
import { fromNativePlan, runNativeBuild } from '../adapters/native-opencode.mjs'
import { evaluatePlanGate } from '../controller/plan-gate.mjs'
import { runVerification } from '../controller/verify.mjs'
import { decide } from '../controller/controller.mjs'
import { firstBadBoundary } from '../controller/first-bad-boundary.mjs'
import { runResearch } from './research.mjs'
import { defaultReviewAnalyzers } from '../reviews/analyze.mjs'
import { createRunEvent, inputFingerprint, outputFingerprint, appendRunEvent } from '../observability/run-events.mjs'

function collapseBoundaries(boundaries = []) {
  const byName = new Map()
  for (const boundary of boundaries) {
    if (boundary && boundary.name) byName.set(boundary.name, { name: boundary.name, status: boundary.status })
  }
  const order = ['TASK', 'BASELINE', 'RESEARCH', 'PLAN', 'PLAN_GATE', 'BUILD', 'VERIFY', 'REVIEWS', 'CONTROLLER']
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

  const baseline = runBaseline({
    task,
    plan: nativePlan?.plan || null,
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

  const research = await runResearch({ run_id: runId, repoRoot })
  await emit({ phase: 'RESEARCH', job: 'research', status: 'PASS', contract_out: research.contract })
  record('RESEARCH', 'PASS')

  const plan = fromNativePlan({ run_id: runId, planText: nativePlan.planText || null, planData: nativePlan.plan || null })
  await emit({ phase: 'PLAN', job: 'native-plan', status: 'PASS', contract_out: plan.contract })
  record('PLAN', 'PASS')

  const planGate = evaluatePlanGate(plan)
  await emit({
    phase: 'PLAN_GATE', job: 'plan-gate', status: planGate.approved ? 'PASS' : 'FAIL',
    contract_in: plan.contract, contract_out: 'ecosystem.decision.v1',
  })
  record('PLAN_GATE', planGate.approved ? 'PASS' : 'FAIL')

  let attempt = 0
  let buildResult = null
  let verification = null
  const failedAttempts = [...previousFailures]

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
    const nativeBuild = await runNativeBuild({ buildInput, execute: buildExecutor })
    buildResult = nativeBuild.build_result
    const rawOutcome = nativeBuild.outcome || null
    const buildOk = buildResult.status === 'SUCCESS'
    await emit({
      phase: 'BUILD', job: 'native-build', status: buildOk ? 'PASS' : 'FAIL', attempt,
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
      failedAttempts.push({
        failure_signature: verification.verification.failure_signature,
        strategy_delta: verification.verification.strategy_delta || null,
      })
      attempt += 1
      continue
    }
    if (verification.verification.passed) break
    return finishRun({
      runId, task, baseline, research, plan, planGate, buildResult, verification,
      reviews: [], attempt, max_attempts: task.max_attempts, failedAttempts, boundaries, events, eventSink, emit, record,
      decision: intermediate,
    })
  }

  // Verify passed → run independent reviews, then let the controller decide.
  const reviews = []
  let reviewsAllPass = true
  for (const [type, analyzer] of reviewAnalyzers) {
    const review = analyzer({ run_id: runId, buildResult, verification, repoRoot, changedFiles: buildResult?.changed_files })
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
    decision,
  })
}

async function finishRun({
  runId, task, baseline, research, plan, planGate, buildResult, verification,
  reviews, attempt, max_attempts, failedAttempts, boundaries, events, eventSink, emit, record, decision,
}) {
  await emit({
    phase: 'CONTROLLER', job: 'deterministic-controller',
    status: decision.decision === 'DONE' ? 'PASS' : 'FAIL', attempt,
    contract_out: 'ecosystem.decision.v1',
    reason_code: decision.reason_code,
  })
  record('CONTROLLER', decision.decision === 'DONE' ? 'PASS' : 'FAIL')

  const phaseHistory = collapseBoundaries(boundaries)
  const firstBad = firstBadBoundary(phaseHistory)
  const finalDecision = {
    ...decision,
    first_bad_boundary: firstBad,
    phase_history: phaseHistory.map((boundary) => ({ ...boundary })),
  }

  return {
    run_id: runId,
    task,
    baseline,
    research,
    plan,
    plan_gate: planGate,
    build_result: buildResult,
    verification,
    reviews,
    decision: finalDecision,
    events,
    boundaries,
  }
}
