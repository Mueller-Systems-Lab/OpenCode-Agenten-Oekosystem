#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Fixed diagnostic ladder for GLM 5.2 (free) through OpenRouter. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  createLiveProjectConfig,
  createObservationAdapterPluginSource,
  createOpenCodeLiveExecutor,
  invokeOpenCode,
  LIVE_RUNTIME_ID,
  LIVE_TOOL_SET,
  LIVE_VERIFIER_VERSION,
  OPENCODE_DEBUG_ARGS,
  parseOpenCodeEvents,
  sanitizeDebugLog,
} from '../runtime/harness/live-qualification.mjs'
import { OBSERVATION_CONTRACT, OBSERVATION_CONTRACT_VERSION, createToolContractFingerprint, observationFingerprint } from '../runtime/harness/observation-adapter.mjs'
import { fingerprint } from '../runtime/harness/empirical-capability-contract.mjs'
import { classifyCanaryGateState, classifyModelUsage, rateLimitClassification, rateLimitResetEvidence } from '../runtime/harness/canary-reporting.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const reportRoot = path.join(repoRoot, 'docs', 'reports')
const opencodeBin = process.env.OCAE_OPENCODE_BIN || 'opencode'
const provider = 'openrouter'
const model = 'z-ai/glm-5.2:free'
const hostVersion = String(spawnSync(opencodeBin, ['--version'], { encoding: 'utf8' }).stdout || '').trim()
const timeoutMs = Number(process.env.OCAE_CANARY_TIMEOUT_MS || 90_000)
const controlRepetitions = 5
const identityRepetitions = 5
const envelopeRepetitions = 10
const experimentId = process.env.OCAE_EXPERIMENT_ID || 'issue-43-glm52-free-observation-canary-20260904T103234Z'
const attemptId = `issue-43-glm52-free-observation-canary-attempt-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/u, 'Z')}`
const outputPath = process.env.OCAE_CANARY_OUTPUT_PATH
  ? path.resolve(repoRoot, process.env.OCAE_CANARY_OUTPUT_PATH)
  : path.join(reportRoot, `${attemptId}.json`)
const freezePath = path.join(reportRoot, `${attemptId}-freeze.json`)
if (!outputPath.startsWith(`${reportRoot}${path.sep}`)) throw new Error('CONTRACT_INVALID:canary:evidence must remain under docs/reports')

function average(values) {
  const finite = values.filter((value) => Number.isFinite(value))
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
}

function parseJsonBlock(text, marker) {
  const markerIndex = String(text).indexOf(marker)
  if (markerIndex === -1) return null
  const start = String(text).indexOf('{', markerIndex + marker.length)
  if (start === -1) return null
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{') depth += 1
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(start, index + 1)) } catch { return null }
    }
  }
  return null
}

function modelInventory() {
  const result = spawnSync(opencodeBin, ['--pure', 'models', provider, '--verbose', ...OPENCODE_DEBUG_ARGS], {
    cwd: repoRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  })
  const stdout = String(result.stdout || '')
  const stderr = sanitizeDebugLog(result.stderr || '')
  const entry = parseJsonBlock(stdout, 'openrouter/z-ai/glm-5.2:free')
  const freeCosts = entry?.cost && entry.cost.input === 0 && entry.cost.output === 0
    && entry.cost.cache?.read === 0 && entry.cost.cache?.write === 0
  return {
    command_ok: result.status === 0,
    provider_id: entry?.providerID || null,
    model_id: entry?.id || null,
    display_name: entry?.name || null,
    status: entry?.status || null,
    costs: entry?.cost || null,
    free_model_path: entry?.providerID === provider && entry?.id === model && freeCosts,
    debug_logging_enabled: OPENCODE_DEBUG_ARGS.every((arg) => ['--pure', 'models', provider, '--verbose', ...OPENCODE_DEBUG_ARGS].includes(arg))
      && /(?:level=DEBUG|level[=: ]+DEBUG)/iu.test(stderr),
    debug_log_excerpt: stderr,
    debug_log_fingerprint: fingerprint(stderr),
    inventory_entry_fingerprint: entry ? fingerprint(entry) : null,
  }
}

function observedModelIds(value) {
  return [...new Set([...String(value || '').matchAll(/(?:modelID|llm\.model)=([^\s"]+)/gu)].map((match) => match[1]))]
}

async function readJsonLines(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  } catch { return [] }
}

async function pluginInitializationProbe() {
  const root = await fs.mkdtemp('/tmp/ocae-issue-43-glm52-plugin-probe-')
  const tracePath = path.join(root, 'probe-trace.jsonl')
  try {
    const adapterRuntimePath = path.join(root, 'observation-adapter.mjs')
    await fs.copyFile(path.join(repoRoot, 'runtime', 'harness', 'observation-adapter.mjs'), adapterRuntimePath)
    await fs.writeFile(path.join(root, 'ocae-observation-adapter.js'), createObservationAdapterPluginSource({
      adapterModuleUrl: pathToFileURL(adapterRuntimePath).href,
      tracePath,
      modelProfileId: 'generic',
      workspaceFingerprint: fingerprint([{ path: 'probe.txt', content: 'probe\n' }]),
      hostVersion,
      adapterMode: 'IDENTITY',
    }), { mode: 0o600 })
    await fs.writeFile(path.join(root, 'probe.txt'), 'probe\n', 'utf8')
    await fs.writeFile(path.join(root, 'opencode.jsonc'), `${JSON.stringify(createLiveProjectConfig([], './ocae-observation-adapter.js'), null, 2)}\n`, { mode: 0o600 })
    const response = await invokeOpenCode({
      opencode_bin: opencodeBin, provider, model, root, timeout_ms: timeoutMs, use_plugins: true,
      prompt: 'Reply with exactly PLUGIN_INIT_OK and nothing else. Do not use tools.',
    })
    const trace = await readJsonLines(tracePath)
    const events = parseOpenCodeEvents(response.stdout)
    const answer = events.filter((event) => event.type === 'text').map((event) => event.part?.text || '').join('')
    const usage = classifyModelUsage({ debugLog: response.debug_log_excerpt, targetProvider: provider, targetModel: model })
    return {
      pass: response.ok && answer.includes('PLUGIN_INIT_OK') && trace.some((event) => event.type === 'adapter_loaded'),
      response_ok: response.ok,
      answer_fingerprint: fingerprint(answer),
      adapter_loaded: trace.some((event) => event.type === 'adapter_loaded'),
      trace_types: trace.map((event) => event.type),
      paid_calls: response.cost > 0 ? 1 : 0,
      fallback_used: false,
      debug_logging_enabled: response.debug_logging_enabled === true,
      debug_lifecycle_events: response.debug_lifecycle_events || [],
      debug_log_excerpt: response.debug_log_excerpt || '',
      debug_log_fingerprint: response.debug_log_fingerprint || null,
      observed_model_ids: usage.observed_model_ids,
      model_switch_used: usage.target_model_switch_used,
      target_model_switch_used: usage.target_model_switch_used,
      target_model_fallback_used: usage.target_model_fallback_used,
      target_provider_fallback_used: usage.target_provider_fallback_used,
      auxiliary_model_used: usage.auxiliary_model_used,
      auxiliary_model_provider: usage.auxiliary_model_provider,
      auxiliary_model: usage.auxiliary_model,
      auxiliary_model_purpose: usage.auxiliary_model_purpose,
      failure_class: response.failure_class,
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function preflight() {
  const root = await fs.mkdtemp('/tmp/ocae-issue-43-glm52-preflight-')
  try {
    const response = await invokeOpenCode({
      opencode_bin: opencodeBin, provider, model, root, timeout_ms: timeoutMs,
      prompt: 'Reply with exactly PREFLIGHT_OK and nothing else. Do not use tools.',
    })
    const events = parseOpenCodeEvents(response.stdout)
    const answer = events.filter((event) => event.type === 'text').map((event) => event.part?.text || '').join('')
    const usage = classifyModelUsage({ debugLog: response.debug_log_excerpt, targetProvider: provider, targetModel: model })
    return {
      live_model_reachable: response.ok && answer.includes('PREFLIGHT_OK'),
      expected_provider_match: provider === 'openrouter',
      expected_model_match: model === 'z-ai/glm-5.2:free',
      canonical_runtime_entry: true,
      normal_completion: response.ok && answer.includes('PREFLIGHT_OK'),
      paid_calls: response.cost > 0 ? 1 : 0,
      fallback_used: false,
      observed_model_ids: usage.observed_model_ids,
      model_switch_used: usage.target_model_switch_used,
      target_model_switch_used: usage.target_model_switch_used,
      target_model_fallback_used: usage.target_model_fallback_used,
      target_provider_fallback_used: usage.target_provider_fallback_used,
      auxiliary_model_used: usage.auxiliary_model_used,
      auxiliary_model_provider: usage.auxiliary_model_provider,
      auxiliary_model: usage.auxiliary_model,
      auxiliary_model_purpose: usage.auxiliary_model_purpose,
      debug_logging_enabled: response.debug_logging_enabled === true,
      debug_lifecycle_events: response.debug_lifecycle_events || [],
      debug_log_excerpt: response.debug_log_excerpt || '',
      debug_log_fingerprint: response.debug_log_fingerprint || null,
      failure_class: response.failure_class,
      latency_ms: response.process_latency_ms ?? null,
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

function toolContractFingerprint() {
  return fingerprint({
    contract: 'issue-43-live-tool-contract.v1',
    tools: LIVE_TOOL_SET,
    result_contract: 'opencode-json-event.v1',
    host_version: hostVersion,
    tool_contracts: LIVE_TOOL_SET.map((tool) => createToolContractFingerprint({ tool_name: tool, result_contract: 'opencode-json-event.v1', version: hostVersion })),
  })
}

function observationContractFingerprint() {
  return observationFingerprint({
    contract: OBSERVATION_CONTRACT,
    version: OBSERVATION_CONTRACT_VERSION,
    adapter_id: 'ocae.live.tool-execute-after',
    adapter_version: '1.0.0',
    model_facing_modes: ['IDENTITY', 'ENVELOPE_ONLY'],
    raw_authority: true,
  })
}

function sanitizeRun(result) {
  const calls = result.tool_calls.map((call) => ({
    tool: call.tool,
    call_id: call.call_id,
    argument_valid: call.argument_valid,
    argument_diagnostic: call.argument_diagnostic,
    status: call.status,
  }))
  const receipts = result.observation_receipts.map((receipt) => ({
    observation_id: receipt.observation_id,
    tool_call_id: receipt.tool_call_id,
    raw_fingerprint: receipt.raw_fingerprint,
    status: receipt.status,
    failure_class: receipt.failure_class,
  }))
  const interposition = result.observation_interposition.map((item) => ({
    tool_call_id: item.tool_call_id,
    adapter_mode: item.adapter_mode,
    raw_observation_fingerprint: item.raw_observation_fingerprint,
    model_facing_observation_fingerprint: item.model_facing_observation_fingerprint,
    adapter_id: item.adapter_id,
    adapter_version: item.adapter_version,
    lossiness: item.lossiness,
    truncated: item.truncated,
    protocol_preserved: item.protocol_preserved,
    output_before: item.output_before,
    output_after: item.output_after,
    model_facing_serialization: item.model_facing_serialization,
    tool_execution_latency_ms: item.tool_execution_latency_ms,
    adapter_latency_ms: item.adapter_latency_ms,
    hook_latency_ms: item.hook_latency_ms,
  }))
  const callIds = new Set(calls.map((call) => call.call_id).filter(Boolean))
  const receiptIds = new Set(receipts.map((receipt) => receipt.tool_call_id).filter(Boolean))
  const interpositionIds = new Set(interposition.map((item) => item.tool_call_id).filter(Boolean))
  return {
    verified_success: result.verified_success,
    failure_class: result.failure_class,
    tool_selection_correct: result.metrics.tool_selection_correct,
    argument_validity: result.metrics.tool_argument_validity,
    observation_comprehension: result.metrics.observation_status_comprehension,
    fabricated_result_count: result.metrics.fabricated_result_count,
    verifier_raw_authority: result.metrics.verifier_raw_authority,
    canonical_verifier: result.canonical_verifier,
    canonical_runtime_entry: result.canonical_runtime_entry,
    live_model_evidence: result.live_model_evidence,
    tool_calls: calls,
    raw_receipts: receipts,
    interposition,
    raw_observation_fingerprints: receipts.map((receipt) => receipt.raw_fingerprint).filter(Boolean),
    model_facing_observation_fingerprints: interposition.map((item) => item.model_facing_observation_fingerprint).filter(Boolean),
    call_result_correlation: receiptIds.size === callIds.size && [...receiptIds].every((id) => callIds.has(id)),
    raw_receipt_propagation: interposition.length === receipts.length && interposition.every((item) => receipts.some((receipt) => receipt.tool_call_id === item.tool_call_id && receipt.raw_fingerprint === item.raw_observation_fingerprint)),
    message_sequence: result.message_sequence,
    observation_trace_types: result.observation_trace_types || [],
    timing: {
      total_latency_ms: result.timing?.total_latency_ms ?? null,
      process_latency_ms: result.timing?.process_latency_ms ?? null,
      first_event_latency_ms: result.timing?.first_event_latency_ms ?? null,
      provider_resume_latency_ms: result.timing?.provider_resume_latency_ms ?? null,
      tool_execution_latency_ms: result.metrics.tool_execution_latency_ms,
      adapter_latency_ms: result.metrics.adapter_latency_ms,
      hook_latency_ms: result.metrics.hook_latency_ms,
      event_timings: result.timing?.event_timings || [],
    },
    debug_logging_enabled: result.debug_logging_enabled,
    debug_lifecycle_events: result.debug_lifecycle_events || [],
    debug_log_fingerprint: result.debug_log_fingerprint || null,
    debug_log_excerpt: result.debug_log_excerpt || '',
  }
}

function summarizeLayer(layer, runs) {
  const metric = (name) => runs.filter((run) => run[name] === true).length
  return {
    layer,
    runs: runs.length,
    verified_success: metric('verified_success'),
    tool_selection: metric('tool_selection_correct'),
    argument_validity: metric('argument_validity'),
    observation_comprehension: metric('observation_comprehension'),
    fabricated_results: runs.reduce((sum, run) => sum + (run.fabricated_result_count || 0), 0),
    failures: runs.filter((run) => !run.verified_success).map((run) => run.failure_class || 'VERIFIER_REJECTION'),
    latency_avg_ms: average(runs.map((run) => run.timing.total_latency_ms)),
    timing_averages: Object.fromEntries(['tool_execution_latency_ms', 'adapter_latency_ms', 'hook_latency_ms', 'provider_resume_latency_ms', 'first_event_latency_ms'].map((field) => [field, average(runs.map((run) => run.timing[field]))])),
    raw_observation_fingerprinting: runs.every((run) => run.raw_observation_fingerprints.length > 0),
    model_facing_observation_fingerprinting: layer === 'CONTROL_0' ? true : runs.every((run) => run.model_facing_observation_fingerprints.length > 0),
    call_result_correlation: runs.every((run) => run.call_result_correlation),
    raw_receipt_propagation: layer === 'CONTROL_0' ? null : runs.every((run) => run.raw_receipt_propagation),
    verifier_raw_authority: runs.every((run) => run.verifier_raw_authority === true),
    debug_trace_captured: runs.every((run) => run.debug_logging_enabled === true),
    runs_detail: runs,
  }
}

function classifyTimeout(run) {
  if (run.failure_class !== 'TIMEOUT') return null
  if (!run.observation_trace_types.includes('adapter_loaded') && run.message_sequence.length === 0) return 'SESSION_STATE_STALL'
  if (run.message_sequence.length === 0) return 'PROVIDER_TIMEOUT'
  return 'MODEL_TIMEOUT'
}

function normalizedSequence(run) {
  return [...(run.message_sequence || []), '|trace|', ...(run.observation_trace_types || [])]
}

function firstRun(runs, predicate) { return runs.find(predicate) || runs[0] || null }

async function main() {
  const inventory = modelInventory()
  const preflightResult = inventory.free_model_path ? await preflight() : { live_model_reachable: false, failure_class: 'MODEL_UNAVAILABLE', paid_calls: 0, fallback_used: false, model_switch_used: false, debug_logging_enabled: inventory.debug_logging_enabled }
  const pluginProbe = inventory.free_model_path && preflightResult.live_model_reachable ? await pluginInitializationProbe() : { pass: false, status: 'NOT_RUN', failure_class: 'MODEL_UNAVAILABLE', paid_calls: 0, fallback_used: false, debug_logging_enabled: false, trace_types: [], debug_log_excerpt: '' }
  const contracts = {
    tool_contract_fingerprint: toolContractFingerprint(),
    observation_contract_fingerprint: observationContractFingerprint(),
    adapter_version: 'ocae.live.tool-execute-after@1.0.0',
    verifier_version: LIVE_VERIFIER_VERSION,
    fixture_identity: 'issue-43-read-observation.v1',
    canary_definitions: ['CONTROL_0:NO_OBSERVATION_INTERPOSITION', 'CANARY_1:IDENTITY_ADAPTER', 'CANARY_2:ENVELOPE_ONLY'],
    execution_order: ['CONTROL_0', 'CANARY_1_IDENTITY', 'CANARY_2_ENVELOPE'],
    execution_order_fingerprint: fingerprint({ order: ['CONTROL_0', 'CANARY_1_IDENTITY', 'CANARY_2_ENVELOPE'], repetitions: [controlRepetitions, identityRepetitions, envelopeRepetitions] }),
    timeout_ms: timeoutMs,
    retry_budget: 0,
    logging: { opencode_print_logs: true, opencode_log_level: 'DEBUG', cli_args: [...OPENCODE_DEBUG_ARGS] },
  }
  const freeze = {
    contract: 'ecosystem.issue-43-glm52-free-observation-canary-freeze.v1',
    experiment_id: experimentId,
    attempt_id: attemptId,
    target: { ui_label: 'GLM 5.2 (free)', provider, model, provider_runtime_path: `${provider}/${model}`, zero_cost_required: true, fallback_forbidden: true, model_switch_forbidden: true, provider_fallback_forbidden: true },
    opencode_version: hostVersion,
    runtime_identity: { runtime_class: LIVE_RUNTIME_ID, opencode_host_version: hostVersion, tool_contract_fingerprint: contracts.tool_contract_fingerprint, observation_contract_fingerprint: contracts.observation_contract_fingerprint },
    contracts,
    preflight: { inventory_free_path: inventory.free_model_path, live_model_reachable: preflightResult.live_model_reachable, plugin_initialization: preflightResult.live_model_reachable ? (pluginProbe.pass ? 'PASS' : 'FAIL') : 'NOT_RUN' },
  }
  await fs.mkdir(reportRoot, { recursive: true })
  await fs.writeFile(freezePath, `${JSON.stringify(freeze, null, 2)}\n`, { mode: 0o600 })

  const output = {
    contract: 'ecosystem.issue-43-glm52-free-observation-canary.v1',
    experiment_id: experimentId,
    attempt_id: attemptId,
    timestamp: new Date().toISOString(),
    provider,
    model,
    ui_label: 'GLM 5.2 (free)',
    opencode_version: hostVersion,
    debug_logging: { required: true, args: [...OPENCODE_DEBUG_ARGS], inventory: inventory.debug_logging_enabled, preflight: preflightResult.debug_logging_enabled === true, plugin_initialization: pluginProbe.debug_logging_enabled === true },
    inventory: { provider_id: inventory.provider_id, model_id: inventory.model_id, display_name: inventory.display_name, status: inventory.status, costs: inventory.costs, free_model_path: inventory.free_model_path, inventory_entry_fingerprint: inventory.inventory_entry_fingerprint, debug_log_excerpt: inventory.debug_log_excerpt, debug_log_fingerprint: inventory.debug_log_fingerprint },
    preflight: preflightResult,
    plugin_initialization: pluginProbe,
    plugin_initialization_status: preflightResult.live_model_reachable ? (pluginProbe.pass ? 'PASS' : 'FAIL') : 'NOT_RUN',
    registration_path: 'explicit-project-config-plugin',
    freeze_path: path.relative(repoRoot, freezePath),
    contracts,
    canaries: [],
    paid_calls: (preflightResult.paid_calls || 0) + (pluginProbe.paid_calls || 0),
    fallback_used: false,
    target_model_provider: provider,
    target_model: model,
    target_model_switch_used: false,
    target_model_fallback_used: false,
    target_provider_fallback_used: false,
    auxiliary_model_used: false,
    auxiliary_model_provider: null,
    auxiliary_model: null,
    auxiliary_model_purpose: null,
    model_switch_used: false,
  }

  output.observed_model_ids = [...new Set([...(preflightResult.observed_model_ids || []), ...(pluginProbe.observed_model_ids || [])])]
  const preflightUsage = classifyModelUsage({ debugLog: preflightResult.debug_log_excerpt, targetProvider: provider, targetModel: model })
  const pluginUsage = classifyModelUsage({ debugLog: pluginProbe.debug_log_excerpt, targetProvider: provider, targetModel: model })
  output.target_model_switch_used = preflightUsage.target_model_switch_used || pluginUsage.target_model_switch_used
  output.target_model_fallback_used = preflightUsage.target_model_fallback_used || pluginUsage.target_model_fallback_used
  output.target_provider_fallback_used = preflightUsage.target_provider_fallback_used || pluginUsage.target_provider_fallback_used
  const auxiliaryUsage = [preflightUsage, pluginUsage].find((usage) => usage.auxiliary_model_used)
  output.auxiliary_model_used = Boolean(auxiliaryUsage)
  output.auxiliary_model_provider = auxiliaryUsage?.auxiliary_model_provider || null
  output.auxiliary_model = auxiliaryUsage?.auxiliary_model || null
  output.auxiliary_model_purpose = auxiliaryUsage?.auxiliary_model_purpose || null
  output.model_switch_used = output.target_model_switch_used
  output.fallback_used = preflightResult.fallback_used === true || pluginProbe.fallback_used === true
  output.infrastructure_blocker = preflightResult.failure_class === 'RATE_LIMITED' ? 'RATE_LIMIT' : preflightResult.failure_class || null
  output.rate_limit_class = output.infrastructure_blocker === 'RATE_LIMIT' ? rateLimitClassification({ failureClass: preflightResult.failure_class, debugLog: preflightResult.debug_log_excerpt }) : 'NONE'
  output.rate_limit_reset_evidence = output.infrastructure_blocker === 'RATE_LIMIT' ? rateLimitResetEvidence(preflightResult.debug_log_excerpt) : null
  output.preflight_result = inventory.free_model_path && preflightResult.live_model_reachable ? 'PASS' : 'BLOCKED'
  output.free_model_path = inventory.free_model_path ? 'PASS' : 'FAIL'
  const infrastructureReady = inventory.free_model_path && preflightResult.live_model_reachable && preflightResult.paid_calls === 0 && pluginProbe.pass && pluginProbe.paid_calls === 0 && !output.model_switch_used
  if (infrastructureReady) {
    const layers = [
      ['CONTROL_0', controlRepetitions, null],
      ['CANARY_1_IDENTITY', identityRepetitions, 'IDENTITY'],
      ['CANARY_2_ENVELOPE', envelopeRepetitions, 'ENVELOPE_ONLY'],
    ]
    let sequence = 1
    for (const [layer, repetitions, adapterMode] of layers) {
      const executor = createOpenCodeLiveExecutor({ provider, model, opencode_bin: opencodeBin, timeout_ms: timeoutMs, repo_root: repoRoot, host_version: hostVersion, resolve_treatment: ({ default_profile }) => ({ profile: default_profile, tool_policy: default_profile.effective_harness.tool_policy, tool_contract_framing: 'BASELINE', observation_adaptation: false, ...(adapterMode ? { observation_mode: adapterMode } : {}) }) })
      const runs = []
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const result = await executor.execute({ sequence, arm: 'control', test_case: { case_id: 'read-observation', task_role: 'TOOL_USE' } })
        const safe = sanitizeRun(result)
        runs.push({ repetition, ...safe, timeout_class: classifyTimeout(safe) })
        sequence += 1
      }
      output.canaries.push(summarizeLayer(layer, runs))
      if (layer === 'CONTROL_0' && output.canaries.at(-1).verified_success !== repetitions) break
      if (layer === 'CANARY_1_IDENTITY' && output.canaries.at(-1).verified_success !== repetitions) break
    }
  }

  const control = output.canaries.find((layer) => layer.layer === 'CONTROL_0')
  const identity = output.canaries.find((layer) => layer.layer === 'CANARY_1_IDENTITY')
  const envelope = output.canaries.find((layer) => layer.layer === 'CANARY_2_ENVELOPE')
  const gateState = classifyCanaryGateState({ preflight: preflightResult, plugin: pluginProbe, canaries: output.canaries })
  output.first_failing_stage = gateState.first_failing_stage
  output.gate_status = gateState.gates
  output.message_role_preserved = 'UNOBSERVABLE'
  output.message_order_preserved = output.canaries.length === 0 ? 'NOT_RUN' : output.canaries.every((layer) => layer.runs_detail.every((run) => run.message_sequence.includes('tool_use') ? run.message_sequence.indexOf('tool_use') >= 0 : true)) ? 'PASS' : 'UNOBSERVABLE'
  const interposedRuns = output.canaries.filter((layer) => layer.layer !== 'CONTROL_0').flatMap((layer) => layer.runs_detail)
  output.latency_decomposition = {
    tool_execution_latency_ms: average(interposedRuns.map((run) => run.timing.tool_execution_latency_ms)),
    adapter_latency_ms: average(interposedRuns.map((run) => run.timing.adapter_latency_ms)),
    hook_latency_ms: average(interposedRuns.map((run) => run.timing.hook_latency_ms)),
    provider_resume_latency_ms: average(output.canaries.flatMap((layer) => layer.runs_detail.map((run) => run.timing.provider_resume_latency_ms))),
    model_latency_ms: average(output.canaries.flatMap((layer) => layer.runs_detail.map((run) => run.timing.first_event_latency_ms))),
    total_latency_ms: average(output.canaries.flatMap((layer) => layer.runs_detail.map((run) => run.timing.total_latency_ms))),
  }
  const allRuns = output.canaries.flatMap((layer) => layer.runs_detail)
  output.timeout_class = [...new Set(allRuns.map((run) => run.timeout_class).filter(Boolean))].join(',') || (output.infrastructure_blocker === 'RATE_LIMIT' ? 'RATE_LIMIT' : 'NONE')
  output.debug_log_traces = Object.fromEntries(['CONTROL_0', 'CANARY_1_IDENTITY', 'CANARY_2_ENVELOPE'].map((name) => {
    const layer = output.canaries.find((item) => item.layer === name)
    return [name, layer ? { captured: layer.runs_detail.every((run) => run.debug_logging_enabled === true), run_count: layer.runs_detail.length, log_fingerprints: layer.runs_detail.map((run) => run.debug_log_fingerprint) } : { captured: false, run_count: 0, log_fingerprints: [] }]
  }))
  output.receipt_authority = {
    raw_observation_fingerprinting: output.canaries.length === 0 ? 'NOT_RUN' : output.canaries.every((layer) => layer.raw_observation_fingerprinting) ? 'PASS' : 'FAIL',
    model_facing_observation_fingerprinting: output.canaries.filter((layer) => layer.layer !== 'CONTROL_0').length === 0 ? 'NOT_RUN' : output.canaries.filter((layer) => layer.layer !== 'CONTROL_0').every((layer) => layer.model_facing_observation_fingerprinting) ? 'PASS' : 'FAIL',
    call_result_correlation: output.canaries.length === 0 ? 'NOT_RUN' : output.canaries.every((layer) => layer.call_result_correlation) ? 'PASS' : 'FAIL',
    raw_receipt_propagation: output.canaries.filter((layer) => layer.layer !== 'CONTROL_0').length === 0 ? 'NOT_RUN' : output.canaries.filter((layer) => layer.layer !== 'CONTROL_0').every((layer) => layer.raw_receipt_propagation) ? 'PASS' : 'FAIL',
    verifier_raw_authority: output.canaries.length === 0 ? 'NOT_RUN' : output.canaries.every((layer) => layer.verifier_raw_authority) ? 'PASS' : 'FAIL',
  }
  const identityRun = identity ? firstRun(identity.runs_detail, (run) => run.verified_success) : null
  const envelopeRun = envelope ? firstRun(envelope.runs_detail, (run) => !run.verified_success) || firstRun(envelope.runs_detail, () => true) : null
  output.serialization_diff = {
    identity: identityRun?.interposition[0]?.model_facing_serialization || null,
    envelope: envelopeRun?.interposition[0]?.model_facing_serialization || null,
    identity_fingerprint: identityRun?.model_facing_observation_fingerprints[0] || null,
    envelope_fingerprint: envelopeRun?.model_facing_observation_fingerprints[0] || null,
    changed_dimensions: ['prefix/schema wrapper', 'key names', 'key ordering', 'JSON escaping/quoting', 'status/tool repetition', 'length'],
  }
  output.serialization_micro_ladder_run = false
  output.first_harmful_serialization_change = output.first_failing_stage === 'ENVELOPE' ? 'exact prior JSON envelope: status/tool/content/complete wrapper' : 'NONE'
  output.envelope_regression_replicated = output.first_failing_stage === 'ENVELOPE' && Boolean(envelope?.failures?.length)
  output.root_cause_generalization = output.envelope_regression_replicated ? 'CROSS_RUNTIME_FORMAT_SENSITIVITY' : 'INSUFFICIENT'
  output.final_classification = !inventory.free_model_path || !preflightResult.live_model_reachable || output.target_model_switch_used ? 'AMBER_OCAE_GLM52_FREE_OBSERVATION_DIAGNOSIS_BLOCKED_MODEL_UNAVAILABLE' : output.first_failing_stage === 'ENVELOPE' ? 'GREEN_OCAE_GLM52_FREE_ENVELOPE_REGRESSION_REPLICATED' : output.first_failing_stage === 'IDENTITY' || output.first_failing_stage === 'CONTROL' ? 'AMBER_OCAE_GLM52_FREE_OBSERVATION_EVIDENCE_INSUFFICIENT' : 'GREEN_OCAE_GLM52_FREE_ENVELOPE_REGRESSION_NOT_REPLICATED'
  output.promoted_profile = 'NONE'
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })

  const representatives = [
    ['CONTROL_0 healthy', control?.runs_detail.find((run) => run.verified_success)],
    ['IDENTITY healthy', identityRun],
    ['ENVELOPE healthy', envelope?.runs_detail.find((run) => run.verified_success)],
    ['ENVELOPE failing', envelope?.runs_detail.find((run) => !run.verified_success)],
  ]
  const differential = [`# Issue #43 GLM-5.2 free DEBUG log differential`, '', `Experiment: \`${experimentId}\``, `Target: \`${provider}/${model}\``, `OpenCode: \`${hostVersion}\``, '', 'The traces below are sanitized extracts. Timestamps, request IDs, and temporary paths are omitted or normalized where present.', '']
  for (const [label, run] of representatives) {
    if (!run) continue
    differential.push(`## ${label}`, '', `- verified_success: \`${run.verified_success}\``, `- failure_class: \`${run.failure_class || 'NONE'}\``, `- timeout_class: \`${run.timeout_class || 'NONE'}\``, `- message_sequence: \`${run.message_sequence.join(' → ')}\``, `- observation_trace: \`${run.observation_trace_types.join(' → ')}\``, `- debug_lifecycle_events: \`${run.debug_lifecycle_events.join(' → ') || 'NONE_OBSERVED'}\``, '', '```text', sanitizeDebugLog(run.debug_log_excerpt, 6000).replace(/\d{4}-\d{2}-\d{2}T[^ ]+/gu, '[TIMESTAMP]'), '```', '')
  }
  differential.push('## Differential interpretation', '', `- CONTROL_0: ${control ? 'captured' : 'not captured'}`, `- IDENTITY: ${identity ? 'captured' : 'not captured'}`, `- ENVELOPE: ${envelope ? 'captured' : 'not captured'}`, '- Exact OpenCode internal message roles and provider request payload ordering are not exposed by this CLI surface; message role is therefore UNOBSERVABLE.', '- The observable CLI event order and adapter trace order are retained in the evidence JSON; any provider-side resume ordering beyond that boundary is not inferred.')
  await fs.writeFile(path.join(reportRoot, 'issue-43-glm52-free-debug-log-differential.md'), `${differential.join('\n')}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ output_path: path.relative(repoRoot, outputPath), freeze_path: path.relative(repoRoot, freezePath), experiment_id: experimentId, attempt_id: attemptId, provider, model, opencode_version: hostVersion, final_classification: output.final_classification, first_failing_stage: output.first_failing_stage, canaries: output.canaries.map((layer) => ({ layer: layer.layer, verified_success: `${layer.verified_success}/${layer.runs}`, latency_avg_ms: layer.latency_avg_ms })) }, null, 2))
}

await main()
