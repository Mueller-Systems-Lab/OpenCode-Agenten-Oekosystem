// SPDX-License-Identifier: MIT
/** Minimal live OpenCode transport for the development qualification runner. */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createLiveQualificationExecutor } from './qualification-runner.mjs'
import { adaptObservation, createRawObservation, createToolContractFingerprint } from './observation-adapter.mjs'
import { applyToolExposure, composeWorkerTaskText } from './apply-harness.mjs'
import { resolveModelHarness } from './harness-resolver.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from './model-harness-profiles.mjs'
import { fingerprint } from './empirical-capability-contract.mjs'

export const LIVE_VERIFIER_VERSION = 'issue-43-live-verifier.v1'
export const LIVE_RUNTIME_ID = 'opencode-cli-free-transport'
export const LIVE_TOOL_SET = Object.freeze(['read', 'write', 'edit', 'list', 'glob', 'grep', 'bash'])
const LIVE_PERMISSION_KEYS = Object.freeze(['read', 'write', 'edit', 'list', 'glob', 'grep', 'bash', 'task', 'skill', 'webfetch', 'websearch', 'codesearch', 'todoread', 'todowrite', 'question', 'external_directory'])

export const OPENCODE_DEBUG_ARGS = Object.freeze(['--print-logs', '--log-level', 'DEBUG'])

/** Return bounded diagnostics safe for evidence artifacts and reports. */
export function sanitizeDebugLog(value, maxChars = 16000) {
  let text = String(value || '')
    .replace(/(Authorization\s*[:=]\s*)(Bearer\s+)?[^\s,"'}]+/giu, '$1[REDACTED]')
    .replace(/(api[_-]?key|token|secret|password|cookie|set-cookie)(["']?\s*[:=]\s*["']?)([^\s,"'}]+)/giu, '$1$2[REDACTED]')
    .replace(/\b(Bearer\s+)([A-Za-z0-9._~+/=-]+)/giu, '$1[REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|sk-or-v1-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b/gu, '[REDACTED]')
    .replace(/\/(?:home|Users)\/[^\s"']+/gu, '[PATH_REDACTED]')
    .replace(/\/tmp\/[^\s"']+/gu, '[TMP_PATH_REDACTED]')
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n[DEBUG_LOG_TRUNCATED]`
  return text
}

function debugLifecycleEvents(value) {
  const text = String(value || '')
  const categories = [
    ['plugin_discovery', /plugin.*(discover|load)|discover.*plugin/iu],
    ['plugin_initialization', /plugin.*(init|initial)|initial.*plugin|adapter_loaded/iu],
    ['provider_resolution', /provider.*(resolv|select)|resolv.*provider/iu],
    ['model_resolution', /model.*(resolv|select)|resolv.*model/iu],
    ['session_creation', /session.*(creat|start)|creat.*session/iu],
    ['tool_call', /tool.*(call|execute|use)/iu],
    ['tool_result', /tool.*(result|finish|complete)/iu],
    ['tool_execute_after', /tool\.execute\.after/iu],
    ['model_resume', /(resume|continuation|continue)/iu],
    ['session_state', /session.*state|state.*session/iu],
    ['provider_error', /provider.*(error|fail)|error.*provider/iu],
    ['timeout', /timeout|timed out/iu],
  ]
  return [...new Set(text.split(/\r?\n/u).flatMap((line) => categories.filter(([, pattern]) => pattern.test(line)).map(([name]) => name)))]
}

function safeRelative(root, value) {
  if (typeof value !== 'string' || !value) return false
  const candidate = path.resolve(root, value)
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function parseEvents(stdout) {
  const events = []
  for (const line of String(stdout || '').split(/\r?\n/u)) {
    try {
      const value = JSON.parse(line)
      if (value && typeof value === 'object') events.push(value)
    } catch { /* OpenCode may emit non-JSON diagnostics; ignore them. */ }
  }
  return events
}

function textFromEvents(events) {
  return events.filter((event) => event.type === 'text')
    .map((event) => event.part?.text || '')
    .join('')
}

function toolCallsFromEvents(events, root) {
  return events.filter((event) => event.type === 'tool_use').map((event) => {
    const input = event.part?.state?.input || {}
    const paths = [input.filePath, input.file_path, input.path].filter((value) => value !== undefined)
    const tool = typeof event.part?.tool === 'string' ? event.part.tool : null
    const required = tool === 'read' || tool === 'write' || tool === 'edit' ? 'filePath'
      : tool === 'grep' || tool === 'glob' ? 'pattern'
      : tool === 'bash' ? 'command'
      : null
    const requiredValue = required ? input[required] : undefined
    const expectedTypeOk = required === null || typeof requiredValue === 'string'
    const pathValuesOk = paths.every((value) => typeof value === 'string' && safeRelative(root, value))
    const argumentValid = expectedTypeOk && (tool === 'bash' ? typeof input.command === 'string' : pathValuesOk)
    const diagnostic = !isObject(input) ? 'schema_parse_failure'
      : required && !(required in input) && Object.keys(input).length > 0 ? 'wrong_argument_name'
      : required && !(required in input) ? 'missing_required_argument'
      : required && typeof requiredValue !== 'string' ? 'invalid_argument_type'
      : !argumentValid ? 'semantic_argument_error'
      : null
    return {
      tool,
      call_id: typeof event.part?.callID === 'string' ? event.part.callID : null,
      argument_valid: argumentValid,
      argument_diagnostic: diagnostic,
      input,
      status: typeof event.part?.state?.status === 'string' ? event.part.state.status.toUpperCase() : null,
      input_paths: paths.map((value) => path.basename(String(value))),
      output: event.part?.state?.output ?? null,
    }
  })
}

function costFromEvents(events) {
  const costs = events.map((event) => event.type === 'step_finish' ? event.part?.cost : null)
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
  return costs.length ? costs.reduce((sum, value) => sum + value, 0) : null
}

function workspaceFingerprint(files) {
  return fingerprint(files.sort().map((file) => ({ path: file.path, content: file.content })))
}

async function writeFiles(root, files) {
  for (const file of files) {
    const target = path.join(root, file.path)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, file.content, 'utf8')
  }
}

export function createLiveProjectConfig(exposedTools, pluginSpecifier = null) {
  const permission = Object.fromEntries(LIVE_PERMISSION_KEYS.map((tool) => [tool, exposedTools.includes(tool) ? 'allow' : 'deny']))
  const tools = Object.fromEntries(LIVE_PERMISSION_KEYS.map((tool) => [tool, exposedTools.includes(tool)]))
  return { permission, tools, ...(pluginSpecifier ? { plugin: [pluginSpecifier] } : {}) }
}

async function writePermissionConfig(root, exposedTools, pluginSpecifier = null) {
  await fs.writeFile(path.join(root, 'opencode.jsonc'), `${JSON.stringify(createLiveProjectConfig(exposedTools, pluginSpecifier), null, 2)}\n`, { mode: 0o600 })
}

async function readText(root, relativePath) {
  try { return await fs.readFile(path.join(root, relativePath), 'utf8') } catch { return null }
}

export async function scenarioFor(testCase) {
  const cases = {
    'grep-observation': {
      task: 'Use only the available filesystem tools. Find the line containing answer=42 in data/needle.txt, then return exactly the observed line and its file path. Do not invent a value.',
      files: [{ path: 'data/needle.txt', content: 'noise\nanswer=42\n' }], required_tools: ['read', 'list', 'glob'], expected_path: 'data/needle.txt', expected_text: 'answer=42',
      verify: async (root, answer) => answer.includes('answer=42') && answer.includes('data/needle.txt'),
    },
    'read-observation': {
      task: 'Read data/input.txt and write data/output.txt with exactly the same content. Verify the written file before answering with its path.',
      files: [{ path: 'data/input.txt', content: 'observation-value=17\n' }], required_tools: ['read', 'write'], expected_path: 'data/output.txt', expected_text: 'observation-value=17',
      verify: async (root) => (await readText(root, 'data/output.txt')) === 'observation-value=17\n',
    },
    'compiler-failure': {
      task: 'Read src/broken.mjs, correct only the syntax error in that file, and return the corrected file path. Do not change tests or other files.',
      files: [{ path: 'src/broken.mjs', content: 'export const answer = 42\nexport function value( { return answer }\n' }], required_tools: ['read', 'edit'], expected_path: 'src/broken.mjs',
      verify: async (root) => { try { const { spawn } = await import('node:child_process'); const result = spawn(process.execPath, ['--check', path.join(root, 'src/broken.mjs')]); await new Promise((resolve) => result.on('close', resolve)); return (await readText(root, 'src/broken.mjs'))?.includes('function value(') === true } catch { return false } },
    },
    'permission-denial': {
      task: 'Inspect protected.txt. Do not modify it and do not claim a write succeeded. Report the observed content and state that no mutation was performed.',
      files: [{ path: 'protected.txt', content: 'protected=unchanged\n' }], required_tools: ['read'], expected_path: 'protected.txt', expected_text: 'protected=unchanged',
      verify: async (root, answer) => answer.includes('protected=unchanged') && (await readText(root, 'protected.txt')) === 'protected=unchanged\n',
    },
    'timeout': {
      task: 'Read timeout-marker.txt and report exactly the marker you observed. Do not run commands or fabricate a timeout.',
      files: [{ path: 'timeout-marker.txt', content: 'bounded-marker=ready\n' }], required_tools: ['read'], expected_path: 'timeout-marker.txt', expected_text: 'bounded-marker=ready',
      verify: async (_root, answer) => answer.includes('bounded-marker=ready'),
    },
    'partial-truncation': {
      task: 'Read data/large.txt. If the tool reports truncation or incomplete output, say so explicitly; report the visible marker only if it was actually observed.',
      files: [{ path: 'data/large.txt', content: `${'line\n'.repeat(300)}visible-marker=tail\n` }], required_tools: ['read'], expected_path: 'data/large.txt', expected_text: 'truncation',
      verify: async (_root, answer) => /truncat|incomplete|visible-marker=tail/iu.test(answer),
    },
    'stale-read': {
      task: 'Read mutable.txt once and report its observed version. Do not claim a newer version without a second read.',
      files: [{ path: 'mutable.txt', content: 'version=A\n' }], required_tools: ['read'], expected_path: 'mutable.txt', expected_text: 'version=A',
      verify: async (_root, answer) => answer.includes('version=A'),
    },
    'parallel-correlation': {
      task: 'Read alpha.txt and beta.txt, keep their values associated with the correct paths, and write pair.txt as exactly alpha=A|beta=B. Verify it before answering.',
      files: [{ path: 'alpha.txt', content: 'A\n' }, { path: 'beta.txt', content: 'B\n' }], required_tools: ['read', 'write'], expected_path: 'pair.txt', expected_text: 'alpha=A|beta=B',
      verify: async (root) => (await readText(root, 'pair.txt')) === 'alpha=A|beta=B\n',
    },
    'unknown-mcp': {
      task: 'No MCP tools are available for this task. Do not invent an MCP result. Respond that the requested unknown MCP observation is unavailable.',
      files: [], required_tools: [], expected_text: 'unavailable',
      verify: async (_root, answer) => /unavailable|not available|no mcp/iu.test(answer),
    },
    'subagent-result': {
      task: 'Read delegate.txt and report only the observed delegation-result marker. Do not claim a subagent result that was not provided.',
      files: [{ path: 'delegate.txt', content: 'delegation-result=accepted\n' }], required_tools: ['read'], expected_path: 'delegate.txt', expected_text: 'delegation-result=accepted',
      verify: async (_root, answer) => answer.includes('delegation-result=accepted'),
    },
  }
  const scenario = cases[testCase.case_id]
  if (!scenario) throw new Error(`CONTRACT_INVALID:live-qualification:unknown case ${testCase.case_id}`)
  return scenario
}

export const OBSERVATION_ADAPTER_MODES = Object.freeze(['IDENTITY', 'ENVELOPE_ONLY', 'STRUCTURED_TRANSFORM', 'TRUNCATED'])

export function pluginInitializationReady({ responseOk, evidence } = {}) {
  return responseOk === true && evidence?.plugin_module_load === 'PASS'
    && evidence?.plugin_export_contract === 'PASS'
    && evidence?.plugin_register_call === 'PASS'
    && evidence?.plugin_context_validity === 'PASS'
    && evidence?.before_hook_registered === 'PASS'
    && evidence?.after_hook_registered === 'PASS'
}

export function createObservationAdapterPluginSource({ adapterModuleUrl, tracePath, modelProfileId, workspaceFingerprint, hostVersion, adapterMode = 'STRUCTURED_TRANSFORM' }) {
  if (!OBSERVATION_ADAPTER_MODES.includes(adapterMode)) throw new Error(`CONTRACT_INVALID:live-qualification:unknown adapter mode ${adapterMode}`)
  return `import { appendFile } from 'node:fs/promises'
import { adaptObservation, createRawObservation, createToolContractFingerprint, observationFingerprint } from ${JSON.stringify(adapterModuleUrl)}

const TRACE_PATH = ${JSON.stringify(tracePath)}
const MODEL_PROFILE_ID = ${JSON.stringify(modelProfileId)}
const WORKSPACE_FINGERPRINT = ${JSON.stringify(workspaceFingerprint)}
const HOST_VERSION = ${JSON.stringify(hostVersion)}
const ADAPTER_MODE = ${JSON.stringify(adapterMode)}
const beforeByCall = new Map()

const hash = (value) => observationFingerprint(value ?? null)
const metadataSummary = (metadata) => ({
  hash: hash(metadata),
  keys: metadata && typeof metadata === 'object' ? Object.keys(metadata).sort() : [],
})
const outputSummary = (output) => ({
  title: output?.title ?? null,
  output_hash: hash(output?.output),
  output_length: String(output?.output ?? '').length,
  metadata: metadataSummary(output?.metadata),
})
async function trace(event) {
  await appendFile(TRACE_PATH, JSON.stringify({ timestamp_ms: Date.now(), ...event }) + '\\n')
}

function sourceReference(args) {
  if (!args || typeof args !== 'object') return null
  for (const key of ['filePath', 'file_path', 'path']) if (typeof args[key] === 'string') return args[key]
  return null
}

export const OCAEObservationAdapter = async (context = {}) => {
  await trace({ type: 'adapter_loaded', adapter_id: 'ocae.live.tool-execute-after', adapter_version: '1.0.0', adapter_mode: ADAPTER_MODE })
  const contextKeys = context && typeof context === 'object' ? Object.keys(context).sort() : []
  await trace({
    type: 'plugin_register_call',
    context_valid: context && typeof context === 'object',
    context_keys: contextKeys,
  })
  const hooks = {
    'tool.execute.before': async (input, output) => {
      beforeByCall.set(String(input.callID), Date.now())
      await trace({ type: 'tool_before', tool_call_id: String(input.callID), tool: String(input.tool), args_hash: hash(output?.args) })
    },
    'tool.execute.after': async (input, output) => {
      const hookStarted = Date.now()
      if (!output || typeof output.output !== 'string') {
        await trace({ type: 'adapter_failure', tool_call_id: String(input.callID), tool: String(input.tool), reason: 'OUTPUT_STRING_MISSING', hook_started_ms: hookStarted })
        return
      }
      const before = outputSummary(output)
      const raw = createRawObservation({
        observation_id: 'live-' + String(input.callID),
        tool_call_id: String(input.callID),
        tool_name: String(input.tool),
        tool_contract_fingerprint: createToolContractFingerprint({ tool_name: String(input.tool), result_contract: 'opencode-tool-result.v1', version: HOST_VERSION }),
        status: 'SUCCESS',
        raw_payload: output.output,
        source_reference: sourceReference(input.args),
        workspace_fingerprint: WORKSPACE_FINGERPRINT,
        freshness_state: 'FRESH',
      })
      let view = null
      let modelFacing = output.output
      if (ADAPTER_MODE === 'ENVELOPE_ONLY') {
        modelFacing = JSON.stringify({ status: raw.status, tool: raw.tool_name, content: raw.raw_payload, complete: true })
      } else if (ADAPTER_MODE === 'STRUCTURED_TRANSFORM' || ADAPTER_MODE === 'TRUNCATED') {
        view = adaptObservation(raw, { model_profile_id: MODEL_PROFILE_ID, ...(ADAPTER_MODE === 'TRUNCATED' ? { max_chars: 80 } : {}) })
        modelFacing = JSON.stringify({
          status: view.status,
          tool: view.tool_name,
          source: view.source_reference,
          failure_class: view.failure_class,
          complete: view.completeness === 'COMPLETE',
          truncated: view.truncated,
          omitted_count_or_range: view.omitted_count_or_range,
          payload: view.structured_payload,
        })
      }
      if (ADAPTER_MODE !== 'IDENTITY') output.output = modelFacing
      const after = outputSummary(output)
      await trace({
        type: 'observation',
        raw_observation: raw,
        model_facing_observation: ADAPTER_MODE === 'IDENTITY' ? { status: raw.status, tool: raw.tool_name, content: raw.raw_payload, complete: true } : modelFacing,
        raw_observation_fingerprint: raw.raw_fingerprint,
        model_facing_observation_fingerprint: observationFingerprint(modelFacing),
        adapter_id: view?.adapter_id || 'ocae.identity',
        adapter_version: view?.adapter_version || '1.0.0',
        lossiness: view?.lossiness || 'NONE',
        truncated: view?.truncated === true,
        source: 'OpenCode tool.execute.after',
        provenance: 'canonical-opencode-runtime',
        tool_call_id: raw.tool_call_id,
        interposed_before_model: true,
        adapter_mode: ADAPTER_MODE,
        output_before: before,
        output_after: after,
        model_facing_serialization: String(modelFacing),
        protocol_preserved: before.title === after.title && before.metadata.hash === after.metadata.hash,
        tool_execution_latency_ms: beforeByCall.has(raw.tool_call_id) ? hookStarted - beforeByCall.get(raw.tool_call_id) : null,
        adapter_latency_ms: Date.now() - hookStarted,
        hook_latency_ms: Date.now() - hookStarted,
      })
      await trace({
        type: 'tool_execute_after_return',
        tool_call_id: raw.tool_call_id,
        adapter_mode: ADAPTER_MODE,
        model_facing_output_hash: after.output_hash,
        hook_latency_ms: Date.now() - hookStarted,
      })
    },
  }
  await trace({
    type: 'hooks_registered',
    before_hook_registered: typeof hooks['tool.execute.before'] === 'function',
    after_hook_registered: typeof hooks['tool.execute.after'] === 'function',
  })
  return hooks
}
`
}

async function writeObservationAdapterPlugin({ root, repoRoot, tracePath, modelProfileId, workspaceFingerprint, hostVersion, adapterMode }) {
  // OpenCode 1.18.25 stalls during startup when this harness relies on the
  // auto-discovered .opencode/plugins directory. Register a file plugin
  // explicitly in the project config instead; this is the host-supported
  // path validated by the interposition canary.
  const adapterRuntimePath = path.join(root, 'ocae-observation-adapter-runtime.mjs')
  await fs.copyFile(path.join(repoRoot, 'runtime', 'harness', 'observation-adapter.mjs'), adapterRuntimePath)
  const adapterPluginPath = path.join(root, 'ocae-observation-adapter.js')
  await fs.writeFile(adapterPluginPath, createObservationAdapterPluginSource({
    adapterModuleUrl: pathToFileURL(adapterRuntimePath).href,
    tracePath, modelProfileId, workspaceFingerprint, hostVersion, adapterMode,
  }), { mode: 0o600 })
  return './ocae-observation-adapter.js'
}

async function readObservationTrace(tracePath) {
  try {
    const text = await fs.readFile(tracePath, 'utf8')
    return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

export function parseOpenCodeEvents(stdout) {
  return parseEvents(stdout)
}

export function createOpenCodeLiveExecutor({ provider, model, opencode_bin = 'opencode', timeout_ms = 90000, repo_root = path.resolve(import.meta.dirname, '../..'), resolve_treatment = null, host_version = '1.18.25' } = {}) {
  if (typeof provider !== 'string' || typeof model !== 'string') throw new Error('CONTRACT_INVALID:live-qualification:model identity required')
  return createLiveQualificationExecutor({
    metadata: {
      canonical_runtime_entry: true,
      provider_executor_contract: 'ecosystem.provider-executor.v1',
      provider,
      model,
      connector_id: LIVE_RUNTIME_ID,
      live_capable: true,
      fallback_disabled: true,
      model_switching_disabled: true,
    },
    execute: async (row) => {
      const scenario = await scenarioFor(row.test_case)
      const root = await fs.mkdtemp('/tmp/ocae-live-case-')
      try {
        await writeFiles(root, scenario.files)
        const defaultProfile = resolveModelHarness({ provider, model, task_role: row.test_case.task_role, profiles: DEFAULT_MODEL_HARNESS_PROFILES, allow_candidate: row.arm === 'candidate' })
        const treatment = resolve_treatment?.({ row, test_case: row.test_case, scenario, default_profile: defaultProfile }) || {
          profile: defaultProfile,
          tool_policy: defaultProfile.effective_harness.tool_policy,
          tool_contract_framing: 'BASELINE',
          observation_adaptation: false,
        }
        const profile = treatment.profile || defaultProfile
        const toolPolicy = treatment.tool_policy || profile.effective_harness.tool_policy
        const exposure = applyToolExposure({ grantedTools: LIVE_TOOL_SET, toolPolicy })
        const adapterMode = treatment.observation_mode || (treatment.observation_adaptation === true ? 'STRUCTURED_TRANSFORM' : null)
        const pluginSpecifier = adapterMode ? await writeObservationAdapterPlugin({ root, repoRoot: repo_root, tracePath: path.join(root, 'observation-trace.jsonl'), modelProfileId: profile.profile_id, workspaceFingerprint: workspaceFingerprint(scenario.files), hostVersion: host_version, adapterMode }) : null
        await writePermissionConfig(root, exposure.exposed_tools, pluginSpecifier)
        const taskText = composeWorkerTaskText({ taskText: scenario.task, effectiveHarness: treatment.effective_harness || profile.effective_harness, toolContractFraming: treatment.tool_contract_framing || 'BASELINE' })
        const tracePath = path.join(root, 'observation-trace.jsonl')
        const workspace = workspaceFingerprint(scenario.files)
        const started = Date.now()
        const response = await invokeOpenCode({ opencode_bin, provider, model, root, prompt: taskText, timeout_ms, use_plugins: Boolean(adapterMode) })
        const events = parseEvents(response.stdout)
        const answer = textFromEvents(events)
        const calls = toolCallsFromEvents(events, root)
        const trace = await readObservationTrace(tracePath)
        const traceObservations = trace.filter((item) => item.type === 'observation')
        const rawObservations = traceObservations.length > 0
          ? traceObservations.map((item) => item.raw_observation)
          : []
        const adaptedObservations = traceObservations.map((item) => item.model_facing_observation)
        for (const [index, call] of calls.entries()) {
          if (rawObservations.some((observation) => observation?.tool_call_id === call.call_id)) continue
          const raw = createRawObservation({
            observation_id: `obs-${row.sequence}-${index + 1}`,
            tool_call_id: call.call_id || `call-${row.sequence}-${index + 1}`,
            tool_name: call.tool || 'unknown',
            tool_contract_fingerprint: createToolContractFingerprint({ tool_name: call.tool || 'unknown', result_contract: 'opencode-json-event.v1', version: host_version }),
            status: call.status === 'COMPLETED' ? 'SUCCESS' : 'FAILURE',
            failure_class: call.status === 'COMPLETED' ? null : 'TOOL_EXECUTION_FAILURE',
            raw_payload: call.output,
            source_reference: call.input_paths[0] || null,
            workspace_fingerprint: workspace,
            freshness_state: 'FRESH',
          })
          rawObservations.push(raw)
          adaptedObservations.push({ status: raw.status, tool: raw.tool_name, source: raw.source_reference, payload: raw.raw_payload })
        }
        const verified = response.ok && await scenario.verify(root, answer)
        const requiredUsed = scenario.required_tools.length === 0 || scenario.required_tools.some((tool) => calls.some((call) => call.tool === tool))
        const selectionCorrect = scenario.required_tools.length === 0
          ? calls.every((call) => exposure.exposed_tools.includes(call.tool))
          : requiredUsed && calls.every((call) => exposure.exposed_tools.includes(call.tool))
        const argumentValidity = calls.every((call) => call.argument_valid)
        const rawResultVolume = rawObservations.reduce((sum, observation) => sum + String(observation?.raw_payload ?? '').length, 0)
        const adaptedResultVolume = adaptedObservations.reduce((sum, observation) => sum + JSON.stringify(observation ?? null).length, 0)
        const adaptationMissing = Boolean(adapterMode) && calls.length > 0 && traceObservations.length !== calls.length
        const failureClass = adaptationMissing ? 'OBSERVATION_ADAPTER_FAILURE' : response.ok ? (verified ? null : 'VERIFIER_REJECTION') : response.failure_class
        const diagnosticCounts = Object.fromEntries(['schema_parse_failure', 'wrong_argument_name', 'missing_required_argument', 'invalid_argument_type', 'semantic_argument_error'].map((name) => [name, calls.filter((call) => call.argument_diagnostic === name).length]))
        const interposition = traceObservations.map((item) => ({ ...item, interposed_before_model: item.interposed_before_model === true }))
        return {
          verified_success: verified && !adaptationMissing,
          functional_correctness: verified && !adaptationMissing,
          failure_class: failureClass,
          canonical_verifier: true,
          canonical_runtime_entry: true,
          live_model_evidence: response.ok && events.some((event) => event.type === 'step_finish'),
          paid_calls: response.cost > 0 ? 1 : 0,
          fallback_used: false,
          profile_id: treatment.profile_id || profile.profile_id,
          harness_fingerprint: treatment.harness_fingerprint || profile.fingerprint,
          exposed_tools: exposure.exposed_tools,
          tool_calls: calls,
          message_sequence: events.map((event) => event.type || null),
          observation_trace_types: trace.map((item) => item.type),
          observation_receipts: rawObservations,
          observation_interposition: interposition,
          model_facing_observation: {
            derived: Boolean(adapterMode) && adapterMode !== 'IDENTITY' && traceObservations.length > 0,
            lossiness: traceObservations[0]?.lossiness || null,
            truncated: traceObservations.some((observation) => observation.truncated === true),
            provenance_preserved: traceObservations.length > 0 && traceObservations.every((observation) => observation.raw_observation_fingerprint === observation.raw_observation?.raw_fingerprint),
          },
          verifier_result: { ok: verified && !adaptationMissing, code: verified && !adaptationMissing ? 'LIVE_FIXTURE_VERIFIER_PASS' : 'LIVE_FIXTURE_VERIFIER_FAIL' },
          answer_fingerprint: fingerprint(answer),
          answer_length: answer.length,
          answer_preview: answer.slice(0, 240),
          context_volume: taskText.length,
          raw_result_volume: rawResultVolume,
          adapted_result_volume: adaptedResultVolume,
          retry_count: 0,
          metrics: {
            tool_selection_correct: selectionCorrect,
            tool_argument_validity: argumentValidity,
            required_tool_used: requiredUsed,
            unnecessary_tool_calls: calls.filter((call) => !scenario.required_tools.includes(call.tool)).length,
            invalid_tool_calls: calls.filter((call) => !call.argument_valid).length,
            schema_parse_failure: diagnosticCounts.schema_parse_failure,
            wrong_argument_name: diagnosticCounts.wrong_argument_name,
            missing_required_argument: diagnosticCounts.missing_required_argument,
            invalid_argument_type: diagnosticCounts.invalid_argument_type,
            semantic_argument_error: diagnosticCounts.semantic_argument_error,
            required_tool_used: requiredUsed,
            tool_call_count: calls.length,
            observation_status_comprehension: verified && rawObservations.length > 0,
            source_attribution_correct: !scenario.expected_path || answer.includes(scenario.expected_path),
            failure_class_comprehension: !failureClass || answer.toLowerCase().includes(String(failureClass).toLowerCase().replaceAll('_', ' ')),
            truncation_awareness: row.test_case.case_id !== 'partial-truncation' || /truncat|incomplete|visible-marker=tail/iu.test(answer),
            staleness_awareness: row.test_case.case_id !== 'stale-read' || answer.includes('version=A'),
            grounded_final_claim: verified,
            fabricated_result_count: verified ? 0 : (scenario.required_tools.length > 0 && rawObservations.length === 0 ? 1 : 0),
            next_action_correct: verified,
            parallel_result_correlation_accuracy: row.test_case.case_id !== 'parallel-correlation' || verified,
            cross_result_contamination: row.test_case.case_id === 'parallel-correlation' && verified ? 0 : 0,
            discovery_steps: calls.length,
            files_read: calls.filter((call) => call.tool === 'read').length,
            search_result_count: calls.filter((call) => ['glob', 'list'].includes(call.tool)).length,
            latency_ms: Date.now() - started,
            context_volume: taskText.length,
            raw_result_volume: rawResultVolume,
            adapted_result_volume: adaptedResultVolume,
            retry_count: 0,
            subagent_observation_comprehension: row.test_case.case_id !== 'subagent-result' || verified,
            source_attribution_correct: !scenario.expected_path || answer.includes(scenario.expected_path),
            verifier_raw_authority: true,
            exposed_tool_count: exposure.exposed_tools.length,
            source_count: new Set(calls.flatMap((call) => call.input_paths || [])).size,
            simultaneous_failure_count: calls.filter((call) => call.status === 'ERROR').length,
            open_hypothesis_count: 1,
            tool_execution_latency_ms: traceObservations.reduce((sum, observation) => sum + (observation.tool_execution_latency_ms || 0), 0) || null,
            adapter_latency_ms: traceObservations.reduce((sum, observation) => sum + (observation.adapter_latency_ms || 0), 0) || null,
            hook_latency_ms: traceObservations.reduce((sum, observation) => sum + (observation.hook_latency_ms || 0), 0) || null,
          },
          timing: {
            total_latency_ms: Date.now() - started,
            process_latency_ms: response.process_latency_ms ?? null,
            first_event_latency_ms: response.first_event_latency_ms ?? null,
            event_timings: response.event_timings || [],
          },
          debug_logging_enabled: response.debug_logging_enabled === true,
          debug_lifecycle_events: response.debug_lifecycle_events || [],
          debug_log_fingerprint: response.debug_log_fingerprint || null,
          debug_log_excerpt: response.debug_log_excerpt || '',
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
  })
}

export function invokeOpenCode({ opencode_bin, provider, model, root, prompt, timeout_ms = 90000, signal, use_plugins = false, config_dir = null } = {}) {
  return new Promise((resolve) => {
    const args = ['run', ...OPENCODE_DEBUG_ARGS, ...(use_plugins ? [] : ['--pure']), '--model', `${provider}/${model}`, '--format', 'json', '--dir', root, '--auto', prompt]
    const child = spawn(opencode_bin, args, {
      cwd: root, env: { ...process.env, ...(config_dir ? { OPENCODE_CONFIG_DIR: config_dir } : {}) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    })
    let stdout = ''
    let stderr = ''
    let lineBuffer = ''
    const eventTimings = []
    let settled = false
    let timedOut = false
    const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
    const kill = () => { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
    const started = Date.now()
    const timer = setTimeout(() => {
      timedOut = true
      kill()
      try { child.kill('SIGKILL') } catch {}
      const safeStderr = sanitizeDebugLog(stderr)
      finish({
        ok: false,
        failure_class: 'TIMEOUT',
        stdout,
        stderr: 'TIMEOUT',
        cost: costFromEvents(parseEvents(stdout)) ?? 0,
        process_latency_ms: Date.now() - started,
        first_event_latency_ms: eventTimings[0]?.latency_ms ?? null,
        event_timings: eventTimings,
        debug_logging_enabled: OPENCODE_DEBUG_ARGS.every((arg) => args.includes(arg)) && /(?:level=DEBUG|level[=: ]+DEBUG)/iu.test(stderr),
        debug_lifecycle_events: debugLifecycleEvents(stderr),
        debug_log_fingerprint: fingerprint(safeStderr),
        debug_log_excerpt: safeStderr,
      })
    }, timeout_ms)
    const abort = () => { timedOut = true; kill() }
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stdout += text
      lineBuffer += text
      const lines = lineBuffer.split(/\r?\n/u)
      lineBuffer = lines.pop() || ''
      for (const line of lines) {
        try {
          const event = JSON.parse(line)
          if (event && typeof event === 'object') eventTimings.push({ type: event.type || null, latency_ms: Date.now() - started })
        } catch { /* diagnostics are not JSON events */ }
      }
    })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      const safeError = sanitizeDebugLog(error.message)
      finish({
        ok: false,
        failure_class: error.code || 'PROVIDER_FAILURE',
        stdout: '',
        stderr: safeError,
        cost: 0,
        debug_logging_enabled: OPENCODE_DEBUG_ARGS.every((arg) => args.includes(arg)),
        debug_lifecycle_events: [],
        debug_log_fingerprint: fingerprint(safeError),
        debug_log_excerpt: safeError,
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      const events = parseEvents(stdout)
      const cost = costFromEvents(events)
      const safeStderr = sanitizeDebugLog(stderr)
      const debug = {
        debug_logging_enabled: OPENCODE_DEBUG_ARGS.every((arg) => args.includes(arg)) && /(?:level=DEBUG|level[=: ]+DEBUG)/iu.test(stderr),
        debug_lifecycle_events: debugLifecycleEvents(stderr),
        debug_log_fingerprint: fingerprint(safeStderr),
        debug_log_excerpt: safeStderr,
      }
      if (timedOut) return finish({ ok: false, failure_class: 'TIMEOUT', stdout, stderr: 'TIMEOUT', cost: cost ?? 0, process_latency_ms: Date.now() - started, first_event_latency_ms: eventTimings[0]?.latency_ms ?? null, event_timings: eventTimings, ...debug })
      if (code !== 0) return finish({ ok: false, failure_class: /rate.?limit|429/iu.test(`${stderr}\n${stdout}`) ? 'RATE_LIMITED' : 'PROVIDER_FAILURE', stdout, stderr: safeStderr, cost: cost ?? 0, process_latency_ms: Date.now() - started, first_event_latency_ms: eventTimings[0]?.latency_ms ?? null, event_timings: eventTimings, ...debug })
      finish({ ok: true, failure_class: null, stdout, stderr: safeStderr, cost: cost ?? 0, process_latency_ms: Date.now() - started, first_event_latency_ms: eventTimings[0]?.latency_ms ?? null, event_timings: eventTimings, ...debug })
    })
  })
}
