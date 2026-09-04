// SPDX-License-Identifier: MIT
/** Development-only deterministic qualification and holdout runner. */
import { createEmpiricalCapabilityRecord, createQualificationIdentity, createCapabilityMetric, fingerprint } from './empirical-capability-contract.mjs'

export const QUALIFICATION_RUNNER_CONTRACT = 'ecosystem.empirical-qualification-runner.v1'
export const QUALIFICATION_RUNNER_VERSION = 1
export const QUALIFICATION_MODES = Object.freeze(['DERIVATION_CORPUS', 'CONFIRMATORY_HOLDOUT_CORPUS'])
export const DISCOVERY_STRATEGIES = Object.freeze(['glob→grep→read', 'grep→lsp→read', 'glob→lsp→read', 'grep→read'])

const FORBIDDEN = new Set([
  'permissions', 'permission', 'tool_allowlist', 'allowed_tools', 'provider', 'model',
  'route', 'routing', 'budget', 'retry_budget', 'escalation', 'terminal_decision',
  'verification_authority', 'promotion', 'scope', 'read_scope', 'write_scope',
])
const METRICS = Object.freeze([
  'tool_selection_correct', 'tool_argument_validity', 'required_tool_used', 'unnecessary_tool_calls',
  'invalid_tool_calls', 'recovery_after_invalid_call', 'recovery_after_tool_failure', 'tool_call_count',
  'schema_parse_failure', 'wrong_argument_name', 'missing_required_argument', 'invalid_argument_type', 'semantic_argument_error',
  'observation_status_comprehension', 'source_attribution_correct', 'path_line_association_correct',
  'failure_class_comprehension', 'truncation_awareness', 'staleness_awareness', 'grounded_final_claim',
  'fabricated_result_count', 'next_action_correct', 'cross_result_correlation_correct',
  'parallel_call_generation_accuracy', 'parallel_result_correlation_accuracy', 'cross_result_contamination',
  'discovery_steps', 'files_read', 'symbols_read', 'search_result_count', 'irrelevant_context',
  'latency_ms', 'context_volume', 'raw_result_volume', 'adapted_result_volume', 'retry_count',
  'information_complexity', 'exposed_tool_count', 'source_count', 'simultaneous_failure_count', 'open_hypothesis_count',
  'subagent_observation_comprehension', 'post_compaction_success',
  'model_switch_rehydration_success',
])

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function freeze(value) { if (Array.isArray(value)) return Object.freeze(value.map(freeze)); if (isObject(value)) { for (const child of Object.values(value)) freeze(child); return Object.freeze(value) }; return value }
function fail(message) { throw new Error(`CONTRACT_INVALID:qualification:${message}`) }
function walkForbidden(value, path = '') {
  if (Array.isArray(value)) return value.flatMap((item, index) => walkForbidden(item, `${path}[${index}]`))
  if (!isObject(value)) return []
  const hits = []
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.has(key)) hits.push(`${path}.${key}`)
    hits.push(...walkForbidden(child, `${path}.${key}`))
  }
  return hits
}
function pathWithinScope(path, scope) {
  return scope.some((pattern) => pattern === '**' || pattern === path || (pattern.endsWith('/**') && (path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2)))))
}

/** Discovery is a bounded policy over an already-granted OpenCode surface. */
export function createDiscoveryPolicy({ strategy = 'grep→read', granted_tools = [], authorized_scope = ['**'], bounds = {} } = {}) {
  if (!DISCOVERY_STRATEGIES.includes(strategy)) fail('unknown discovery strategy')
  if (!Array.isArray(granted_tools) || !Array.isArray(authorized_scope) || granted_tools.some((tool) => typeof tool !== 'string') || authorized_scope.some((path) => typeof path !== 'string')) fail('discovery grants and scope must be arrays of strings')
  const requiredTools = strategy.split('→')
  if (requiredTools.some((tool) => !granted_tools.includes(tool))) fail('discovery strategy requests an ungranted OpenCode tool')
  const normalizedBounds = { max_results_per_step: 20, max_files_per_step: 5, max_symbols_per_step: 20, max_open_hypotheses: 3, max_consecutive_steps_without_new_evidence: 2, ...bounds }
  if (Object.values(normalizedBounds).some((value) => !Number.isInteger(value) || value < 1)) fail('discovery bounds must be positive integers')
  return freeze({ contract: 'ecosystem.discovery-policy.v1', strategy, granted_tools: [...granted_tools], authorized_scope: [...authorized_scope], bounds: normalizedBounds, parallel_full_repository_index: false })
}

export function acceptDiscoveryResult(policy, { paths = [], new_evidence_count = 0 } = {}) {
  if (!policy || policy.contract !== 'ecosystem.discovery-policy.v1') fail('discovery policy required')
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || !pathWithinScope(path, policy.authorized_scope))) return { accepted: false, code: 'DISCOVERY_SCOPE_EXPANSION_BLOCKED' }
  if (!Number.isInteger(new_evidence_count) || new_evidence_count < 0) fail('new_evidence_count must be a non-negative integer')
  return freeze({ accepted: true, code: 'DISCOVERY_RESULT_ACCEPTED', paths: paths.slice(0, policy.bounds.max_files_per_step), new_evidence_count, should_stop: new_evidence_count === 0 })
}

/** Bounded decomposition preserves the original task's authority and scope. */
export function decomposeAuthorizedTask({ task_id, scope = [], permissions = [], subtasks = [], depth = 0, max_depth = 1, max_subtasks = 8 } = {}) {
  if (!task_id || !Array.isArray(scope) || !Array.isArray(permissions) || !Array.isArray(subtasks)) fail('task decomposition requires task_id, scope, permissions, and subtasks')
  if (depth >= max_depth || subtasks.length > max_subtasks) fail('task decomposition bound exceeded')
  const result = subtasks.map((subtask, index) => {
    if (!isObject(subtask) || !Array.isArray(subtask.scope) || !Array.isArray(subtask.permissions)) fail(`subtask ${index} is invalid`)
    if (subtask.scope.some((path) => !pathWithinScope(path, scope)) || subtask.permissions.some((permission) => !permissions.includes(permission))) fail(`subtask ${index} expands parent authority`)
    return { subtask_id: String(subtask.subtask_id || `${task_id}.${index + 1}`), scope: [...subtask.scope], permissions: [...subtask.permissions], task: String(subtask.task || '') }
  })
  return freeze({ contract: 'ecosystem.bounded-decomposition.v1', parent_task_id: String(task_id), depth, max_depth, max_subtasks, original_scope: [...scope], original_permissions: [...permissions], subtasks: result, final_verifier: 'ORIGINAL_TASK_VERIFIER' })
}

export const DEFAULT_QUALIFICATION_CASES = Object.freeze([
  { case_id: 'grep-observation', dimension: 'tool-observation', tool_class: 'grep', task_role: 'TOOL_USE' },
  { case_id: 'read-observation', dimension: 'tool-observation', tool_class: 'read', task_role: 'TOOL_USE' },
  { case_id: 'compiler-failure', dimension: 'failure-recovery', tool_class: 'bash', task_role: 'BUILD' },
  { case_id: 'permission-denial', dimension: 'governance-semantics', tool_class: 'write', task_role: 'BUILD' },
  { case_id: 'timeout', dimension: 'failure-recovery', tool_class: 'bash', task_role: 'RESEARCH' },
  { case_id: 'partial-truncation', dimension: 'observation-completeness', tool_class: 'grep', task_role: 'TOOL_USE' },
  { case_id: 'stale-read', dimension: 'freshness', tool_class: 'read', task_role: 'BUILD' },
  { case_id: 'parallel-correlation', dimension: 'parallel-observation', tool_class: 'read', task_role: 'TOOL_USE' },
  { case_id: 'unknown-mcp', dimension: 'unknown-tool', tool_class: 'mcp.unknown', task_role: 'RESEARCH' },
  { case_id: 'subagent-result', dimension: 'delegation-observation', tool_class: 'task', task_role: 'REVIEW' },
])

export function createFrozenQualificationCorpora({ derivation_cases = DEFAULT_QUALIFICATION_CASES.slice(0, 6), holdout_cases = DEFAULT_QUALIFICATION_CASES.slice(6), version = '1.0.0' } = {}) {
  if (!Array.isArray(derivation_cases) || !Array.isArray(holdout_cases) || derivation_cases.length === 0 || holdout_cases.length === 0) fail('derivation and holdout cases are both required')
  const ids = [...derivation_cases, ...holdout_cases].map((item) => item.case_id)
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) fail('corpus case ids must be unique')
  const make = (kind, cases) => ({ contract: QUALIFICATION_RUNNER_CONTRACT, kind, version, cases: cases.map((item) => ({ ...item })), fingerprint: fingerprint({ kind, version, cases }) })
  return freeze({ contract: QUALIFICATION_RUNNER_CONTRACT, version, derivation: make('DERIVATION_CORPUS', derivation_cases), holdout: make('CONFIRMATORY_HOLDOUT_CORPUS', holdout_cases), fingerprint: fingerprint({ version, derivation_cases, holdout_cases }) })
}

export function createQualificationPlan({ identity, corpora = createFrozenQualificationCorpora(), model, harness_fingerprint, verifier_version, granted_tools = [], repetitions = 1, max_rows = 128, arms = ['generic', 'candidate'], candidate_fingerprint = null } = {}) {
  if (!isObject(identity)) fail('identity is required')
  createQualificationIdentity(identity)
  if (!isObject(model) || typeof model.provider !== 'string' || typeof model.model !== 'string') fail('model is required')
  if (typeof harness_fingerprint !== 'string' || typeof verifier_version !== 'string') fail('harness_fingerprint and verifier_version are required')
  if (!Array.isArray(granted_tools) || granted_tools.some((tool) => typeof tool !== 'string')) fail('granted_tools must be strings')
  if (!Array.isArray(arms) || arms.length === 0 || arms.some((arm) => typeof arm !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(arm))) fail('arms must be non-empty identifier strings')
  if (arms.includes('candidate') && (typeof candidate_fingerprint !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/u.test(candidate_fingerprint))) fail('candidate arm requires a frozen candidate_fingerprint')
  if (arms.includes('generic') && candidate_fingerprint && typeof candidate_fingerprint !== 'string') fail('candidate_fingerprint must be a string')
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) fail('repetitions must be 1..20')
  const rows = []
  for (const mode of QUALIFICATION_MODES) {
    const corpus = mode === 'DERIVATION_CORPUS' ? corpora.derivation : corpora.holdout
    for (let repetition = 1; repetition <= repetitions; repetition += 1) for (const [caseIndex, testCase] of corpus.cases.entries()) {
      const counterbalancedArms = (caseIndex + repetition + (mode === 'CONFIRMATORY_HOLDOUT_CORPUS' ? 1 : 0)) % 2 === 0
        ? arms
        : [...arms].reverse()
      for (const arm of counterbalancedArms) {
        rows.push({ sequence: rows.length, mode, arm, corpus_fingerprint: corpus.fingerprint, case_id: testCase.case_id, model: { ...model }, repetition, granted_tools: [...granted_tools] })
      }
    }
  }
  if (rows.length > max_rows) fail('planned rows exceed bound')
  return freeze({ contract: QUALIFICATION_RUNNER_CONTRACT, version: QUALIFICATION_RUNNER_VERSION, identity: { ...identity }, corpora, model: { ...model }, harness_fingerprint, verifier_version, granted_tools: [...granted_tools], repetitions, arms: [...arms], candidate_fingerprint, rows, fingerprint: fingerprint({ version: QUALIFICATION_RUNNER_VERSION, corpora: corpora.fingerprint, rows, harness_fingerprint, verifier_version, candidate_fingerprint }) })
}

function metricForRecords(records, name, { lower_is_better = false } = {}) {
  const values = records.map((record) => record.metrics?.[name]).filter((value) => typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
  const sampleCount = values.length
  const successes = values.filter((value) => lower_is_better ? value === 0 : (value === true || value === 1)).length
  return createCapabilityMetric({ sample_count: sampleCount, success_count: successes })
}

export function calculateQualificationMetrics(records = []) {
  const byMode = {}
  for (const mode of QUALIFICATION_MODES) {
    const rows = records.filter((record) => record.mode === mode)
    const capabilities = {}
    for (const name of METRICS) capabilities[name] = metricForRecords(rows, name, { lower_is_better: ['unnecessary_tool_calls', 'invalid_tool_calls', 'fabricated_result_count', 'cross_result_contamination', 'irrelevant_context'].includes(name) })
    byMode[mode] = { sample_count: rows.length, verified_success_count: rows.filter((row) => row.verified_success === true).length, metrics: capabilities }
  }
  return freeze(byMode)
}

function normalizeSampleResult(result = {}) {
  const metrics = { ...result.metrics }
  for (const name of METRICS) if (metrics[name] === undefined && result[name] !== undefined) metrics[name] = result[name]
  return { ...result, metrics }
}

function safeObservationReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return null
  return {
    observation_id: typeof receipt.observation_id === 'string' ? receipt.observation_id : null,
    tool_call_id: typeof receipt.tool_call_id === 'string' ? receipt.tool_call_id : null,
    raw_fingerprint: typeof receipt.raw_fingerprint === 'string' ? receipt.raw_fingerprint : null,
    status: typeof receipt.status === 'string' ? receipt.status : null,
    failure_class: typeof receipt.failure_class === 'string' ? receipt.failure_class : null,
  }
}

function safeObservationInterposition(item) {
  if (!item || typeof item !== 'object') return null
  return {
    raw_observation_fingerprint: typeof item.raw_observation_fingerprint === 'string' ? item.raw_observation_fingerprint : null,
    model_facing_observation_fingerprint: typeof item.model_facing_observation_fingerprint === 'string' ? item.model_facing_observation_fingerprint : null,
    adapter_id: typeof item.adapter_id === 'string' ? item.adapter_id : null,
    adapter_version: typeof item.adapter_version === 'string' ? item.adapter_version : null,
    lossiness: typeof item.lossiness === 'string' ? item.lossiness : null,
    truncated: item.truncated === true,
    source: typeof item.source === 'string' ? item.source : null,
    provenance: typeof item.provenance === 'string' ? item.provenance : null,
    tool_call_id: typeof item.tool_call_id === 'string' ? item.tool_call_id : null,
    interposed_before_model: item.interposed_before_model === true,
    adapter_mode: typeof item.adapter_mode === 'string' ? item.adapter_mode : null,
    protocol_preserved: item.protocol_preserved === true,
    output_before: item.output_before && typeof item.output_before === 'object' ? {
      title: typeof item.output_before.title === 'string' ? item.output_before.title : null,
      output_hash: typeof item.output_before.output_hash === 'string' ? item.output_before.output_hash : null,
      output_length: Number.isFinite(item.output_before.output_length) ? item.output_before.output_length : null,
      metadata: item.output_before.metadata && typeof item.output_before.metadata === 'object' ? {
        hash: typeof item.output_before.metadata.hash === 'string' ? item.output_before.metadata.hash : null,
        keys: Array.isArray(item.output_before.metadata.keys) ? item.output_before.metadata.keys.filter((key) => typeof key === 'string') : [],
      } : null,
    } : null,
    output_after: item.output_after && typeof item.output_after === 'object' ? {
      title: typeof item.output_after.title === 'string' ? item.output_after.title : null,
      output_hash: typeof item.output_after.output_hash === 'string' ? item.output_after.output_hash : null,
      output_length: Number.isFinite(item.output_after.output_length) ? item.output_after.output_length : null,
      metadata: item.output_after.metadata && typeof item.output_after.metadata === 'object' ? {
        hash: typeof item.output_after.metadata.hash === 'string' ? item.output_after.metadata.hash : null,
        keys: Array.isArray(item.output_after.metadata.keys) ? item.output_after.metadata.keys.filter((key) => typeof key === 'string') : [],
      } : null,
    } : null,
    tool_execution_latency_ms: Number.isFinite(item.tool_execution_latency_ms) ? item.tool_execution_latency_ms : null,
    adapter_latency_ms: Number.isFinite(item.adapter_latency_ms) ? item.adapter_latency_ms : null,
    hook_latency_ms: Number.isFinite(item.hook_latency_ms) ? item.hook_latency_ms : null,
  }
}

export function createFixtureQualificationExecutor(execute) {
  if (typeof execute !== 'function') fail('fixture executor callback required')
  return freeze({ kind: 'fixture', provenance: 'deterministic-fixture', execute })
}

/** Explicit live seam; callers must provide the canonical provider marker. */
export function createLiveQualificationExecutor({ execute, metadata } = {}) {
  if (typeof execute !== 'function') fail('live executor callback required')
  if (!isObject(metadata) || metadata.canonical_runtime_entry !== true
    || metadata.provider_executor_contract !== 'ecosystem.provider-executor.v1'
    || typeof metadata.provider !== 'string' || typeof metadata.model !== 'string') {
    fail('live executor requires canonical runtime/provider metadata')
  }
  return Object.freeze({ kind: 'canonical-live', provenance: 'canonical-opencode-runtime', metadata: { ...metadata }, execute })
}

export async function runQualification({ plan, executor, mode = null, concurrency = 1 } = {}) {
  if (!plan || plan.contract !== QUALIFICATION_RUNNER_CONTRACT) fail('qualification plan required')
  if (!executor || !['fixture', 'canonical-live'].includes(executor.kind) || typeof executor.execute !== 'function') fail('fixture or canonical live executor required')
  if (executor.kind === 'canonical-live' && (!executor.metadata || executor.metadata.provider !== plan.model.provider || executor.metadata.model !== plan.model.model)) fail('live executor identity mismatch')
  if (mode && !QUALIFICATION_MODES.includes(mode)) fail('invalid execution mode')
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) fail('concurrency must be 1..2')
  const records = []
  const executeRow = async (row) => {
    const testCase = [...plan.corpora.derivation.cases, ...plan.corpora.holdout.cases].find((item) => item.case_id === row.case_id)
    let result
    try {
      result = normalizeSampleResult(await executor.execute({ ...row, test_case: testCase }))
    } catch (error) {
      result = { verified_success: false, failure_class: 'MODEL_FAILURE', error: error instanceof Error ? error.message : String(error), metrics: {} }
    }
    const exposed = Array.isArray(result.exposed_tools) ? result.exposed_tools : row.granted_tools
    if (exposed.some((tool) => !row.granted_tools.includes(tool))) fail(`candidate exposed ungranted tool ${exposed.find((tool) => !row.granted_tools.includes(tool))}`)
    const record = freeze({
      contract: QUALIFICATION_RUNNER_CONTRACT,
      plan_fingerprint: plan.fingerprint,
      corpus_fingerprint: row.corpus_fingerprint,
      mode: row.mode,
      sequence: row.sequence,
      case_id: row.case_id,
      repetition: row.repetition,
      arm: row.arm,
      candidate_fingerprint: plan.candidate_fingerprint,
      provider: row.model.provider,
      model: row.model.model,
      granted_tools: [...row.granted_tools],
      exposed_tools: [...exposed],
      metrics: Object.fromEntries(METRICS.map((name) => [name, result.metrics?.[name] ?? null])),
      verified_success: result.verified_success === true,
      functional_correctness: result.functional_correctness ?? result.verified_success === true,
      failure_class: result.failure_class || null,
      raw_observation_receipt: safeObservationReceipt(result.raw_observation_receipt),
      canonical_verifier: result.canonical_verifier === true,
      canonical_runtime_entry: result.canonical_runtime_entry === true,
      live_model_evidence: result.live_model_evidence === true,
      paid_calls: Number.isInteger(result.paid_calls) ? result.paid_calls : 0,
      fallback_used: result.fallback_used === true,
      profile_id: typeof result.profile_id === 'string' ? result.profile_id : null,
      harness_fingerprint: typeof result.harness_fingerprint === 'string' ? result.harness_fingerprint : null,
      tool_calls: Array.isArray(result.tool_calls) ? result.tool_calls.map((call) => ({
        tool: typeof call.tool === 'string' ? call.tool : null,
        call_id: typeof call.call_id === 'string' ? call.call_id : null,
        argument_valid: call.argument_valid === true,
        argument_diagnostic: typeof call.argument_diagnostic === 'string' ? call.argument_diagnostic : null,
        status: typeof call.status === 'string' ? call.status : null,
      })) : [],
      observation_receipts: Array.isArray(result.observation_receipts) ? result.observation_receipts.map(safeObservationReceipt) : [],
      observation_interposition: Array.isArray(result.observation_interposition) ? result.observation_interposition.map(safeObservationInterposition).filter(Boolean) : [],
      model_facing_observation: result.model_facing_observation && typeof result.model_facing_observation === 'object'
        ? { derived: result.model_facing_observation.derived === true, lossiness: result.model_facing_observation.lossiness || null, truncated: result.model_facing_observation.truncated === true, provenance_preserved: result.model_facing_observation.provenance_preserved === true }
        : null,
      verifier_result: result.verifier_result && typeof result.verifier_result === 'object'
        ? { ok: result.verifier_result.ok === true, code: typeof result.verifier_result.code === 'string' ? result.verifier_result.code : null }
        : null,
      context_volume: Number.isFinite(result.context_volume) ? result.context_volume : null,
      raw_result_volume: Number.isFinite(result.raw_result_volume) ? result.raw_result_volume : null,
      adapted_result_volume: Number.isFinite(result.adapted_result_volume) ? result.adapted_result_volume : null,
      retry_count: Number.isInteger(result.retry_count) ? result.retry_count : 0,
      retained: true,
      latency_ms: Number.isFinite(result.latency_ms) ? result.latency_ms : null,
    })
    return record
  }
  const rows = plan.rows.filter((item) => !mode || item.mode === mode)
  for (let index = 0; index < rows.length; index += concurrency) {
    const batch = await Promise.all(rows.slice(index, index + concurrency).map(executeRow))
    records.push(...batch)
  }
  return freeze({ contract: QUALIFICATION_RUNNER_CONTRACT, plan: { fingerprint: plan.fingerprint, candidate_fingerprint: plan.candidate_fingerprint, arms: [...plan.arms] }, plan_fingerprint: plan.fingerprint, corpus_fingerprints: { derivation: plan.corpora.derivation.fingerprint, holdout: plan.corpora.holdout.fingerprint }, records, metrics: calculateQualificationMetrics(records) })
}

export function deriveCandidateFromEvidence({ qualification, profile_id, granted_tools = [], candidate_tools = [], discovery_strategy = null } = {}) {
  if (!qualification || !Array.isArray(qualification.records)) fail('qualification evidence required')
  const forbidden = walkForbidden({ profile_id, candidate_tools, discovery_strategy })
  if (forbidden.length) fail(`candidate contains authority field(s): ${forbidden.join(', ')}`)
  const safeTools = candidate_tools.filter((tool) => granted_tools.includes(tool))
  const evidence = qualification.metrics?.DERIVATION_CORPUS || {}
  const obs = evidence.metrics?.observation_status_comprehension
  const policy = obs && obs.sample_count > 0 && obs.claim === false
    ? { result_policy: { observation_profile: 'STRUCTURED_COMPACT', explicit_status: true, explicit_provenance: true } }
    : { result_policy: { observation_profile: 'RAW_RICH' } }
  const candidate = {
    contract: 'ecosystem.empirical-harness-candidate.v1',
    status: 'candidate',
    profile_id: String(profile_id || 'empirical-candidate'),
    policy,
    candidate_tools: safeTools,
    hidden_tools: granted_tools.filter((tool) => !safeTools.includes(tool)),
    discovery_strategy: discovery_strategy && DISCOVERY_STRATEGIES.includes(discovery_strategy) ? discovery_strategy : 'grep→read',
    source_corpus_fingerprint: qualification.corpus_fingerprints.derivation,
    candidate_fingerprint: fingerprint({ policy, candidate_tools: safeTools, discovery_strategy: discovery_strategy && DISCOVERY_STRATEGIES.includes(discovery_strategy) ? discovery_strategy : 'grep→read', source: qualification.corpus_fingerprints.derivation }),
    authority_unchanged: true,
  }
  return freeze(candidate)
}

export function evaluateHoldoutConfirmation({ candidate, qualification, holdout_qualification, security_regression = false, core_regression = false } = {}) {
  if (!candidate || candidate.status !== 'candidate') fail('candidate lock required')
  if (!qualification || !holdout_qualification) fail('derivation and holdout evidence required')
  if (candidate.source_corpus_fingerprint !== qualification.corpus_fingerprints.derivation) fail('candidate derivation corpus mismatch')
  if (holdout_qualification.plan?.candidate_fingerprint && holdout_qualification.plan.candidate_fingerprint !== candidate.candidate_fingerprint) fail('holdout candidate fingerprint mismatch')
  if (holdout_qualification.corpus_fingerprints.holdout === candidate.source_corpus_fingerprint) fail('holdout must be independent from derivation corpus')
  const holdoutRows = holdout_qualification.records.filter((row) => row.mode === 'CONFIRMATORY_HOLDOUT_CORPUS')
  const genericRows = holdoutRows.filter((row) => row.arm === 'generic')
  const candidateRows = holdoutRows.filter((row) => row.arm === 'candidate')
  const genericByKey = new Map(genericRows.map((row) => [`${row.case_id}|${row.repetition}`, row]))
  const pairs = candidateRows.map((row) => ({ candidate: row, generic: genericByKey.get(`${row.case_id}|${row.repetition}`) })).filter((pair) => pair.generic)
  const verified = candidateRows.filter((row) => row.verified_success).length
  const genericVerified = genericRows.filter((row) => row.verified_success).length
  const candidateWins = pairs.filter((pair) => pair.candidate.verified_success && !pair.generic.verified_success).length
  const candidateLosses = pairs.filter((pair) => !pair.candidate.verified_success && pair.generic.verified_success).length
  const noRegression = !security_regression && !core_regression
  return freeze({
    candidate_fingerprint: candidate.candidate_fingerprint,
    holdout_corpus_fingerprint: holdout_qualification.corpus_fingerprints.holdout,
    holdout_sample_count: pairs.length,
    holdout_verified_success_count: verified,
    generic_verified_success_count: genericVerified,
    candidate_wins: candidateWins,
    candidate_losses: candidateLosses,
    complete_pairs: pairs.length > 0 && pairs.length * 2 === genericRows.length + candidateRows.length,
    holdout_confirmation_pass: pairs.length > 0 && pairs.length * 2 === genericRows.length + candidateRows.length && noRegression && candidateLosses === 0 && verified >= genericVerified,
    security_regression,
    core_regression,
  })
}

export function deriveEmpiricalCapabilityRecord({ identity, qualification, evidence_status = 'COMPLETE' } = {}) {
  if (!qualification) fail('qualification evidence required')
  const metrics = {}
  for (const [mode, summary] of Object.entries(qualification.metrics || {})) metrics[mode] = summary.metrics
  return createEmpiricalCapabilityRecord({ identity, evidence_status, capabilities: { EMPIRICAL_TOOL_CALL_CAPABILITIES: metrics.DERIVATION_CORPUS || {}, EMPIRICAL_TOOL_OBSERVATION_CAPABILITIES: metrics.CONFIRMATORY_HOLDOUT_CORPUS || {} } })
}

export const QUALIFICATION_METRICS = METRICS
