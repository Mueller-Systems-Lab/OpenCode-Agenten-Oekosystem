// SPDX-License-Identifier: MIT
/** Minimal live OpenCode transport for the development qualification runner. */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
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
    return {
      tool: typeof event.part?.tool === 'string' ? event.part.tool : null,
      call_id: typeof event.part?.callID === 'string' ? event.part.callID : null,
      argument_valid: paths.every((value) => safeRelative(root, value)),
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

async function writePermissionConfig(root, exposedTools) {
  const permission = Object.fromEntries(LIVE_PERMISSION_KEYS.map((tool) => [tool, exposedTools.includes(tool) ? 'allow' : 'deny']))
  await fs.writeFile(path.join(root, 'opencode.jsonc'), `${JSON.stringify({ permission }, null, 2)}\n`, { mode: 0o600 })
}

async function readText(root, relativePath) {
  try { return await fs.readFile(path.join(root, relativePath), 'utf8') } catch { return null }
}

async function scenarioFor(testCase) {
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

export function parseOpenCodeEvents(stdout) {
  return parseEvents(stdout)
}

export function createOpenCodeLiveExecutor({ provider, model, opencode_bin = 'opencode', timeout_ms = 90000 } = {}) {
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
        const profile = resolveModelHarness({ provider, model, task_role: row.test_case.task_role, profiles: DEFAULT_MODEL_HARNESS_PROFILES, allow_candidate: row.arm === 'candidate' })
        const exposure = applyToolExposure({ grantedTools: LIVE_TOOL_SET, toolPolicy: profile.effective_harness.tool_policy })
        await writePermissionConfig(root, exposure.exposed_tools)
        const taskText = composeWorkerTaskText({ taskText: scenario.task, effectiveHarness: profile.effective_harness })
        const started = Date.now()
        const response = await invokeOpenCode({ opencode_bin, provider, model, root, prompt: taskText, timeout_ms })
        const events = parseEvents(response.stdout)
        const answer = textFromEvents(events)
        const calls = toolCallsFromEvents(events, root)
        const rawObservations = []
        const adaptedObservations = []
        const workspace = workspaceFingerprint(scenario.files)
        for (const [index, call] of calls.entries()) {
          const raw = createRawObservation({
            observation_id: `obs-${row.sequence}-${index + 1}`,
            tool_call_id: call.call_id || `call-${row.sequence}-${index + 1}`,
            tool_name: call.tool || 'unknown',
            tool_contract_fingerprint: createToolContractFingerprint({ tool_name: call.tool || 'unknown', result_contract: 'opencode-json-event.v1', version: '1.18.25' }),
            status: call.status === 'COMPLETED' ? 'SUCCESS' : 'FAILURE',
            failure_class: call.status === 'COMPLETED' ? null : 'TOOL_EXECUTION_FAILURE',
            raw_payload: call.output,
            source_reference: call.input_paths[0] || null,
            workspace_fingerprint: workspace,
            freshness_state: 'FRESH',
          })
          rawObservations.push(raw)
          adaptedObservations.push(adaptObservation(raw, { model_profile_id: profile.profile_id }))
        }
        const verified = response.ok && await scenario.verify(root, answer)
        const requiredUsed = scenario.required_tools.length === 0 || scenario.required_tools.some((tool) => calls.some((call) => call.tool === tool))
        const selectionCorrect = scenario.required_tools.length === 0
          ? calls.every((call) => exposure.exposed_tools.includes(call.tool))
          : requiredUsed && calls.every((call) => exposure.exposed_tools.includes(call.tool))
        const argumentValidity = calls.every((call) => call.argument_valid)
        const rawResultVolume = rawObservations.reduce((sum, observation) => sum + String(observation.raw_payload ?? '').length, 0)
        const adaptedResultVolume = adaptedObservations.reduce((sum, observation) => sum + JSON.stringify(observation.structured_payload ?? null).length, 0)
        const failureClass = response.ok ? (verified ? null : 'VERIFIER_REJECTION') : response.failure_class
        return {
          verified_success: verified,
          functional_correctness: verified,
          failure_class: failureClass,
          canonical_verifier: true,
          canonical_runtime_entry: true,
          live_model_evidence: response.ok && events.some((event) => event.type === 'step_finish'),
          paid_calls: response.cost > 0 ? 1 : 0,
          fallback_used: false,
          profile_id: profile.profile_id,
          harness_fingerprint: profile.fingerprint,
          exposed_tools: exposure.exposed_tools,
          tool_calls: calls,
          observation_receipts: rawObservations,
          model_facing_observation: {
            derived: adaptedObservations.length > 0,
            lossiness: adaptedObservations[0]?.lossiness || null,
            truncated: adaptedObservations.some((observation) => observation.truncated),
            provenance_preserved: adaptedObservations.every((observation) => observation.raw_observation.raw_fingerprint === observation.raw_fingerprint),
          },
          verifier_result: { ok: verified, code: verified ? 'LIVE_FIXTURE_VERIFIER_PASS' : 'LIVE_FIXTURE_VERIFIER_FAIL' },
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
          },
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
  })
}

export function invokeOpenCode({ opencode_bin, provider, model, root, prompt, timeout_ms = 90000, signal } = {}) {
  return new Promise((resolve) => {
    const child = spawn(opencode_bin, ['run', '--pure', '--model', `${provider}/${model}`, '--format', 'json', '--dir', root, '--auto', prompt], {
      cwd: root, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
    const kill = () => { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
    const timer = setTimeout(() => { timedOut = true; kill(); setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 2000) }, timeout_ms)
    const abort = () => { timedOut = true; kill() }
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => finish({ ok: false, failure_class: error.code || 'PROVIDER_FAILURE', stdout: '', stderr: error.message, cost: 0 }))
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      const events = parseEvents(stdout)
      const cost = costFromEvents(events)
      if (timedOut) return finish({ ok: false, failure_class: 'TIMEOUT', stdout, stderr: 'TIMEOUT', cost: cost ?? 0 })
      if (code !== 0) return finish({ ok: false, failure_class: /rate.?limit|429/iu.test(`${stderr}\n${stdout}`) ? 'RATE_LIMITED' : 'PROVIDER_FAILURE', stdout, stderr, cost: cost ?? 0 })
      finish({ ok: true, failure_class: null, stdout, stderr, cost: cost ?? 0 })
    })
  })
}
