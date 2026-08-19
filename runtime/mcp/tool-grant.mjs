// SPDX-License-Identifier: MIT
/**
 * Least-privilege worker tool grant.
 *
 * A worker never receives "all tools of every reachable server". It receives
 * exactly the tools its task/plan requires (required + available optional),
 * each bound to a specific server, capability, and operation class
 * (READ_ONLY | MUTATING). Everything else is DENIED at call time.
 *
 * The grant is derived from the SAME capability profile + inventory that the
 * preflight already validated, so no second permission taxonomy is invented.
 */
import { validateCapabilityProfile } from '../../scripts/lib/mcp-preflight.mjs'

export const GRANT_SCHEMA_VERSION = '1.0.0'

const READ_OPERATIONS = new Set(['read', 'list', 'get', 'search', 'query', 'inspect', 'snapshot', 'fetch'])
const WRITE_OPERATIONS = new Set(['write', 'create', 'update', 'delete', 'edit', 'mutation', 'run', 'click', 'type', 'upload'])

export function operationClass(operation = '') {
  const key = String(operation || '').toLowerCase()
  if (WRITE_OPERATIONS.has(key)) return 'MUTATING'
  if (READ_OPERATIONS.has(key)) return 'READ_ONLY'
  return 'UNCLASSIFIED'
}

function requirementEntries(profile, kind) {
  return (profile?.[kind] || [])
    .map((entry) => (typeof entry === 'string' ? { name: entry } : entry))
    .filter((entry) => entry && typeof entry.name === 'string')
    .map((entry) => ({ ...entry, kind }))
}

function toolOperationHint(tool) {
  const name = String(tool?.name || '').toLowerCase()
  if (name.startsWith('read') || name.startsWith('list') || name.startsWith('get') || name.startsWith('search') || name.startsWith('browser_snapshot') || name.startsWith('browser_network') || name.startsWith('browser_console') || name.startsWith('browser_find') || name.startsWith('browser_wait') || name.startsWith('browser_take_screenshot')) return 'READ_ONLY'
  if (name.startsWith('write') || name.startsWith('create') || name.startsWith('update') || name.startsWith('delete') || name.startsWith('browser_click') || name.startsWith('browser_type') || name.startsWith('browser_run_code') || name.startsWith('browser_file_upload') || name.startsWith('browser_press')) return 'MUTATING'
  return 'UNCLASSIFIED'
}

/**
 * Resolve the least-privilege grant for a worker.
 *
 * Returns:
 *   {
 *     schema_version,
 *     allowed_tools: [{ tool, server, capability, operation_class, required }],
 *     allowed_servers: [serverName, ...],
 *     denied_tools: [...],            // reachable but NOT granted
 *     degraded_tools: [...],          // optional tools that were unavailable
 *     inventory: { serverName: { available, tools: [...] } }  (non-secret metadata)
 *   }
 */
export function resolveToolGrant({ profile, inventory = {}, preflight = null }) {
  const profileIssues = validateCapabilityProfile(profile)
  if (profileIssues.length > 0) {
    return { schema_version: GRANT_SCHEMA_VERSION, approved: false, code: 'FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT', reasons: profileIssues, allowed_tools: [], allowed_servers: [], denied_tools: [], degraded_tools: [], inventory: {} }
  }
  // Reuse the preflight's own resolution when available (no second taxonomy):
  // tools the preflight degraded or failed must not be granted.
  const preflightDegraded = new Set((preflight?.optional_degradations || []).map((entry) => entry.tool))
  const preflightFailed = new Set((preflight?.required_failures || []).map((entry) => entry.tool))
  const requirements = [...requirementEntries(profile, 'required_tools'), ...requirementEntries(profile, 'optional_tools')]
  const allowedTools = []
  const allowedServers = new Set()
  const deniedTools = []
  const degradedTools = []

  for (const requirement of requirements) {
    if (preflightFailed.has(requirement.name) || preflightDegraded.has(requirement.name)) {
      const reason = preflightFailed.has(requirement.name) ? 'MCP_REQUIRED_CAPABILITY_UNAVAILABLE' : 'MCP_OPTIONAL_CAPABILITY_UNAVAILABLE'
      if (requirement.kind === 'required_tools') deniedTools.push({ tool: requirement.name, server: requirement.server || null, reason })
      else degradedTools.push({ tool: requirement.name, server: requirement.server || null, reason })
      continue
    }
    const candidates = []
    for (const [serverName, server] of Object.entries(inventory || {})) {
      if (requirement.server && requirement.server !== serverName) continue
      if (server?.available !== true) continue
      for (const tool of server.tools || []) {
        if (tool.name === requirement.name) candidates.push({ serverName, tool })
      }
    }
    if (candidates.length === 0) {
      if (requirement.kind === 'required_tools') deniedTools.push({ tool: requirement.name, server: requirement.server || null, reason: 'MCP_REQUIRED_CAPABILITY_UNAVAILABLE' })
      else degradedTools.push({ tool: requirement.name, server: requirement.server || null, reason: 'MCP_OPTIONAL_CAPABILITY_UNAVAILABLE' })
      continue
    }
    const chosen = candidates[0]
    allowedServers.add(chosen.serverName)
    const operationClassValue = operationClass(toolOperationHint(chosen.tool) === 'UNCLASSIFIED' ? requirement.operation : toolOperationHint(chosen.tool))
    allowedTools.push({
      tool: chosen.tool.name,
      server: chosen.serverName,
      capability: requirement.name,
      operation_class: operationClassValue,
      required: requirement.kind === 'required_tools',
    })
  }

  const reachableTools = []
  for (const [serverName, server] of Object.entries(inventory || {})) {
    if (server?.available !== true) continue
    for (const tool of server.tools || []) {
      reachableTools.push({ tool: tool.name, server: serverName })
    }
  }
  for (const entry of reachableTools) {
    if (!allowedTools.some((allowed) => allowed.tool === entry.tool && allowed.server === entry.server)) {
      deniedTools.push({ tool: entry.tool, server: entry.server, reason: 'MCP_TOOL_NOT_GRANTED' })
    }
  }

  return {
    schema_version: GRANT_SCHEMA_VERSION,
    approved: !deniedTools.some((entry) => entry.reason === 'MCP_REQUIRED_CAPABILITY_UNAVAILABLE'),
    required_available: !deniedTools.some((entry) => entry.reason === 'MCP_REQUIRED_CAPABILITY_UNAVAILABLE'),
    allowed_tools: allowedTools,
    allowed_servers: [...allowedServers],
    denied_tools: deniedTools,
    degraded_tools: degradedTools,
    inventory: Object.fromEntries(
      Object.entries(inventory || {})
        .filter(([, server]) => server?.available === true)
        .map(([name, server]) => [name, { available: true, tools: (server.tools || []).map((tool) => ({ name: tool.name, version: tool.version || null, operations: tool.operations || [] })) }]),
    ),
  }
}

/**
 * Call-time enforcement. Returns { allowed: true } or a DENIED code.
 * This is the boundary that rejects tool scope drift, server scope drift,
 * and unauthorized mutation.
 */
export function assertToolAllowed({ grant, server, tool, operation = null }) {
  if (!grant || !Array.isArray(grant.allowed_tools)) return { allowed: false, code: 'MCP_GRANT_UNAVAILABLE' }
  if (!grant.allowed_servers.includes(server)) return { allowed: false, code: 'MCP_SERVER_SCOPE_DENIED' }
  const entry = grant.allowed_tools.find((item) => item.tool === tool && item.server === server)
  if (!entry) return { allowed: false, code: 'MCP_TOOL_SCOPE_DENIED' }
  if (operation && operationClass(operation) === 'MUTATING' && entry.operation_class !== 'MUTATING') {
    return { allowed: false, code: 'MCP_MUTATION_SCOPE_DENIED' }
  }
  return { allowed: true, code: 'MCP_CAPABILITY_ALLOWED', entry }
}
