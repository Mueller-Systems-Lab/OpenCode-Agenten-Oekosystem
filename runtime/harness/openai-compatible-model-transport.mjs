// SPDX-License-Identifier: MIT
/**
 * Canonical, provider-neutral model transport boundary.
 *
 * OCAE owns routing policy and evidence. OpenCode owns the host/session/tool
 * runtime. This module only defines the normalized model transport contract;
 * provider packages, credentials, endpoint conversion, and retry machinery
 * remain behind the supplied adapter implementation.
 */
import crypto from 'node:crypto'

export const MODEL_TRANSPORT_CONTRACT_ID = 'ocae.openai-compatible-model-transport.v1'
export const MODEL_TRANSPORT_CONTRACT_VERSION = '1.0.0'
export const HOST_TRANSPORT = 'OPENCODE'
export const MODEL_TRANSPORT = 'OPENAI_COMPATIBLE_ADAPTER'
export const OPENAI_COMPATIBLE_API_FAMILIES = Object.freeze(['CHAT_COMPLETIONS', 'RESPONSES', 'BOTH_NORMALIZED', 'UNKNOWN'])
export const TRANSPORT_ERROR_CLASSES = Object.freeze([
  'TIMEOUT',
  'RATE_LIMITED',
  'AUTHENTICATION_FAILED',
  'INVALID_REQUEST',
  'TOOL_PROTOCOL_ERROR',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_ERROR',
])

const ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool'])
const FINISH_REASONS = new Set(['stop', 'tool_calls', 'length', 'content_filter', 'error', null])
const SECRET_KEY = /(?:api.?key|authorization|bearer|credential|password|secret|token|cookie)/iu
const SECRET_VALUE = /(?:sk-[A-Za-z0-9_-]{12,}|sk-or-v1-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})/u

function fail(message) { throw new Error(`CONTRACT_INVALID:model-transport:${message}`) }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function transportFingerprint(value) {
  return `sha256:${crypto.createHash('sha256').update(canonical(value)).digest('hex')}`
}

function assertNoCredentials(value, location = 'value') {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail(`${location} contains a raw credential`)
    return
  }
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoCredentials(item, `${location}[${index}]`))
  if (!isObject(value)) return
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && typeof item === 'string' && !/^ENVIRONMENT$|^OPENCODE_AUTH_STORE$/u.test(item)) {
      fail(`${location}.${key} must be a secret reference, not a credential`)
    }
    assertNoCredentials(item, `${location}.${key}`)
  }
}

function normalizeEndpointIdentity(value) {
  if (value === null || value === undefined || value === '') return 'HOST_RESOLVED_ENDPOINT'
  if (typeof value !== 'string') fail('base_endpoint_identity must be a string')
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      fail('base_endpoint_identity must not contain credentials, query, or fragment')
    }
    return `${url.origin}${url.pathname.replace(/\/$/u, '') || '/'}`
  } catch {
    if (!/^[A-Za-z0-9._:/-]{1,200}$/u.test(value)) fail('base_endpoint_identity is not a safe endpoint identity')
    return value
  }
}

function normalizeAuthReference(value, provider) {
  if (value === null || value === undefined) return Object.freeze({ kind: 'OPENCODE_AUTH_STORE', provider })
  if (!isObject(value) || !['ENVIRONMENT', 'OPENCODE_AUTH_STORE'].includes(value.kind)) fail('authentication_reference must use ENVIRONMENT or OPENCODE_AUTH_STORE')
  if (value.kind === 'ENVIRONMENT' && (typeof value.name !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(value.name))) fail('environment authentication reference requires a safe variable name')
  if (value.kind === 'OPENCODE_AUTH_STORE' && (value.provider !== undefined && value.provider !== provider)) fail('auth store provider mismatch')
  const reference = value.kind === 'ENVIRONMENT' ? { kind: value.kind, name: value.name } : { kind: value.kind, provider }
  return Object.freeze(reference)
}

export function createModelTransportIdentity({ provider, model, base_endpoint_identity = null, authentication_reference = null, api_family = 'UNKNOWN' } = {}) {
  if (typeof provider !== 'string' || !provider.trim() || provider.includes('/')) fail('provider must be a non-empty provider id')
  if (typeof model !== 'string' || !model.trim()) fail('model must be a non-empty model id')
  if (!OPENAI_COMPATIBLE_API_FAMILIES.includes(api_family)) fail(`unsupported api_family ${api_family}`)
  const identity = {
    provider: provider.trim(),
    model: model.trim(),
    base_endpoint_identity: normalizeEndpointIdentity(base_endpoint_identity),
    base_endpoint_fingerprint: transportFingerprint(normalizeEndpointIdentity(base_endpoint_identity)),
    authentication_reference: normalizeAuthReference(authentication_reference, provider.trim()),
    api_family,
  }
  assertNoCredentials(identity, 'transport_identity')
  return Object.freeze(identity)
}

function normalizeMessage(message, index) {
  if (!isObject(message) || !ROLES.has(message.role)) fail(`messages[${index}] requires a canonical role`)
  if (typeof message.content !== 'string' && !Array.isArray(message.content) && message.content !== null) fail(`messages[${index}].content must be text, parts, or null`)
  const result = { role: message.role, content: clone(message.content) }
  if (message.name !== undefined) {
    if (typeof message.name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/u.test(message.name)) fail(`messages[${index}].name is invalid`)
    result.name = message.name
  }
  if (message.tool_call_id !== undefined) {
    if (typeof message.tool_call_id !== 'string' || !message.tool_call_id) fail(`messages[${index}].tool_call_id is invalid`)
    result.tool_call_id = message.tool_call_id
  }
  if (message.tool_calls !== undefined) result.tool_calls = normalizeToolCalls(message.tool_calls)
  return result
}

function normalizeToolCalls(calls) {
  if (!Array.isArray(calls)) fail('tool_calls must be an array')
  return calls.map((call, index) => {
    if (!isObject(call) || typeof call.id !== 'string' || !call.id || call.type !== 'function' || !isObject(call.function) || typeof call.function.name !== 'string') fail(`tool_calls[${index}] is not canonical`)
    let argumentsValue = call.function.arguments ?? '{}'
    if (typeof argumentsValue !== 'string') argumentsValue = JSON.stringify(argumentsValue)
    return { id: call.id, type: 'function', function: { name: call.function.name, arguments: argumentsValue } }
  })
}

function normalizeTools(tools) {
  if (tools === undefined) return []
  if (!Array.isArray(tools)) fail('tools must be an array')
  return tools.map((tool, index) => {
    if (!isObject(tool) || tool.type !== 'function' || !isObject(tool.function) || typeof tool.function.name !== 'string' || !isObject(tool.function.parameters)) fail(`tools[${index}] is not a canonical function definition`)
    return { type: 'function', function: { name: tool.function.name, description: typeof tool.function.description === 'string' ? tool.function.description : '', parameters: clone(tool.function.parameters) } }
  })
}

function assertContractRequest(request) {
  if (request?.contract_id !== MODEL_TRANSPORT_CONTRACT_ID || request?.contract_version !== MODEL_TRANSPORT_CONTRACT_VERSION) fail('request contract mismatch')
}

export function createModelTransportRequest({ identity, request_id = crypto.randomUUID(), messages, tools = [], stream = false, timeout_ms = 90_000, metadata = {} } = {}) {
  if (!identity || typeof identity.provider !== 'string' || typeof identity.model !== 'string') fail('request requires a normalized transport identity')
  if (!Array.isArray(messages) || messages.length === 0) fail('messages must be a non-empty array')
  if (typeof request_id !== 'string' || !request_id) fail('request_id must be non-empty')
  if (typeof stream !== 'boolean') fail('stream must be boolean')
  if (!Number.isInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > 3_600_000) fail('timeout_ms is outside the contract bound')
  const request = {
    contract_id: MODEL_TRANSPORT_CONTRACT_ID,
    contract_version: MODEL_TRANSPORT_CONTRACT_VERSION,
    request_id,
    provider: identity.provider,
    model: identity.model,
    messages: messages.map(normalizeMessage),
    tools: normalizeTools(tools),
    stream,
    timeout_ms,
    metadata: clone(metadata),
  }
  assertNoCredentials(request, 'transport_request')
  return Object.freeze(request)
}

export function normalizeTransportResponse(response = {}) {
  if (!isObject(response)) fail('adapter response must be an object')
  const text = typeof response.text === 'string' ? response.text : typeof response.output_text === 'string' ? response.output_text : ''
  const toolCalls = normalizeToolCalls(response.tool_calls || [])
  const finishReason = response.finish_reason ?? response.stop_reason ?? (toolCalls.length ? 'tool_calls' : 'stop')
  if (!FINISH_REASONS.has(finishReason)) fail(`unsupported finish reason ${finishReason}`)
  const usage = response.usage && isObject(response.usage) ? {
    input_tokens: Number.isInteger(response.usage.input_tokens) ? response.usage.input_tokens : null,
    output_tokens: Number.isInteger(response.usage.output_tokens) ? response.usage.output_tokens : null,
    total_tokens: Number.isInteger(response.usage.total_tokens) ? response.usage.total_tokens : null,
  } : null
  const normalized = {
    contract_id: MODEL_TRANSPORT_CONTRACT_ID,
    contract_version: MODEL_TRANSPORT_CONTRACT_VERSION,
    response_id: typeof response.response_id === 'string' ? response.response_id : null,
    text,
    tool_calls: toolCalls,
    finish_reason: finishReason,
    usage,
    structured_metadata: isObject(response.structured_metadata) ? clone(response.structured_metadata) : {},
  }
  assertNoCredentials(normalized, 'transport_response')
  return Object.freeze(normalized)
}

export function normalizeTransportError(error = {}) {
  const status = Number.isInteger(error.status) ? error.status : Number.isInteger(error.statusCode) ? error.statusCode : null
  const code = typeof error.code === 'string' ? error.code : null
  const text = `${code || ''} ${typeof error.message === 'string' ? error.message : ''}`.toLowerCase()
  const errorClass = text.includes('timeout') || code === 'ETIMEDOUT' ? 'TIMEOUT'
    : status === 429 || text.includes('rate limit') ? 'RATE_LIMITED'
      : status === 401 || status === 403 || text.includes('unauthorized') || text.includes('authentication') ? 'AUTHENTICATION_FAILED'
        : status === 400 || status === 422 ? 'INVALID_REQUEST'
          : text.includes('tool') && text.includes('call') ? 'TOOL_PROTOCOL_ERROR'
            : status === 502 || status === 503 || status === 504 || text.includes('unavailable') ? 'PROVIDER_UNAVAILABLE'
              : 'PROVIDER_ERROR'
  return Object.freeze({ contract_id: MODEL_TRANSPORT_CONTRACT_ID, contract_version: MODEL_TRANSPORT_CONTRACT_VERSION, error_class: errorClass, provider_status: status, provider_code: code, retryable: ['TIMEOUT', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE'].includes(errorClass) })
}

export function createOpenAICompatibleModelAdapter({ identity, resolveModel, complete, stream = null } = {}) {
  if (!identity || !identity.provider || !identity.model) fail('adapter identity required')
  if (typeof resolveModel !== 'function' || typeof complete !== 'function') fail('adapter requires resolveModel and complete implementations')
  const contract = Object.freeze({ id: MODEL_TRANSPORT_CONTRACT_ID, version: MODEL_TRANSPORT_CONTRACT_VERSION, api_family: identity.api_family, provider: identity.provider, model: identity.model, fingerprint: transportFingerprint({ id: MODEL_TRANSPORT_CONTRACT_ID, version: MODEL_TRANSPORT_CONTRACT_VERSION, identity }) })
  const adapter = {
    kind: MODEL_TRANSPORT,
    contract,
    async resolveExplicitModel() {
      const resolved = await resolveModel({ provider: identity.provider, model: identity.model })
      if (!isObject(resolved) || resolved.provider !== identity.provider || resolved.model !== identity.model) fail('adapter resolved a different provider/model')
      return Object.freeze({ provider: resolved.provider, model: resolved.model })
    },
    async send(request) {
      assertContractRequest(request)
      await adapter.resolveExplicitModel()
      try { return normalizeTransportResponse(await complete(request)) } catch (error) { throw normalizeTransportError(error) }
    },
    async resume(request, { tool_call_id, content } = {}) {
      if (typeof tool_call_id !== 'string' || !tool_call_id) fail('resume requires tool_call_id')
      if (typeof content !== 'string' && !isObject(content) && !Array.isArray(content)) fail('tool result content is invalid')
      const resumed = createModelTransportRequest({ identity, request_id: request.request_id, messages: [...request.messages, { role: 'tool', tool_call_id, content: typeof content === 'string' ? content : JSON.stringify(content) }], tools: request.tools, stream: request.stream, timeout_ms: request.timeout_ms, metadata: request.metadata })
      return adapter.send(resumed)
    },
    async streamResponse(request) {
      if (typeof stream !== 'function') fail('stream surface is not available for this adapter')
      assertContractRequest(request)
      await adapter.resolveExplicitModel()
      try { return stream(request) } catch (error) { throw normalizeTransportError(error) }
    },
  }
  return Object.freeze(adapter)
}

/**
 * Adapter seam for the OpenCode host. The callback receives only the
 * normalized request. Provider configuration and credentials stay in the
 * OpenCode runtime; host output is retained only as an in-process observation.
 */
export function createOpenCodeModelTransportAdapter({ provider, model, api_family = 'UNKNOWN', base_endpoint_identity = null, authentication_reference = null, invoke, normalize_host_response = null } = {}) {
  if (typeof invoke !== 'function') fail('OpenCode adapter invoke callback required')
  const identity = createModelTransportIdentity({ provider, model, api_family, base_endpoint_identity, authentication_reference })
  const adapter = createOpenAICompatibleModelAdapter({
    identity,
    resolveModel: async (requested) => requested,
    complete: async (request) => {
      const hostResponse = await invoke(request)
      if (!isObject(hostResponse)) fail('OpenCode host response must be an object')
      return { ...hostResponse.normalized_response || hostResponse, structured_metadata: { host_transport: HOST_TRANSPORT, model_transport: MODEL_TRANSPORT, request_id: request.request_id } }
    },
  })
  return Object.freeze({ ...adapter, identity, async sendHost(request) {
    assertContractRequest(request)
    await adapter.resolveExplicitModel()
    try {
      const hostResponse = await invoke(request)
      const normalizedInput = typeof normalize_host_response === 'function'
        ? await normalize_host_response(hostResponse, request)
        : hostResponse.normalized_response || hostResponse
      const normalizedResponse = normalizedInput ? normalizeTransportResponse(normalizedInput) : null
      return Object.freeze({
        ...hostResponse,
        normalized_response: normalizedResponse,
        transport_error: hostResponse.ok === false
          ? normalizeTransportError({ code: hostResponse.failure_class, message: hostResponse.failure_class })
          : null,
      })
    } catch (error) {
      throw normalizeTransportError(error)
    }
  } })
}

export function createHostToolDefinitions(toolNames = []) {
  if (!Array.isArray(toolNames) || toolNames.some((tool) => typeof tool !== 'string')) fail('host tool names must be strings')
  return toolNames.map((name) => ({ type: 'function', function: { name, description: `OpenCode host tool: ${name}`, parameters: { type: 'object', additionalProperties: true } } }))
}

/** Deterministic interoperability gate; it never calls a real model. */
export async function runOpenAICompatibleAdapterConformance() {
  const identity = createModelTransportIdentity({ provider: 'conformance-fixture', model: 'conformance-model', api_family: 'BOTH_NORMALIZED' })
  const seen = []
  const adapter = createOpenAICompatibleModelAdapter({
    identity,
    resolveModel: async (requested) => requested,
    complete: async (request) => {
      seen.push(request)
      const toolResult = request.messages.find((message) => message.role === 'tool')
      return toolResult
        ? { text: 'resumed', finish_reason: 'stop', usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }, structured_metadata: { conformance: true } }
        : { tool_calls: [{ id: 'conformance-call-1', type: 'function', function: { name: 'conformance_tool', arguments: '{}' } }], finish_reason: 'tool_calls', usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } }
    },
  })
  const request = createModelTransportRequest({ identity, request_id: 'conformance-request-1', messages: [{ role: 'system', content: 'conformance' }, { role: 'developer', content: 'conformance' }, { role: 'user', content: 'call the tool' }], tools: createHostToolDefinitions(['conformance_tool']) })
  const checks = {
    explicit_model_resolution: (await adapter.resolveExplicitModel()).model === identity.model,
    normal_request: false,
    tool_definition: request.tools.length === 1 && request.tools[0].type === 'function',
    tool_call: false,
    tool_call_id_preserved: false,
    tool_result_returned: false,
    resumed_generation: false,
    usage_exposed: false,
    canonical_error_classification: normalizeTransportError({ status: 429 }).error_class === 'RATE_LIMITED',
  }
  const first = await adapter.send(request)
  checks.normal_request = seen.length === 1
  checks.tool_call = first.tool_calls.length === 1
  checks.tool_call_id_preserved = first.tool_calls[0]?.id === 'conformance-call-1'
  const second = await adapter.resume(request, { tool_call_id: first.tool_calls[0].id, content: 'tool-result' })
  checks.tool_result_returned = seen[1]?.messages.at(-1)?.content === 'tool-result'
  checks.resumed_generation = second.text === 'resumed' && second.finish_reason === 'stop'
  checks.usage_exposed = second.usage?.total_tokens === 5
  const status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
  return Object.freeze({ status, checks, fingerprint: transportFingerprint({ contract: MODEL_TRANSPORT_CONTRACT_ID, version: MODEL_TRANSPORT_CONTRACT_VERSION, checks }) })
}
