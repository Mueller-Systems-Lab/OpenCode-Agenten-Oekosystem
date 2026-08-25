// SPDX-License-Identifier: MIT
/** Bounded A/B evaluation over the existing canonical runtime seam. */
import crypto from 'node:crypto'
import { resolveModelHarness } from './harness-resolver.mjs'
import { composeWorkerTaskText, applyToolExposure } from './apply-harness.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from './model-harness-profiles.mjs'
import { DEFAULT_ROUTING_POLICY } from '../routing/index.mjs'

export const EVALUATION_CONTRACT = 'ecosystem.model-harness-evaluation.v1'
export const CORPUS_VERSION = 'issue-33-corpus.v1'
export const PLAN_VERSION = 'issue-33-plan.v1'
export const PROMOTION_POLICY_VERSION = 'issue-33-promotion.v2'
export const CANONICAL_EXECUTOR_CONTRACT = 'ecosystem.canonical-evaluation-executor.v1'
export const PROVIDER_EXECUTOR_CONTRACT = 'ecosystem.provider-executor.v1'
export const PROVIDER_MISMATCH_FAILURE = 'PROVIDER_MISMATCH'

// These bindings deliberately never cross the module boundary. Public fields
// are audit metadata only: a caller can copy, spread, or relabel them. The
// WeakSets/WeakMap bind evidence to objects constructed by this process.
const CANONICAL_RESULT_RECEIPTS = new WeakMap()
const CANONICAL_RECORDS = new WeakSet()
const CANONICAL_RECORD_RECEIPTS = new WeakMap()

const CASES = Object.freeze([
  { case_id: 'isolated-bugfix', task_role: 'BUILD', task: 'Fix one isolated defect and report the changed file.', verifier: 'changed_file' },
  { case_id: 'multi-file-change', task_role: 'PLAN', task: 'Plan a bounded multi-file change with explicit targets.', verifier: 'plan_targets' },
  { case_id: 'structured-output-exactness', task_role: 'REVIEW', task: 'Return the requested structured review result exactly.', verifier: 'structured_result' },
  { case_id: 'tool-minimal-artifact', task_role: 'TOOL_USE', task: 'Use only granted tools to produce the requested artifact.', verifier: 'tool_boundary' },
  { case_id: 'controlled-retry', task_role: 'RESEARCH', task: 'Research the bounded question and retain observed failures.', verifier: 'retained_failure' },
])

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}
function fingerprint(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex') }

/** Explicitly marked deterministic adapter; it is never accepted for live mode. */
export function createFixtureExecutor(execute) {
  if (typeof execute !== 'function') throw new Error('CONTRACT_INVALID:evaluation:fixture callback required')
  return Object.freeze({ contract: EVALUATION_CONTRACT, kind: 'fixture', provenance: 'deterministic-fixture', execute })
}

function validateProviderExecutor(providerExecutor) {
  if (!providerExecutor || typeof providerExecutor !== 'object'
    || providerExecutor.canonicalProviderExecutor !== true
    || providerExecutor.contract !== PROVIDER_EXECUTOR_CONTRACT
    || typeof providerExecutor.execute !== 'function'
    || typeof providerExecutor.metadata !== 'object'
    || typeof providerExecutor.metadata.connector_id !== 'string'
    || typeof providerExecutor.metadata.provider !== 'string'
    || typeof providerExecutor.metadata.model !== 'string'
    || providerExecutor.metadata.live_capable !== true) {
    throw new Error('CONTRACT_INVALID:evaluation:provider executor must be an explicitly marked canonical live connector')
  }
  return providerExecutor
}

function bindCanonicalResult(result, receipt) {
  const bound = result && typeof result === 'object' ? { ...result } : { value: result }
  const frozenReceipt = Object.freeze({ ...receipt })
  CANONICAL_RESULT_RECEIPTS.set(bound, frozenReceipt)
  return { result: bound, receipt: frozenReceipt }
}

/**
 * Adapter for the one canonical runtime entry point. The provider executor is
 * deliberately outside this module; routing, grants, retries and permissions
 * remain owned by runTask/runPipeline. Without it this is a truthful TOOL_GAP.
 */
export function createCanonicalRuntimeExecutor({ providerExecutor = null, runTaskImpl = null, repoRoot = null } = {}) {
  if (providerExecutor !== null) validateProviderExecutor(providerExecutor)
  return Object.freeze({
    contract: CANONICAL_EXECUTOR_CONTRACT,
    kind: 'canonical',
    provenance: 'canonical-ocae-runtime',
    execute: async (request, { signal } = {}) => {
      if (providerExecutor !== null
        && (providerExecutor.metadata.provider !== request.provider
          || providerExecutor.metadata.model !== request.model)) {
        return {
          error: `${PROVIDER_MISMATCH_FAILURE}: provider executor metadata does not match requested provider/model`,
          failure_class: PROVIDER_MISMATCH_FAILURE,
          failure_retained: true,
          canonical_execution: true,
        }
      }
      const { runTask } = runTaskImpl ? { runTask: runTaskImpl } : await import('../run.mjs')
       if (signal?.aborted) return { error: 'TIMEOUT', failure_class: 'TIMEOUT', canonical_execution: true }
      const canonicalRouting = {
        enabled: true,
        explicit_override: { provider: request.provider, model: request.model },
        policy: {
          ...DEFAULT_ROUTING_POLICY,
          primary_provider: request.provider,
          primary_model: request.model,
          allowed_providers: [request.provider],
          provider_fallback_allowlist: [request.provider],
          max_model_escalations: 0,
          max_provider_fallbacks: 0,
        },
        // The arm is evaluation authorization only. The canonical runtime
        // still owns routing/model selection; this is an additive resolver input.
        harness: { task_role: request.task_role, allow_candidate: request.arm === 'candidate' },
      }
       if (providerExecutor === null) {
        // Enter the real seam, but do not turn an unavailable provider into a fixture result.
         const entered = await runTask({ taskInput: { task: request.task_text, repository: repoRoot }, repoRoot, routing: canonicalRouting })
         return bindCanonicalResult({ error: 'TOOL_GAP:canonical provider executor unavailable', failure_class: 'TOOL_GAP', canonical_execution: true }, {
           run_id: entered?.run_id,
           provider: request.provider,
           model: request.model,
           runtime_entry: true,
           live_model_evidence: false,
         }).result
      }
       const result = await runTask({
        taskInput: { task: request.task_text, repository: repoRoot }, repoRoot,
        nativePlan: { plan: { targets: [{ path: request.case_id, description: request.task_text }], build_scope: { files: [request.case_id] }, acceptance_criteria: ['canonical evaluation result'] } },
         routeExecutor: (_route, context) => async (_input, executionContext = {}) => providerExecutor.execute(request, { ...context, ...executionContext, signal }),
        routing: canonicalRouting,
      })
       return bindCanonicalResult({ ...result, ...(result.live_model_result || {}), canonical_execution: true, run_id: result.run_id }, {
         run_id: result.run_id,
         provider: request.provider,
         model: request.model,
         runtime_entry: true,
         // A connector must explicitly provide this; a marked seam alone is
         // structural provenance, not proof of a live model response.
         live_model_evidence: result.live_model_evidence === true,
       }).result
    },
  })
}

export function frozenCorpus() {
  const cases = CASES.map((entry) => ({ ...entry }))
  return Object.freeze({ contract: EVALUATION_CONTRACT, version: CORPUS_VERSION, cases, fingerprint: fingerprint({ version: CORPUS_VERSION, cases }) })
}

export function createEvaluationPlan({ corpus = frozenCorpus(), models, repetitions = 2, max_rows = 64 } = {}) {
  if (!Array.isArray(models) || models.length === 0) throw new Error('CONTRACT_INVALID:evaluation:models required')
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3) throw new Error('BUDGET_EXCEEDED:evaluation:repetitions')
  const rows = []
  for (let repetition = 1; repetition <= repetitions; repetition += 1) for (const model of models) for (const entry of corpus.cases) for (const arm of ['generic', 'candidate']) {
    rows.push({ sequence: rows.length, model: { provider: model.provider, model: model.model }, case_id: entry.case_id, task_role: entry.task_role, repetition, arm })
  }
  if (rows.length > max_rows) throw new Error('BUDGET_EXCEEDED:evaluation:planned rows')
  return Object.freeze({ contract: EVALUATION_CONTRACT, version: PLAN_VERSION, corpus_fingerprint: corpus.fingerprint, models: models.map((m) => ({ ...m })), repetitions, rows, fingerprint: fingerprint({ version: PLAN_VERSION, corpus_fingerprint: corpus.fingerprint, rows }) })
}

function verifyResult(entry, result) {
  if (result?.rate_limited === true) return { ok: false, code: 'RATE_LIMITED' }
  if (result?.failure_class === 'TIMEOUT' || result?.error === 'TIMEOUT') return { ok: false, code: 'TIMEOUT' }
  if (result?.failure_class === 'TOOL_GAP') return { ok: false, code: 'TOOL_GAP' }
  if (result?.failure_class === PROVIDER_MISMATCH_FAILURE) return { ok: false, code: PROVIDER_MISMATCH_FAILURE }
  if (result?.paid_calls > 0 || result?.fallback === true) return { ok: false, code: 'FORBIDDEN_EFFECT' }
  if (result?.error) return { ok: false, code: 'WORKER_ERROR' }
  if (entry.verifier === 'changed_file') return { ok: Array.isArray(result?.changed_files) && result.changed_files.length === 1, code: 'CHANGED_FILE' }
  if (entry.verifier === 'plan_targets') return { ok: Array.isArray(result?.targets) && result.targets.length > 0, code: 'PLAN_TARGETS' }
  if (entry.verifier === 'structured_result') return { ok: result?.structured === true, code: 'STRUCTURED_RESULT' }
  if (entry.verifier === 'tool_boundary') return { ok: result?.tools_added !== true, code: 'TOOL_BOUNDARY' }
  return { ok: result?.failure_retained !== false, code: 'FAILURE_RETAINED' }
}

export async function runEvaluation({ plan, corpus = frozenCorpus(), executor, execute, mode = 'fixture', profiles, role_profiles, budgets = {}, evaluation_id = null, series_id = null, provider = null, model = null } = {}) {
  if (!plan || plan.corpus_fingerprint !== corpus.fingerprint) throw new Error('CONTRACT_INVALID:evaluation:corpus fingerprint mismatch')
  if (mode === 'live' && !executor) throw new Error('CONTRACT_INVALID:evaluation:live requires canonical executor; fixture callback rejected')
  const selected = executor || (mode === 'fixture' && typeof execute === 'function' ? createFixtureExecutor(execute) : null)
  if (!selected || typeof selected.execute !== 'function') throw new Error('CONTRACT_INVALID:evaluation:explicit executor required')
  if (mode === 'live' && (selected.kind !== 'canonical' || (execute && !executor))) throw new Error('CONTRACT_INVALID:evaluation:live requires canonical executor; fixture callback rejected')
  if (mode === 'fixture' && selected.kind !== 'fixture') throw new Error('CONTRACT_INVALID:evaluation:fixture requires fixture adapter')
  const limits = { max_calls: plan.rows.length, max_ms: 120_000, timeout_ms: 30_000, max_retries: 0, ...budgets }
  const started = Date.now(); let calls = 0; const records = []
  const evaluationId = evaluation_id || fingerprint({ plan: plan.fingerprint, started: 0 }).slice(0, 16)
  const seriesId = series_id || evaluationId
  for (const planned of plan.rows) {
    const entry = corpus.cases.find((item) => item.case_id === planned.case_id)
    const resolution = resolveModelHarness({ provider: planned.model.provider, model: planned.model.model, task_role: planned.task_role, profiles: profiles || DEFAULT_MODEL_HARNESS_PROFILES, role_profiles, allow_candidate: planned.arm === 'candidate' })
    const tools = applyToolExposure({ grantedTools: ['read', 'write', 'edit', 'list', 'glob'], toolPolicy: resolution.effective_harness.tool_policy })
     const request = { ...planned, provider: planned.model.provider, model: planned.model.model, corpus_fingerprint: corpus.fingerprint, harness_fingerprint: resolution.fingerprint, effective_harness_fingerprint: resolution.fingerprint, profile_id: resolution.profile_id, profile_version: resolution.profile_version, task_text: composeWorkerTaskText({ taskText: entry.task, effectiveHarness: resolution.effective_harness }), exposed_tools: tools.exposed_tools }
    const t0 = Date.now(); let result = null; let failure = null; let timedOut = false
    if (calls >= limits.max_calls) { failure = 'BUDGET_EXCEEDED:evaluation:max_calls' }
    else if (Date.now() - started >= limits.max_ms) { failure = 'TIMEOUT:BUDGET_EXCEEDED'; timedOut = true }
    else {
      calls += 1
      const controller = new AbortController(); const timer = setTimeout(() => { timedOut = true; controller.abort() }, limits.timeout_ms)
      try {
        result = await Promise.race([Promise.resolve(selected.execute(request, { signal: controller.signal })), new Promise((resolve) => setTimeout(() => resolve({ error: 'TIMEOUT', failure_class: 'TIMEOUT' }), limits.timeout_ms))])
      } catch (error) { failure = error instanceof Error ? error.message : String(error) } finally { clearTimeout(timer) }
      if (timedOut && (!result || result.error !== 'TIMEOUT')) { result = { ...(result || {}), error: 'TIMEOUT', failure_class: 'TIMEOUT' } }
    }
    if (!result) result = { error: failure, failure_retained: true }
    if (selected.kind === 'canonical'
      && (timedOut || result.failure_class === 'TIMEOUT' || result.error === 'TIMEOUT')
      && !CANONICAL_RESULT_RECEIPTS.has(result)) {
      const timeoutRunId = crypto.randomUUID()
      result = bindCanonicalResult({
        ...result,
        canonical_execution: true,
        run_id: timeoutRunId,
      }, {
        run_id: timeoutRunId,
        provider: request.provider,
        model: request.model,
        runtime_entry: true,
        live_model_evidence: false,
      }).result
    }
    const verification = verifyResult(entry, result)
    if (failure && !verification.code) failure = failure
    const forbidden = result.paid_calls > 0 || result.fallback === true
    const toolCallCount = result.tool_call_count ?? result.tool_calls ?? null
    const record = Object.freeze({
      contract: EVALUATION_CONTRACT,
      evaluation_id: evaluationId,
      series_id: seriesId,
      plan_fingerprint: plan.fingerprint,
      corpus_fingerprint: corpus.fingerprint,
      sequence: planned.sequence,
      provider: provider || planned.model.provider,
      model: model || planned.model.model,
      case_id: planned.case_id,
      repetition: planned.repetition,
      arm: planned.arm,
      profile_id: resolution.profile_id,
      profile_version: resolution.profile_version,
      variant: planned.arm,
      task_role: planned.task_role,
      effective_harness_fingerprint: resolution.fingerprint,
      harness_fingerprint: resolution.fingerprint,
      verified_success: verification.ok && !forbidden,
      functional_correctness: result.functional_correctness ?? verification.ok,
      first_tool_correct: result.first_tool_correct ?? result.tool_selection_correct ?? null,
      required_tool_used: result.required_tool_used ?? null,
      tool_selection_correct: result.tool_selection_correct ?? null,
      invalid_tool_calls: result.invalid_tool_calls ?? null,
      unnecessary_tool_calls: result.unnecessary_tool_calls ?? null,
      tool_call_count: toolCallCount,
      tool_calls: toolCallCount,
      retry_count: result.retry_count ?? 0,
      runtime_failures: result.runtime_failures ?? (verification.ok ? [] : [verification.code]),
      input_context_volume: result.input_context_volume ?? null,
      tool_result_volume: result.tool_result_volume ?? null,
      latency_ms: Date.now() - t0,
      failure_class: forbidden ? 'FORBIDDEN_EFFECT' : (failure || verification.code === 'TIMEOUT' ? verification.code : (result.failure_class || null)),
      failure: failure || result.error || null,
      verifier_type: entry.verifier,
      verifier: entry.verifier,
      verifier_result: verification,
      outcome: verification.ok && !forbidden ? 'VERIFIED_SUCCESS' : 'FAILURE',
      rate_limited: verification.code === 'RATE_LIMITED',
      paid_calls: result.paid_calls ?? null,
      fallback: result.fallback ?? null,
      retained: true,
      provenance: selected.provenance,
      canonical_execution: selected.kind === 'canonical',
      run_id: result.run_id ?? null,
      cost_tier: result.cost_tier ?? null,
    })
     records.push(record)
     const receipt = CANONICAL_RESULT_RECEIPTS.get(result)
     if (selected.kind === 'canonical' && receipt) {
       CANONICAL_RECORDS.add(record)
       CANONICAL_RECORD_RECEIPTS.set(record, receipt)
     }
  }
  return { contract: EVALUATION_CONTRACT, evaluation_id: evaluationId, series_id: seriesId, plan, corpus, plan_fingerprint: plan.fingerprint, corpus_fingerprint: corpus.fingerprint, records, metrics: calculateMetrics(records), comparison: comparePaired(records), live_status: mode === 'live' ? (records.some((r) => r.failure_class === 'TOOL_GAP') ? 'TOOL_GAP' : 'LIVE_ATTEMPTED') : 'FIXTURE_ONLY' }
}

export function calculateMetrics(records) {
  const byArm = {}
  for (const arm of ['generic', 'candidate']) {
    const rows = records.filter((r) => r.arm === arm)
    const successes = rows.filter((r) => r.verified_success)
    const average = (field, fallback = 0) => {
      const values = rows.map((row) => row[field]).filter((value) => typeof value === 'number' && Number.isFinite(value))
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback
    }
    const averageArrayLength = (field) => {
      const values = rows.map((row) => Array.isArray(row[field]) ? row[field].length : null).filter((value) => value !== null)
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
    }
    byArm[arm] = {
      rows: rows.length,
      verified_success: successes.length,
      success_rate: rows.length ? successes.length / rows.length : 0,
      failures: rows.length - successes.length,
      average_input_context_volume: average('input_context_volume'),
      average_tool_result_volume: average('tool_result_volume'),
      average_tool_calls: average('tool_calls'),
      average_retry_count: average('retry_count'),
      average_runtime_failures: averageArrayLength('runtime_failures'),
    }
  }
  return byArm
}
export function comparePaired(records) {
  const keys = new Set(records.map((r) => `${r.provider}/${r.model}|${r.case_id}|${r.repetition}`)); const pairs = []
  for (const key of keys) { const pair = records.filter((r) => `${r.provider}/${r.model}|${r.case_id}|${r.repetition}` === key); if (pair.length === 2 && new Set(pair.map((r) => r.arm)).size === 2) pairs.push({ key, generic: pair.find((r) => r.arm === 'generic').outcome, candidate: pair.find((r) => r.arm === 'candidate').outcome }) }
  return { pairs, complete: pairs.length * 2 === records.length, candidate_wins: pairs.filter((p) => p.candidate === 'VERIFIED_SUCCESS' && p.generic !== 'VERIFIED_SUCCESS').length, candidate_losses: pairs.filter((p) => p.generic === 'VERIFIED_SUCCESS' && p.candidate !== 'VERIFIED_SUCCESS').length }
}

/**
 * Rebuilds evaluation truth from the immutable plan and records. Promotion
 * must never trust caller-supplied metrics or comparisons.
 */
export function validateEvaluationIntegrity({ evaluation, plan, corpus, mode = 'live' } = {}) {
  const issues = []
  if (!evaluation || !plan || !corpus) return { ok: false, issues: ['CONTRACT_INVALID:evaluation:plan, corpus and evaluation required'] }
  if (evaluation.plan_fingerprint !== plan.fingerprint) issues.push('CONTRACT_INVALID:evaluation:plan fingerprint mismatch')
  if (evaluation.corpus_fingerprint !== corpus.fingerprint || plan.corpus_fingerprint !== corpus.fingerprint) issues.push('CONTRACT_INVALID:evaluation:corpus fingerprint mismatch')
  if (!Array.isArray(evaluation.records) || evaluation.records.length !== plan.rows.length) issues.push('CONTRACT_INVALID:evaluation:record count does not match plan')
  const expected = new Map(plan.rows.map((row) => [`${row.sequence}|${row.model.provider}|${row.model.model}|${row.case_id}|${row.repetition}|${row.arm}`, row]))
  const seen = new Set()
  const profileGroups = new Map()
  for (const record of evaluation.records || []) {
    const key = `${record.sequence}|${record.provider}|${record.model}|${record.case_id}|${record.repetition}|${record.arm}`
    const planned = expected.get(key)
    if (!planned) { issues.push(`CONTRACT_INVALID:evaluation:record does not map to plan (${key})`); continue }
    if (seen.has(key)) issues.push(`CONTRACT_INVALID:evaluation:duplicate plan row (${key})`)
    seen.add(key)
    if (record.plan_fingerprint !== plan.fingerprint || record.corpus_fingerprint !== corpus.fingerprint) issues.push(`CONTRACT_INVALID:evaluation:record fingerprint mismatch (${key})`)
    if (record.task_role !== planned.task_role) issues.push(`CONTRACT_INVALID:evaluation:record role mismatch (${key})`)
    const group = `${record.provider}|${record.model}|${record.task_role}|${record.arm}`
    const profile = `${record.profile_id}|${record.profile_version}|${record.harness_fingerprint}|${record.effective_harness_fingerprint}`
    if (profileGroups.has(group) && profileGroups.get(group) !== profile) issues.push(`CONTRACT_INVALID:evaluation:unstable harness fingerprint (${group})`)
    profileGroups.set(group, profile)
    if (mode === 'live') {
       const receipt = CANONICAL_RECORD_RECEIPTS.get(record)
       if (!CANONICAL_RECORDS.has(record) || !receipt || record.canonical_execution !== true || record.provenance !== 'canonical-ocae-runtime' || typeof record.run_id !== 'string' || record.run_id.length === 0 || receipt.run_id !== record.run_id || receipt.provider !== record.provider || receipt.model !== record.model || receipt.runtime_entry !== true) issues.push(`CONTRACT_INVALID:evaluation:missing canonical provenance binding/run_id (${key})`)
      if (record.failure_class === 'TOOL_GAP') issues.push(`TOOL_GAP:evaluation:live row unavailable (${key})`)
    }
  }
  if (seen.size !== expected.size) issues.push('CONTRACT_INVALID:evaluation:each plan row must map exactly once')
  const metrics = calculateMetrics(evaluation.records || [])
  const comparison = comparePaired(evaluation.records || [])
  if (canonical(metrics) !== canonical(evaluation.metrics)) issues.push('CONTRACT_INVALID:evaluation:metrics are inconsistent with records')
  if (canonical(comparison) !== canonical(evaluation.comparison)) issues.push('CONTRACT_INVALID:evaluation:paired comparison is inconsistent with records')
  return { ok: issues.length === 0, issues, metrics, comparison }
}

export function decidePromotion({ evaluation, plan = evaluation?.plan, corpus = evaluation?.corpus, core_regression = false, security_regression = false, live = true, hypothesis_dimension = 'verified_success', effect_size_threshold = 0.1, min_paired_samples = 2 } = {}) {
  const integrity = validateEvaluationIntegrity({ evaluation, plan, corpus, mode: 'live' })
  if (!integrity.ok) return { policy: PROMOTION_POLICY_VERSION, decision: 'E_BLOCKED_NO_LIVE_EVIDENCE', integrity_issues: integrity.issues }
  const generic = evaluation?.metrics?.generic; const candidate = evaluation?.metrics?.candidate; const pairs = evaluation?.comparison?.pairs?.length || 0
  const canonicalLiveEvidence = evaluation?.live_status === 'LIVE_ATTEMPTED'
    && Array.isArray(evaluation?.records)
    && evaluation.records.length > 0
    && evaluation.records.every((row) => (
      row?.canonical_execution === true
      && row?.provenance === 'canonical-ocae-runtime'
      && row?.failure_class !== 'TOOL_GAP'
       && row?.failure_class !== PROVIDER_MISMATCH_FAILURE
       && CANONICAL_RECORDS.has(row)
       && CANONICAL_RECORD_RECEIPTS.get(row)?.live_model_evidence === true
    ))
  if (!live || !canonicalLiveEvidence) return { policy: PROMOTION_POLICY_VERSION, decision: 'E_BLOCKED_NO_LIVE_EVIDENCE' }
  if (!evaluation?.comparison?.complete || evaluation.records.some((r) => r.paid_calls > 0 || r.fallback === true || r.failure_class === 'FORBIDDEN_EFFECT')) return { policy: PROMOTION_POLICY_VERSION, decision: 'D_REJECT_INCOMPLETE' }
  if (core_regression || security_regression || !generic || !candidate || candidate.success_rate < generic.success_rate) return { policy: PROMOTION_POLICY_VERSION, decision: 'C_REJECT_REGRESSION' }
  const lowerIsBetter = new Set(['input_context_volume', 'tool_result_volume', 'tool_calls', 'retry_count', 'runtime_failures'])
  const metricByDimension = {
    input_context_volume: 'average_input_context_volume',
    tool_result_volume: 'average_tool_result_volume',
    tool_calls: 'average_tool_calls',
    retry_count: 'average_retry_count',
    runtime_failures: 'average_runtime_failures',
  }
  let effect
  if (hypothesis_dimension === 'verified_success') effect = candidate.success_rate - generic.success_rate
  else if (metricByDimension[hypothesis_dimension]) {
    const genericValue = generic[metricByDimension[hypothesis_dimension]]
    const candidateValue = candidate[metricByDimension[hypothesis_dimension]]
    effect = genericValue > 0 ? (genericValue - candidateValue) / genericValue : 0
  } else return { policy: PROMOTION_POLICY_VERSION, decision: 'B_REJECT_NO_VALUE', hypothesis_dimension, effect_size: 0 }
  if (hypothesis_dimension !== 'verified_success' && !lowerIsBetter.has(hypothesis_dimension)) return { policy: PROMOTION_POLICY_VERSION, decision: 'B_REJECT_NO_VALUE', hypothesis_dimension, effect_size: effect }
  if (pairs < min_paired_samples || effect < effect_size_threshold) return { policy: PROMOTION_POLICY_VERSION, decision: 'B_REJECT_NO_VALUE', hypothesis_dimension, effect_size: effect, min_paired_samples }
  return { policy: PROMOTION_POLICY_VERSION, decision: 'A_PROMOTE', hypothesis_dimension, effect_size: effect, paired_samples: pairs, promotion: 'requires explicit registry change' }
}
