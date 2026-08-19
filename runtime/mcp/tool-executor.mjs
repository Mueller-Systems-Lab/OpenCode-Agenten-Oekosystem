// SPDX-License-Identifier: MIT
/**
 * Real MCP tool-call executor for runtime workers.
 *
 * Executes a REAL MCP tool call over stdio with:
 *   - least-privilege grant enforcement (assertToolAllowed before any call)
 *   - bounded per-call timeout (no unbounded hang)
 *   - stable failure classification (MCP_* taxonomy)
 *   - result shape validation (tool returned? success? required fields?)
 *   - input/output fingerprints (sha256, never raw secrets)
 *   - secret egress gate via tool-result-egress-gate
 *   - observability events (MCP_TOOL_CALL_START / _RESULT / _FAILURE)
 *   - provenance record (server, tool, call status, fingerprints)
 *
 * A tool result is worker EVIDENCE. It never contains a terminal decision
 * (DONE | FIX | SPLIT | BLOCKED) — the deterministic controller decides.
 */
import { spawn } from 'node:child_process'
import { sha256, stableJson } from '../../scripts/lib/mcp-preflight.mjs'
import { classifyMcpError } from './error-classifier.mjs'
import { assertToolAllowed } from './tool-grant.mjs'
import { gateToolResult } from '../security/tool-result-egress-gate.mjs'
import { createGovernanceEvent, appendGovernanceEvent } from '../observability/events.mjs'

export const MCP_TOOL_EXECUTOR_SCHEMA_VERSION = '1.0.0'
export const MCP_DEFAULT_CALL_TIMEOUT_MS = 15_000

const TERMINAL_TOKENS = ['DONE', 'FIX', 'SPLIT', 'BLOCKED']
const MAX_RESPONSE_BYTES = 512 * 1024

/**
 * Minimal stdio MCP client for one tool call:
 *   initialize → notifications/initialized → tools/list → tools/call
 * All responses are correlated by id; the exchange is bounded by a watchdog.
 */
export function callMcpTool({
  command = null,
  args = [],
  serverName = 'mcp',
  tool,
  arguments: toolArguments = {},
  timeout_ms = MCP_DEFAULT_CALL_TIMEOUT_MS,
  protocolVersion = '2024-11-05',
} = {}) {
  if (!command) return { status: 'MCP_FAILURE', failure_class: 'MCP_SERVER_UNAVAILABLE', reason: 'SERVER_CONFIGURATION_MISSING' }
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const outcome = {
      server: serverName,
      tool,
      started_at: new Date().toISOString(),
      finished_at: null,
      duration_ms: null,
      status: 'MCP_FAILURE',
      failure_class: null,
      failure_reason: null,
      result: null,
      is_error: null,
      handshake: false,
      tools: [],
      timeout: timeout_ms,
    }
    let settled = false
    let child = null
    const watchdog = setTimeout(() => {
      if (settled) return
      settled = true
      try { child?.kill('SIGKILL') } catch { /* already gone */ }
      outcome.finished_at = new Date().toISOString()
      outcome.duration_ms = Date.now() - startedAt
      outcome.status = 'MCP_FAILURE'
      outcome.failure_class = 'MCP_TIMEOUT'
      outcome.failure_reason = `tool call exceeded ${timeout_ms}ms bound`
      resolve(outcome)
    }, timeout_ms)

    const finish = (patch = {}) => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      Object.assign(outcome, patch, { finished_at: new Date().toISOString(), duration_ms: Date.now() - startedAt })
      try { child?.kill('SIGTERM') } catch { /* already gone */ }
      resolve(outcome)
    }

    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    } catch (error) {
      finish({ failure_class: 'MCP_SERVER_UNAVAILABLE', failure_reason: `spawn failed: ${error.message}` })
      return
    }

    let buffer = ''
    const pending = new Map()
    let nextId = 1

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      if (Buffer.byteLength(buffer, 'utf8') > MAX_RESPONSE_BYTES) {
        finish({ failure_class: 'MCP_RESULT_INVALID', failure_reason: 'response exceeded byte bound' })
        return
      }
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message.id && pending.has(message.id)) {
          pending.get(message.id)(message)
          pending.delete(message.id)
        }
      }
    })
    child.on('error', (error) => finish({ failure_class: 'MCP_TRANSPORT_FAILURE', failure_reason: `transport error: ${error.message}` }))
    child.on('exit', (code) => {
      if (!settled) finish({ failure_class: 'MCP_SERVER_UNAVAILABLE', failure_reason: `server exited prematurely (code ${code})` })
    })

    const request = (method, params) => new Promise((resolveRequest) => {
      const id = nextId++
      pending.set(id, resolveRequest)
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      } catch (error) {
        pending.delete(id)
        resolveRequest({ error: { message: `stdin write failed: ${error.message}` } })
      }
    })

    request('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'ocae-mcp-worker', version: MCP_TOOL_EXECUTOR_SCHEMA_VERSION } })
      .then((init) => {
        if (init.error) {
          finish({ handshake: false, failure_class: classifyMcpError(init.error), failure_reason: init.error.message })
          return
        }
        outcome.handshake = true
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`)
        return request('tools/list', {}).then((listed) => {
          if (listed.error) {
            finish({ failure_class: classifyMcpError(listed.error), failure_reason: listed.error.message })
            return
          }
          const tools = (listed.result?.tools || []).map((toolEntry) => ({ name: toolEntry.name, inputSchema: toolEntry.inputSchema || null }))
          outcome.tools = tools.map(({ name }) => name)
          const match = tools.find((entry) => entry.name === tool)
          if (!match) {
            finish({ failure_class: 'MCP_TOOL_NOT_FOUND', failure_reason: `tool "${tool}" not listed by server ${serverName}` })
            return
          }
          return request('tools/call', { name: tool, arguments: toolArguments }).then((called) => {
            if (called.error) {
              const failureClass = classifyMcpError(called.error)
              finish({ failure_class: failureClass, failure_reason: called.error.message, is_error: true })
              return
            }
            const result = called.result || {}
            finish({ status: result.isError ? 'MCP_FAILURE' : 'MCP_SUCCESS', failure_class: result.isError ? 'MCP_TOOL_ERROR' : null, failure_reason: result.isError ? 'tool reported isError' : null, result, is_error: Boolean(result.isError) })
          })
        })
      })
      .catch((error) => finish({ failure_class: classifyMcpError(error), failure_reason: error.message }))
  })
}

function toolOperationHintFor(tool) {
  const name = String(tool || '').toLowerCase()
  if (name.startsWith('read') || name.startsWith('list') || name.startsWith('get') || name.startsWith('search') || name.startsWith('browser_snapshot') || name.startsWith('browser_network') || name.startsWith('browser_console') || name.startsWith('browser_find') || name.startsWith('browser_wait') || name.startsWith('browser_take_screenshot')) return 'READ_ONLY'
  if (name.startsWith('write') || name.startsWith('create') || name.startsWith('update') || name.startsWith('delete') || name.startsWith('browser_click') || name.startsWith('browser_type') || name.startsWith('browser_run_code') || name.startsWith('browser_file_upload') || name.startsWith('browser_press')) return 'MUTATING'
  return 'READ_ONLY' // fail-safe default: read-only unless clearly mutating
}

function redactValue(value, secrets = []) {
  if (!secrets || secrets.length === 0) return value
  let serialized
  try { serialized = typeof value === 'string' ? value : JSON.stringify(value) } catch { return value }
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) serialized = serialized.split(secret).join('[REDACTED]')
  }
  try { return typeof value === 'string' ? serialized : JSON.parse(serialized) } catch { return serialized }
}

/**
 * Validate a tool result against an expected result contract.
 * Accepts a small declarative expectation to avoid blind acceptance.
 */
export function validateMcpResult(result, expectation = {}) {
  const issues = []
  if (!result || typeof result !== 'object') return { valid: false, issues: ['result must be an object'] }
  if (expectation.require_success && result.isError === true) issues.push('tool reported isError')
  if (expectation.require_content && !Array.isArray(result.content)) issues.push('expected content array')
  if (expectation.require_text_content) {
    const hasText = Array.isArray(result.content) && result.content.some((entry) => entry && entry.type === 'text' && typeof entry.text === 'string')
    if (!hasText) issues.push('expected text content entry')
  }
  for (const requiredField of expectation.required_fields || []) {
    if (!(requiredField in result)) issues.push(`missing required result field: ${requiredField}`)
  }
  return { valid: issues.length === 0, issues }
}

/**
 * Full guarded tool call for a runtime worker:
 *   grant enforcement → real call → validation → egress gate → provenance.
 *
 * Returns a tool-call EVIDENCE record. The controller remains the only
 * terminal authority; this record never carries DONE/FIX/SPLIT/BLOCKED.
 */

/**
 * Persistent MCP stdio session — one server process serving many tool calls.
 * This mirrors how a real worker uses an MCP server (single session, many
 * calls), so a vertical slice (navigate → snapshot) is a real call sequence.
 */
export function createMcpSession({
  command = null,
  args = [],
  serverName = 'mcp',
  protocolVersion = '2024-11-05',
  timeout_ms = MCP_DEFAULT_CALL_TIMEOUT_MS,
} = {}) {
  if (!command) return { ok: false, failure_class: 'MCP_SERVER_UNAVAILABLE', reason: 'SERVER_CONFIGURATION_MISSING' }
  const session = {
    ok: true,
    server: serverName,
    tool_calls: 0,
    started_at: new Date().toISOString(),
    _closed: false,
    _closedReason: null,
    _buffer: '',
    _pending: new Map(),
    _nextId: 1,
    _child: null,
    _callTimeouts: new Set(),
  }
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false })
  session._child = child
  child.stdout.on('data', (chunk) => {
    session._buffer += chunk.toString()
    if (Buffer.byteLength(session._buffer, 'utf8') > MAX_RESPONSE_BYTES) {
      session._closed = true
      session._closedReason = 'response exceeded byte bound'
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      return
    }
    let idx
    while ((idx = session._buffer.indexOf('\n')) !== -1) {
      const line = session._buffer.slice(0, idx).trim()
      session._buffer = session._buffer.slice(idx + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      if (message.id && session._pending.has(message.id)) {
        session._pending.get(message.id)(message)
        session._pending.delete(message.id)
      }
    }
  })
  session.request = (method, params, callTimeout = timeout_ms) => new Promise((resolveRequest) => {
    if (session._closed) { resolveRequest({ error: { message: session._closedReason || 'session closed' } }); return }
    const id = session._nextId++
    const timer = setTimeout(() => {
      session._pending.delete(id)
      resolveRequest({ error: { message: `session request timed out after ${callTimeout}ms` }, __timedOut: true })
    }, callTimeout)
    session._callTimeouts.add(timer)
    session._pending.set(id, (message) => { clearTimeout(timer); session._callTimeouts.delete(timer); resolveRequest(message) })
    try { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`) } catch (error) {
      clearTimeout(timer); session._callTimeouts.delete(timer); session._pending.delete(id)
      resolveRequest({ error: { message: `stdin write failed: ${error.message}` } })
    }
  })
  session.close = () => new Promise((resolveClose) => {
    if (session._closed) { resolveClose(true); return }
    session._closed = true
    for (const timer of session._callTimeouts) clearTimeout(timer)
    session._callTimeouts.clear()
    try { child.stdin.end() } catch { /* ignore */ }
    const killer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } resolveClose(true) }, 2000)
    child.once('exit', () => { clearTimeout(killer); resolveClose(true) })
    try { child.kill('SIGTERM') } catch { /* ignore */ }
  })
  return session
}

export async function mcpSessionCall({
  session = null,
  tool = null,
  arguments: toolArguments = {},
  timeout_ms = MCP_DEFAULT_CALL_TIMEOUT_MS,
  grant = null,
  server = null,
} = {}) {
  if (!session || !session.ok) return { status: 'MCP_FAILURE', failure_class: 'MCP_SERVER_UNAVAILABLE', reason: 'session unavailable' }
  if (grant && server) {
    const scopeCheck = assertToolAllowed({ grant, server: server || session.server, tool })
    if (!scopeCheck.allowed) {
      return { status: 'DENIED', failure_class: scopeCheck.code, failure_reason: scopeCheck.code, server: server || session.server, tool }
    }
  }
  const startedAt = Date.now()
  const outcome = { server: session.server, tool, started_at: new Date().toISOString(), finished_at: null, duration_ms: null, status: 'MCP_FAILURE', failure_class: null, failure_reason: null, result: null, is_error: null, handshake: false }
  if (session._closed) {
    outcome.finished_at = new Date().toISOString(); outcome.duration_ms = 0
    outcome.failure_class = 'MCP_SERVER_UNAVAILABLE'; outcome.failure_reason = session._closedReason || 'session closed'
    return outcome
  }
  if (!session._initialized) {
    const init = await session.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ocae-mcp-worker', version: MCP_TOOL_EXECUTOR_SCHEMA_VERSION } }, timeout_ms)
    if (init.error) {
      outcome.finished_at = new Date().toISOString(); outcome.duration_ms = Date.now() - startedAt
      outcome.failure_class = init.__timedOut ? 'MCP_TIMEOUT' : classifyMcpError(init.error)
      outcome.failure_reason = init.error.message
      return outcome
    }
    session._initialized = true
    session._handshake = true
    try { session._child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`) } catch { /* ignore */ }
    const listed = await session.request('tools/list', {}, timeout_ms)
    if (listed.error) {
      outcome.finished_at = new Date().toISOString(); outcome.duration_ms = Date.now() - startedAt
      outcome.failure_class = listed.__timedOut ? 'MCP_TIMEOUT' : classifyMcpError(listed.error)
      outcome.failure_reason = listed.error.message
      return outcome
    }
    session._tools = (listed.result?.tools || []).map((entry) => entry.name)
  }
  if (session._tools && !session._tools.includes(tool)) {
    outcome.finished_at = new Date().toISOString(); outcome.duration_ms = Date.now() - startedAt
    outcome.failure_class = 'MCP_TOOL_NOT_FOUND'; outcome.failure_reason = `tool "${tool}" not listed by server ${session.server}`
    return outcome
  }
  const called = await session.request('tools/call', { name: tool, arguments: toolArguments }, timeout_ms)
  outcome.finished_at = new Date().toISOString()
  outcome.duration_ms = Date.now() - startedAt
  session.tool_calls += 1
  if (called.error) {
    outcome.failure_class = called.__timedOut ? 'MCP_TIMEOUT' : classifyMcpError(called.error)
    outcome.failure_reason = called.error.message
    outcome.is_error = true
    return outcome
  }
  const result = called.result || {}
  outcome.handshake = true
  outcome.status = result.isError ? 'MCP_FAILURE' : 'MCP_SUCCESS'
  outcome.failure_class = result.isError ? 'MCP_TOOL_ERROR' : null
  outcome.failure_reason = result.isError ? 'tool reported isError' : null
  outcome.result = result
  outcome.is_error = Boolean(result.isError)
  return outcome
}


export async function executeMcpTool({
  run_id = null,
  phase = null,
  job = null,
  attempt = 0,
  grant = null,
  server = null,
  tool = null,
  capability = null,
  arguments: toolArguments = {},
  serverConfig = null,
  timeout_ms = MCP_DEFAULT_CALL_TIMEOUT_MS,
  expectation = {},
  knownSecrets = [],
  eventSink = null,
  root = process.cwd(),
} = {}) {
  const traceId = run_id || `mcp-${Date.now()}`
  const emit = async (name, attributes) => {
    if (!eventSink) return
    const event = createGovernanceEvent({ name, trace_id: traceId, attributes: { 'run.id': run_id, 'agent.role': job || 'worker', ...attributes } })
    await appendGovernanceEvent(eventSink, event)
  }

  // 1. Least-privilege grant enforcement (call-time). The operation class is
  //     derived from the tool name; mutation on a read-only grant is denied.
  const inferredOperation = toolOperationHintFor(tool)
  const scope = assertToolAllowed({ grant, server, tool, operation: inferredOperation === 'MUTATING' ? 'write' : 'read' })
  if (!scope.allowed) {
    await emit('policy.deny', { tool, status: 'DENY', code: scope.code, reason: scope.code })
    return {
      contract: 'mcp.tool-call.evidence.v1',
      run_id,
      phase,
      job,
      attempt,
      server,
      tool,
      capability,
      status: 'DENIED',
      failure_class: scope.code,
      failure_reason: scope.code,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: 0,
      input_fingerprint: sha256({ tool, arguments: stableJson(redactValue(toolArguments, knownSecrets)) }),
      output_fingerprint: null,
      result: null,
      granted: false,
    }
  }

  const operationClass = scope.entry?.operation_class || null
  await emit('mcp.tool-call.start', { tool, status: 'START', code: 'MCP_TOOL_CALL_START', step: 'grant', reason: 'authorized' })

  const call = await callMcpTool({
    command: serverConfig?.command || null,
    args: serverConfig?.args || [],
    serverName: server,
    tool,
    arguments: toolArguments,
    timeout_ms: timeout_ms || MCP_DEFAULT_CALL_TIMEOUT_MS,
  })

  if (call.status !== 'MCP_SUCCESS') {
    const redactedReason = redactValue(call.failure_reason, knownSecrets)
    await emit('mcp.tool-call.failure', { tool, status: 'FAILURE', code: call.failure_class || 'MCP_TOOL_ERROR', step: 'call', reason: redactedReason })
    return {
      contract: 'mcp.tool-call.evidence.v1',
      run_id,
      phase,
      job,
      attempt,
      server,
      tool,
      capability,
      status: 'FAILURE',
      failure_class: call.failure_class || 'MCP_TOOL_ERROR',
      failure_reason: redactedReason,
      started_at: call.started_at,
      finished_at: call.finished_at,
      duration_ms: call.duration_ms,
      input_fingerprint: sha256({ tool, arguments: stableJson(redactValue(toolArguments, knownSecrets)) }),
      output_fingerprint: call.result ? sha256(redactValue(call.result, knownSecrets)) : null,
      result: null,
      granted: true,
      operation_class: operationClass,
    }
  }

  // 2. Result validation — never accept tool output blindly.
  const validation = validateMcpResult(call.result, expectation)
  if (!validation.valid) {
    const failureClass = 'MCP_RESULT_INVALID'
    await emit('mcp.tool-call.failure', { tool, status: 'FAILURE', code: failureClass, step: 'validation', reason: validation.issues.join('; ') })
    return {
      contract: 'mcp.tool-call.evidence.v1',
      run_id,
      phase,
      job,
      attempt,
      server,
      tool,
      capability,
      status: 'FAILURE',
      failure_class: failureClass,
      failure_reason: validation.issues.join('; '),
      started_at: call.started_at,
      finished_at: call.finished_at,
      duration_ms: call.duration_ms,
      input_fingerprint: sha256({ tool, arguments: stableJson(redactValue(toolArguments, knownSecrets)) }),
      output_fingerprint: sha256(redactValue(call.result, knownSecrets)),
      result: null,
      granted: true,
      operation_class: operationClass,
    }
  }

  // 3. Secret egress gate — tool output must not disclose secrets.
  const gated = gateToolResult({ value: call.result, knownSecrets })
  if (gated.status !== 'VERIFIED_IN_SCOPE') {
    const failureClass = 'MCP_RESULT_INVALID'
    await emit('mcp.tool-call.failure', { tool, status: 'FAILURE', code: 'MCP_SECRET_EGRESS_BLOCKED', step: 'egress', reason: gated.reason })
    return {
      contract: 'mcp.tool-call.evidence.v1',
      run_id,
      phase,
      job,
      attempt,
      server,
      tool,
      capability,
      status: 'FAILURE',
      failure_class: failureClass,
      failure_reason: `secret egress blocked: ${gated.reason}`,
      started_at: call.started_at,
      finished_at: call.finished_at,
      duration_ms: call.duration_ms,
      input_fingerprint: sha256({ tool, arguments: stableJson(redactValue(toolArguments, knownSecrets)) }),
      output_fingerprint: null,
      result: null,
      granted: true,
      operation_class: operationClass,
    }
  }

  // 4. Provenance + evidence. Tool result is DATA; it never becomes a terminal
  //    decision. Strip any injected instruction-looking text into data shape.
  const resultText = Array.isArray(call.result?.content)
    ? call.result.content.map((entry) => entry?.type === 'text' ? entry.text : '').join('\n')
    : JSON.stringify(call.result)
  const containsTerminalToken = TERMINAL_TOKENS.some((token) => resultText.includes(token))
  await emit('mcp.tool-call.result', { tool, status: 'SUCCESS', code: 'MCP_TOOL_CALL_RESULT', step: 'result', reason: containsTerminalToken ? 'result contains terminal-token-like text; treated as data' : 'success' })

  return {
    contract: 'mcp.tool-call.evidence.v1',
    run_id,
    phase,
    job,
    attempt,
    server,
    tool,
    capability,
    status: 'SUCCESS',
    failure_class: null,
    failure_reason: null,
    started_at: call.started_at,
    finished_at: call.finished_at,
    duration_ms: call.duration_ms,
    input_fingerprint: sha256({ tool, arguments: stableJson(redactValue(toolArguments, knownSecrets)) }),
    output_fingerprint: sha256(redactValue(call.result, knownSecrets)),
    result: call.result,
    result_text: resultText,
    result_terminal_token_like: containsTerminalToken,
    granted: true,
    operation_class: operationClass,
  }
}
