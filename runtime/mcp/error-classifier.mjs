// SPDX-License-Identifier: MIT
/**
 * MCP tool-call failure classification.
 *
 * Worker-facing MCP failures are classified into a stable taxonomy that the
 * deterministic controller and retry policy can consume. These classes are
 * evidence categories, never terminal states — DONE | FIX | SPLIT | BLOCKED
 * remain reserved for the controller.
 */
export const MCP_FAILURE_CLASSES = Object.freeze([
  'MCP_SERVER_UNAVAILABLE',
  'MCP_TOOL_NOT_FOUND',
  'MCP_PERMISSION_DENIED',
  'MCP_SCHEMA_INVALID',
  'MCP_TIMEOUT',
  'MCP_TRANSPORT_FAILURE',
  'MCP_TOOL_ERROR',
  'MCP_RESULT_INVALID',
])

export const MCP_FAILURE_CLASS_SET = new Set(MCP_FAILURE_CLASSES)

/**
 * Map a raw MCP error payload (JSON-RPC error object) plus transport context
 * to a stable failure class. Unknown shapes fail closed to a generic tool
 * error rather than being swallowed.
 */
export function classifyMcpError(error, { timedOut = false, transport = null } = {}) {
  if (timedOut) return 'MCP_TIMEOUT'
  if (transport === 'SPAWN' || transport === 'EXIT') return 'MCP_SERVER_UNAVAILABLE'
  if (transport === 'TRANSPORT') return 'MCP_TRANSPORT_FAILURE'
  if (!error || typeof error !== 'object') return 'MCP_TOOL_ERROR'
  const code = error.code
  const message = String(error.message || error.error || '').toLowerCase()
  if (code === -32602 || /unknown tool|method not found|tool not found/i.test(message)) return 'MCP_TOOL_NOT_FOUND'
  if (code === -32601 || /method not found/i.test(message)) return 'MCP_TOOL_NOT_FOUND'
  if (code === 401 || code === 403 || code === -32001 || /unauthorized|forbidden|permission denied|not authorized|access denied/i.test(message)) return 'MCP_PERMISSION_DENIED'
  if (/invalid schema|schema.*invalid|input.*invalid|validation failed|invalid params/i.test(message)) return 'MCP_SCHEMA_INVALID'
  if (code === -32000 || /internal error|tool execution failed|runtime error/i.test(message)) return 'MCP_TOOL_ERROR'
  return 'MCP_TOOL_ERROR'
}

export function isMcfFailureClass(value) {
  return MCP_FAILURE_CLASS_SET.has(value)
}
