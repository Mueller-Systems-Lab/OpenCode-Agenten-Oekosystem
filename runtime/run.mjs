// SPDX-License-Identifier: MIT
/**
 * Canonical runtime entry point.
 *
 * runTask(task, options) is the single official entry for normal development
 * tasks. It:
 *   1. normalizes the task into ecosystem.task.v1 (run_id created here once)
 *   2. validates the task contract (CONTRACT_INVALID → deterministic abort)
 *   3. runs capability detection + preflight (required/optional capabilities,
 *      MCP preflight, skills-as-capability) with real checks
 *   4. starts the deterministic pipeline (research → plan → plan gate →
 *      build → verify → bounded retry → reviews)
 *   5. emits real ecosystem.run-event.v1 telemetry for every phase
 *   6. returns a validated ecosystem.decision.v1 from the deterministic
 *      controller (DONE | FIX | SPLIT | BLOCKED)
 *
 * run_id is created exactly once in the task contract and is immutable for
 * the whole run. No worker, retry, skill, or build may regenerate it.
 *
 * enterRun / enterTask are the entry-mode seams used by the productive
 * OpenCode plugin path: they perform the canonical task entry (normalization,
 * validation, preflight, events) so a real user task enters the runtime before
 * any agent work starts. The terminal decision still comes only from the
 * controller.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { create as createTask, validate as validateTask, CONTRACT_ID as TASK_CONTRACT } from './contracts/task.mjs'
import { create as createDecision, validate as validateDecision } from './contracts/decision.mjs'
import { runBaseline } from './baseline/capability-preflight.mjs'
import { runPipeline } from './pipeline/pipeline.mjs'
import { parsePlanText } from './adapters/native-opencode.mjs'
import { decide } from './controller/controller.mjs'
import { createRunEvent, appendRunEvent } from './observability/run-events.mjs'
import { resolveToolGrant } from './mcp/tool-grant.mjs'
import { defaultReviewAnalyzers } from './reviews/analyze.mjs'
import {
  DEFAULT_MODEL_CATALOG,
  DEFAULT_ROUTING_POLICY,
  selectRoute,
  enforceRouteRunId,
  routeSelectedEvent,
  routeRejectedEvent,
  HealthStore,
  routeCandidates,
  resolveCandidateHealth,
  probeProviderModel,
  healthStateChangedEvent,
  SharedBudgetGovernor,
  SHARED_BUDGET_RESOURCES,
} from './routing/index.mjs'
import { resolveModelHarness, harnessEvidenceFields } from './harness/index.mjs'

export const RUNTIME_PHASES = Object.freeze(['TASK', 'BASELINE', 'RESEARCH', 'PLAN', 'PLAN_GATE', 'BUILD', 'VERIFY', 'VISUAL_QA', 'REVIEWS', 'CONTROLLER'])

// --- Process-wide default shared budget governor (lazy singleton) ----------
// When routing.shared_budget.enabled is true and NO explicit governor is
// passed, runs share ONE process-wide SharedBudgetGovernor instance instead of
// each creating a private per-run governor (Scope=SINGLE_RUNTIME_PROCESS).
// An explicitly passed governor ALWAYS wins (backward compat). The singleton
// is created from the FIRST configuration encountered; a later run requesting
// a DIFFERENT effective configuration (resources map, ttl_ms, retention_limit)
// fails closed with CONFIG_INVALID:shared_budget.singleton_config_conflict —
// loud, never silent.
let defaultSharedBudgetGovernorInstance = null
let defaultSharedBudgetGovernorFingerprint = null

/** Current process-wide default shared budget governor instance, or null. */
export function defaultSharedBudgetGovernor() {
  return defaultSharedBudgetGovernorInstance
}

/** Test-only seam: clear the process-wide default governor singleton. */
export function resetDefaultSharedBudgetGovernorForTests() {
  defaultSharedBudgetGovernorInstance = null
  defaultSharedBudgetGovernorFingerprint = null
}

/**
 * Effective-configuration fingerprint for the default-governor singleton.
 * A throwaway governor applies the exact same normalization as a real one
 * (capacity fail-closed to 0, TTL clamping into [min,max], retention fallback),
 * so semantically identical configurations never conflict while any real
 * difference fails closed. Resource keys are sorted for deterministic order.
 */
function sharedBudgetConfigFingerprint({ resources, ttl_ms, retention_limit }) {
  const candidate = new SharedBudgetGovernor({
    resources,
    ...(ttl_ms !== undefined ? { ttl_ms } : {}),
    ...(retention_limit !== undefined ? { retention_limit } : {}),
  })
  return JSON.stringify({
    resources: Object.fromEntries(Object.entries(candidate.capacity).sort(([a], [b]) => (a < b ? -1 : 1))),
    ttl_ms: candidate.ttl_ms,
    retention_limit: candidate.retention_limit,
  })
}

export function defaultRunEventSink(repoRoot) {
  if (!repoRoot || typeof repoRoot !== 'string') return null
  return path.join(repoRoot, '.agent-governance', 'evidence', 'run-events.jsonl')
}

/**
 * Normalize a raw task input into ecosystem.task.v1. When the caller already
 * supplies a valid ecosystem.task.v1 value, it is reused unchanged — the
 * run_id is never regenerated.
 */
export function normalizeTaskInput(taskInput, { max_attempts, repository } = {}) {
  if (taskInput && typeof taskInput === 'object' && taskInput.contract === TASK_CONTRACT) {
    return { task: taskInput, created: false }
  }
  const task = createTask({
    ...(taskInput || {}),
    repository: taskInput?.repository ?? repository,
    ...(max_attempts !== undefined ? { max_attempts } : {}),
  })
  return { task, created: true }
}

/**
 * runTask — canonical entry point.
 *
 * Returns:
 *   - phase 'FAILED_ENTRY' + BLOCKED decision when the task contract is invalid
 *   - phase 'BLOCKED_ENTRY' + BLOCKED decision when a required capability,
 *     MCP tool, or skill is missing (fail fast, before any agent work)
 *   - phase 'ENTRY' when no workers (plan/build executor) are supplied — the
 *     run entered the runtime and is ready for worker continuation
 *   - phase 'PIPELINE' with the full pipeline result and a validated
 *     ecosystem.decision.v1 terminal decision
 */
export async function runTask(options = {}) {
  const {
    taskInput = {},
    repoRoot = null,
    env = process.env,
    inventory = {},
    mcpProfile = null,
    nativePlan = null,
    buildExecutor = null,
    verifyChecks = [],
    reviewAnalyzers = defaultReviewAnalyzers,
    eventSink = null,
    max_attempts,
    required_skills = [],
    capability_status = {},
    previousFailures = [],
    routing = null,
    routeExecutor = null,
    onWorkerFailure = null,
    visualQa = null,
  } = options

  const sink = eventSink || defaultRunEventSink(repoRoot)
  const events = []
  const emit = async (input) => {
    const event = createRunEvent(input)
    events.push(event)
    if (sink) await appendRunEvent(sink, event)
    return event
  }

  // 1. Normalize the task; run_id originates here (once).
  const { task } = normalizeTaskInput(taskInput, { max_attempts, repository: repoRoot })

  // 2. Validate the task contract — CONTRACT_INVALID is a deterministic abort.
  const validation = validateTask(task)
  if (!validation.ok) {
    const failedRunId = (task && task.run_id) || `invalid-${crypto.randomUUID()}`
    await emit({
      run_id: failedRunId, phase: 'TASK', job: 'create-task', status: 'FAIL',
      contract_in: 'ecosystem.task.v1', failure_signature: 'CONTRACT_INVALID:task',
    })
    const decision = createDecision({
      run_id: failedRunId, decision: 'BLOCKED', reason_code: 'CONTRACT_INVALID',
      first_bad_boundary: 'TASK', phase_history: [{ name: 'TASK', status: 'FAIL' }],
    })
    await emit({
      run_id: failedRunId, phase: 'CONTROLLER', job: 'deterministic-controller', status: 'FAIL',
      reason_code: 'CONTRACT_INVALID', contract_out: 'ecosystem.decision.v1',
    })
    return {
      phase: 'FAILED_ENTRY', run_id: failedRunId, task, baseline: null, decision,
      events, validation_issues: validation.issues,
    }
  }

  const runId = task.run_id

  // 3. Capability detection + preflight (capabilities, MCP, skills).
  const entryPlanData = typeof nativePlan === 'string'
    ? parsePlanText(nativePlan)
    : nativePlan?.plan || (nativePlan?.planText ? parsePlanText(nativePlan.planText) : null)
  const baseline = runBaseline({
    task, repoRoot, root: repoRoot, env, inventory, mcpProfile, required_skills, capability_status,
    plan: entryPlanData,
  })

  // 3b. Least-privilege worker tool grant: only the tools the task requires
  //     (required + available optional) are granted to the worker. The grant
  //     is derived from the same profile + inventory the preflight validated.
  const toolGrant = baseline.approved && mcpProfile
    ? resolveToolGrant({ profile: mcpProfile, inventory, preflight: baseline.mcp_preflight })
    : null

  // 3c. Deterministic model routing (runtime policy — opt-in per run). The
  //     routing policy selects the assigned provider/model from the canonical
  //     catalog; a worker can never self-select, upgrade, or fall back.
  //     Availability & cost governance (additive, all optional):
  //       routing.health.{enabled,store,probe_policy,probe_fn,opencode_bin,workdir}
  //       routing.cost_policy, routing.high_cost_routes_used
  //     Shared runtime budget (additive, optional):
  //       routing.shared_budget = { enabled, governor = null, resources = null,
  //         resource = 'HIGH_COST_ROUTE', ttl_ms, retention_limit }
  //     SHARING ACROSS CONCURRENT RUNS: without an explicit governor, runs
  //     share ONE process-wide default SharedBudgetGovernor (lazy singleton,
  //     Scope=SINGLE_RUNTIME_PROCESS) — concurrent normal-entry runs share
  //     budget capacity. An explicitly passed governor ALWAYS wins (backward
  //     compat: per-run or caller-shared injection is unchanged). The default
  //     singleton is created from the FIRST configuration encountered; a later
  //     run requesting a DIFFERENT singleton configuration (resources map,
  //     ttl_ms, retention_limit) fails closed with
  //     CONFIG_INVALID:shared_budget.singleton_config_conflict.
  //     Default HIGH_COST_ROUTE capacity when not specified: 2.
  let route = null
  let healthStore = null
  let healthMeta = { probed: [], cache_hits: [], probe_budget_skipped: [] }
  let sharedBudget = null
  const routingPolicy = routing?.policy || DEFAULT_ROUTING_POLICY
  const routingCatalog = routing?.catalog || DEFAULT_MODEL_CATALOG
  if (routing?.shared_budget?.enabled) {
    const sb = routing.shared_budget
    // Only HIGH_COST_ROUTE is wired this milestone. An explicitly configured
    // resource other than HIGH_COST_ROUTE would silently create an inert
    // budget seam (no reservation ever matches) — fail closed instead so the
    // misconfiguration is loud, not silent.
    if (sb.resource !== undefined && sb.resource !== SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE) {
      throw new Error('CONFIG_INVALID:shared_budget.resource must be HIGH_COST_ROUTE (only resource wired this milestone)')
    }
    let governor
    if (sb.governor) {
      // Explicit injection ALWAYS wins (backward compat — the caller controls
      // sharing scope by passing the same or different instances).
      governor = sb.governor
    } else {
      // No explicit governor → reuse ONE process-wide default governor so
      // concurrent normal-entry runs share budget capacity. Created lazily
      // from the FIRST configuration encountered; a conflicting later
      // configuration fails closed. The check+create sequence is synchronous
      // (no await between check and mutate) → atomic in a single process.
      const requestedConfig = {
        resources: sb.resources || { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 2 },
        ...(sb.ttl_ms !== undefined ? { ttl_ms: sb.ttl_ms } : {}),
        ...(sb.retention_limit !== undefined ? { retention_limit: sb.retention_limit } : {}),
      }
      if (!defaultSharedBudgetGovernorInstance) {
        defaultSharedBudgetGovernorFingerprint = sharedBudgetConfigFingerprint(requestedConfig)
        defaultSharedBudgetGovernorInstance = new SharedBudgetGovernor(requestedConfig)
      } else if (sharedBudgetConfigFingerprint(requestedConfig) !== defaultSharedBudgetGovernorFingerprint) {
        throw new Error('CONFIG_INVALID:shared_budget.singleton_config_conflict')
      }
      governor = defaultSharedBudgetGovernorInstance
    }
    sharedBudget = {
      governor,
      resource: sb.resource || SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE,
    }
  }
  if (routing?.enabled) {
    if (routing.health?.enabled && !routing.health.store) {
      healthStore = new HealthStore()
    } else if (routing.health?.enabled && routing.health.store) {
      healthStore = routing.health.store
    }
    const candidates = routeCandidates({
      requirements: routing.requirements || {},
      catalog: routingCatalog,
      policy: routingPolicy,
    })
    let health_map = null
    if (routing.health?.enabled && healthStore) {
      const before = new Map(healthStore.entries().map((e) => [`${e.provider}/${e.model}`, e]))
      const healthResult = await resolveCandidateHealth({
        candidates,
        store: healthStore,
        probe_policy: routing.health.probe_policy || null,
        probe_fn: routing.health.probe_fn
          || (({ provider, model }) => probeProviderModel({
            provider,
            model,
            workdir: routing.health.workdir || repoRoot || process.cwd(),
            opencode_bin: routing.health.opencode_bin || null,
          })),
        emit: async (input) => emit(input),
        run_id: runId,
        phase: 'ROUTING',
        attempt: task.attempt,
      })
      health_map = healthResult.health_map
      healthMeta = {
        probed: healthResult.probed,
        cache_hits: healthResult.cache_hits,
        probe_budget_skipped: healthResult.probe_budget_skipped,
      }
      // Emit a state-changed event for every health entry that changed during
      // this probe pass (diff the store before/after).
      const after = new Map(healthStore.entries().map((e) => [`${e.provider}/${e.model}`, e]))
      for (const [key, entry] of after) {
        const prev = before.get(key)
        if (!prev || prev.status !== entry.status) {
          await emit({
            ...healthStateChangedEvent({
              run_id: runId,
              provider: entry.provider,
              model: entry.model,
              from: prev ? prev.status : 'UNKNOWN',
              to: entry.status,
              failure_class: entry.failure_class || null,
              source: entry.source || 'PROBE',
              attempt: task.attempt,
              phase: 'ROUTING',
            }),
          })
        }
      }
    }
    const selection = selectRoute({
      requirements: routing.requirements || {},
      catalog: routingCatalog,
      policy: routingPolicy,
      explicit_override: routing.explicit_override || null,
      worker_requested_model: routing.worker_requested_model || null,
      phase: 'BUILD',
      health: health_map,
      cost_policy: routing.cost_policy || null,
      high_cost_routes_used: routing.high_cost_routes_used || 0,
    })
    if (selection.ok && selection.route) {
      route = enforceRouteRunId(runId, selection.route, 'routing-route')
      await emit({ ...routeSelectedEvent({ run_id: runId, route, attempt: task.attempt }) })
      if (selection.initial_model_skipped === 'INITIAL_MODEL_SKIPPED_FOR_HEALTH') {
        await emit({
          run_id: runId, phase: 'ROUTING', job: 'model.route.rejected', status: 'FAIL',
          failure_signature: 'INITIAL_MODEL_SKIPPED_FOR_HEALTH', attempt: task.attempt,
          strategy_delta: 'primary model skipped for live health — availability fallback',
        })
      }
      if (selection.worker_self_selection === 'DENIED') {
        await emit({
          run_id: runId, phase: 'ROUTING', job: 'model.route.rejected', status: 'FAIL',
          failure_signature: 'WORKER_SELF_SELECTION_DENIED', attempt: task.attempt,
          strategy_delta: 'worker requested model ignored — MODEL_SELECTION_AUTHORITY=DETERMINISTIC_RUNTIME_POLICY',
        })
      }
      // 3c-b. Hierarchical model harness (additive): after the route is set,
      //       the deterministic resolver maps the ROUTED model + task role to
      //       an effective worker harness (L1 model profile + L2 role overlay,
      //       generic fallback). Profiles are data, never authority: routing,
      //       pipeline, controller, grants, and budgets are unchanged, and a
      //       worker-requested profile is always denied. A harness contract
      //       violation fails closed via the routing rejection path.
      try {
        const harnessSelection = resolveModelHarness({
          provider: route.provider,
          model: route.model,
          task_role: routing.harness?.task_role || 'BUILD',
          allow_candidate: routing.harness?.allow_candidate === true,
          profiles: routing.harness?.profiles,
          worker_requested_profile: routing.harness?.worker_requested_profile || null,
        })
        route = Object.freeze({ ...route, harness: harnessSelection })
        await emit({
          run_id: runId, phase: 'ROUTING', job: 'model.harness.resolved', status: 'PASS',
          ...harnessEvidenceFields(harnessSelection),
          worker_self_selection: harnessSelection.worker_self_selection,
        })
      } catch (error) {
        const message = error instanceof Error ? String(error.message) : String(error)
        if (message.indexOf('CONTRACT_INVALID') !== 0) throw error
        await emit({
          run_id: runId, phase: 'ROUTING', job: 'model.harness.resolved', status: 'FAIL',
          failure_signature: 'HARNESS_CONTRACT_INVALID', attempt: task.attempt,
        })
        const decision = createDecision({
          run_id: runId, decision: 'BLOCKED', reason_code: 'HARNESS_CONTRACT_INVALID',
          first_bad_boundary: 'ROUTING',
          phase_history: [{ name: 'TASK', status: 'PASS' }, { name: 'ROUTING', status: 'FAIL' }],
        })
        await emit({
          run_id: runId, phase: 'CONTROLLER', job: 'deterministic-controller', status: 'FAIL',
          attempt: task.attempt, reason_code: decision.reason_code, contract_out: 'ecosystem.decision.v1',
        })
        return {
          phase: 'ROUTING_BLOCKED', run_id: runId, task, baseline, decision, events,
          routing_rejection: { code: 'HARNESS_CONTRACT_INVALID', reason: message.slice(0, 200) },
          route: null,
          health: { store: healthStore, ...healthMeta }, usage: [],
        }
      }
    } else {
      await emit({ ...routeRejectedEvent({ run_id: runId, reason_code: selection.code, reason: selection.reason, attempt: task.attempt }) })
      const decision = createDecision({
        run_id: runId, decision: 'BLOCKED', reason_code: selection.code || 'ROUTING_POLICY_DENIED',
        first_bad_boundary: 'ROUTING', phase_history: [{ name: 'TASK', status: 'PASS' }, { name: 'ROUTING', status: 'FAIL' }],
      })
      await emit({
        run_id: runId, phase: 'CONTROLLER', job: 'deterministic-controller', status: 'FAIL',
        attempt: task.attempt, reason_code: decision.reason_code, contract_out: 'ecosystem.decision.v1',
      })
      return {
        phase: 'ROUTING_BLOCKED', run_id: runId, task, baseline, decision, events,
        routing_rejection: { code: selection.code, reason: selection.reason }, route: null,
        health: { store: healthStore, ...healthMeta }, usage: [],
      }
    }
  }

  // 4. Fail fast: a missing required capability / MCP tool / skill blocks the
  //    run before any research, plan, or build work is performed.
  if (!baseline.approved) {
    await emit({ run_id: runId, phase: 'TASK', job: 'create-task', status: 'PASS', contract_in: task.contract })
    await emit({
      run_id: runId, phase: 'BASELINE', job: 'capability-preflight', status: 'FAIL',
      contract_out: baseline.contract,
    })
    const decision = decide({
      baseline,
      planGate: { approved: false, errors: ['BASELINE_FAILED'] },
      verification: null, reviews: [], attempt: task.attempt,
      boundaries: [{ name: 'TASK', status: 'PASS' }, { name: 'BASELINE', status: 'FAIL' }],
    })
    const finalDecision = {
      ...createDecision({
        run_id: runId,
        decision: decision.decision,
        reason_code: decision.reason_code,
        first_bad_boundary: decision.first_bad_boundary,
        phase_history: [{ name: 'TASK', status: 'PASS' }, { name: 'BASELINE', status: 'FAIL' }],
      }),
    }
    await emit({
      run_id: runId, phase: 'CONTROLLER', job: 'deterministic-controller', status: 'FAIL',
      attempt: task.attempt, reason_code: finalDecision.reason_code, contract_out: 'ecosystem.decision.v1',
    })
    return { phase: 'BLOCKED_ENTRY', run_id: runId, task, baseline, decision: finalDecision, events, tool_grant: null, route }
  }

  // 5. The full deterministic pipeline needs workers (native plan + build
  //    executor). Without them the run is entered (entry mode) and ready for
  //    worker continuation; the plugin seam uses this mode.
  const planAvailable = Boolean(nativePlan) && (typeof nativePlan === 'string' || Boolean(nativePlan.planText || nativePlan.plan))
  const buildAvailable = typeof buildExecutor === 'function' || (routing?.enabled && typeof routeExecutor === 'function')
  if (!planAvailable || !buildAvailable) {
    await emit({ run_id: runId, phase: 'TASK', job: 'create-task', status: 'PASS', contract_in: task.contract })
    await emit({
      run_id: runId, phase: 'BASELINE', job: 'capability-preflight', status: 'PASS',
      contract_out: baseline.contract,
    })
    return { phase: 'ENTRY', run_id: runId, task, baseline, decision: null, events, entry: 'READY', tool_grant: toolGrant, route }
  }

  const pipelinePlan = typeof nativePlan === 'string' ? { planText: nativePlan } : nativePlan
  let result
  try {
    result = await runPipeline({
    taskInput: task,
    repoRoot,
    env,
    inventory,
    mcpProfile,
    nativePlan: pipelinePlan,
    buildExecutor,
    verifyChecks,
    reviewAnalyzers,
    eventSink: sink,
    required_skills,
    capability_status,
    previousFailures,
    tool_grant: toolGrant,
    route,
    routing: routing?.enabled ? routingPolicy : null,
    cost_policy: routing?.cost_policy || null,
    routeExecutor,
    harness_options: routing?.harness || {},
    onWorkerFailure,
    sharedBudget,
    visualQa,
  })

  } catch (error) {
    // A worker that replaces the run_id (or any other contract invariant)
    // aborts the run deterministically with CONTRACT_INVALID.
    const message = error instanceof Error ? String(error.message) : String(error)
    if (message.indexOf('CONTRACT_INVALID') === 0) {
      await emit({
        run_id: runId, phase: 'CONTROLLER', job: 'deterministic-controller', status: 'FAIL',
        attempt: task.attempt, failure_signature: message.slice(0, 120), contract_out: 'ecosystem.decision.v1',
      })
      const decision = {
        ...createDecision({
          run_id: runId, decision: 'BLOCKED', reason_code: 'CONTRACT_INVALID', first_bad_boundary: null,
        }),
        contract_invalid_reason: message,
      }
      return { phase: 'ABORTED', run_id: runId, task, baseline, decision, events, route }
    }
    throw error
  }

  // 6. The controller result must be a valid ecosystem.decision.v1.
  const decisionValidation = validateDecision(result.decision)
  if (!decisionValidation.ok) {
    throw new Error(`CONTRACT_INVALID:controller-decision:${decisionValidation.issues.join('; ')}`)
  }
  return {
    ...result,
    phase: 'PIPELINE',
    decision_validated: true,
    live_model_evidence: result.build_result?.live_model_evidence === true,
    live_model_result: result.build_result?.live_model_result || null,
    tool_grant: toolGrant,
    route: result.route || route,
    health: { store: healthStore, ...healthMeta },
    usage: result.usage || [],
  }
}

/**
 * enterTask — entry-mode seam. Performs the canonical task entry (normalize,
 * validate, preflight, events) without starting the pipeline. Used by the
 * productive OpenCode plugin path and by entry-point tests.
 */
export function enterTask(options = {}) {
  return runTask({ ...options, nativePlan: null, buildExecutor: null })
}

const RUN_CONTEXT_REL = path.join('.agent-governance', 'runtime', 'run-context.json')

/**
 * enterRun — idempotent plugin seam. Persists the canonical run context
 * (ecosystem.task.v1 + baseline + decision) for a real user message so the
 * run_id is stable across the session and later pipeline execution reuses it.
 * Required capability / MCP / skill failures block the task before work.
 */
export async function enterRun({
  targetRoot,
  taskText,
  sessionId = '',
  messageId = '',
  eventSink = null,
  env = process.env,
  inventory = {},
  mcpProfile = null,
  required_skills = [],
  capability_status = {},
} = {}) {
  if (!targetRoot || typeof targetRoot !== 'string') {
    return { blocked: true, code: 'RED_BLOCK_TARGET_ROOT_UNCLEAR' }
  }
  const contextPath = path.join(targetRoot, RUN_CONTEXT_REL)
  const sink = eventSink || defaultRunEventSink(targetRoot)

  let existing = null
  try { existing = JSON.parse(await fs.readFile(contextPath, 'utf8')) } catch { /* none yet */ }
  if (existing && existing.session_id === sessionId && existing.message_id === messageId && existing.task?.contract === TASK_CONTRACT) {
    return { ...existing, blocked: existing.decision?.decision === 'BLOCKED', idempotent: true }
  }

  const entry = await runTask({
    taskInput: { task: String(taskText || ''), repository: targetRoot },
    repoRoot: targetRoot,
    env,
    inventory,
    mcpProfile,
    required_skills,
    capability_status,
    eventSink: sink,
  })

  const context = {
    session_id: sessionId,
    message_id: messageId,
    task: entry.task || null,
    baseline: entry.baseline || null,
    decision: entry.decision || null,
    phase: entry.phase || null,
    entered_at: new Date().toISOString(),
    event_sink: sink,
  }
  await fs.mkdir(path.dirname(contextPath), { recursive: true, mode: 0o700 })
  const temporary = `${contextPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(context, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await fs.rename(temporary, contextPath)

  return { ...context, blocked: entry.decision?.decision === 'BLOCKED' }
}

export { TASK_CONTRACT, createDecision }
