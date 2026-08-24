// SPDX-License-Identifier: MIT
/**
 * Real MCP server registry for runtime workers.
 *
 * Loads the MCP configuration that the running OpenCode actually uses
 * (repo opencode.jsonc merged over the global ~/.config/opencode config),
 * normalizes the OpenCode config shape (command array / remote URLs) into
 * the preflight inventory shape, and runs the REAL stdio handshake discovery
 * via scripts/lib/mcp-preflight.mjs discoverMcpServers.
 *
 * No server is granted automatically — the registry only produces the
 * inventory; least-privilege grants come from runtime/mcp/tool-grant.mjs.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverMcpServers } from '../../scripts/lib/mcp-preflight.mjs'
import { parseJsonc } from '../../scripts/lib/jsonc.mjs'

export const MCP_TRUST_TIERS_PATH = path.join(process.cwd(), '.opencode', 'policies', 'mcp-trust-tiers.json')

let trustTierCache = null
export function loadTrustTierPolicy({ repoRoot = process.cwd() } = {}) {
  if (trustTierCache) return trustTierCache
  try {
    const text = fs.readFileSync(path.join(repoRoot, '.opencode', 'policies', 'mcp-trust-tiers.json'), 'utf8')
    trustTierCache = JSON.parse(text) || {}
  } catch {
    trustTierCache = {}
  }
  return trustTierCache
}

/**
 * Resolve the canonical trust tier for a server name from the policy file
 * (REUSE BEFORE BUILD — no second permission taxonomy). Unknown servers
 * default to 0_readonly, matching the policy's default_tier_for_unknown.
 */
export function trustTierForServer(serverName, { repoRoot = process.cwd() } = {}) {
  const policy = loadTrustTierPolicy({ repoRoot })
  const tiers = policy?.tiers || {}
  for (const [tier, definition] of Object.entries(tiers)) {
    if (Array.isArray(definition?.servers) && definition.servers.includes(serverName)) return tier
  }
  return policy?.default_tier_for_unknown || '0_readonly'
}

export const MCP_REGISTRY_SCHEMA_VERSION = '1.0.0'

const GLOBAL_CONFIG_CANDIDATES = [
  path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
  path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
]

function loadConfigFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    return parseJsonc(text)
  } catch {
    return null
  }
}

export function loadMcpConfig({ repoRoot = process.cwd(), env = process.env } = {}) {
  const configs = {}
  // Global config first (lower precedence), repo config overrides it.
  for (const candidate of GLOBAL_CONFIG_CANDIDATES) {
    const globalConfig = loadConfigFile(candidate)
    if (globalConfig?.mcp && typeof globalConfig.mcp === 'object') {
      for (const [name, entry] of Object.entries(globalConfig.mcp)) {
        if (entry && typeof entry === 'object' && entry.enabled !== false) configs[name] = { ...entry }
      }
    }
  }
  const repoConfig = loadConfigFile(path.join(repoRoot, 'opencode.jsonc')) || loadConfigFile(path.join(repoRoot, 'opencode.json'))
  if (repoConfig?.mcp && typeof repoConfig.mcp === 'object') {
    for (const [name, entry] of Object.entries(repoConfig.mcp)) {
      if (entry && typeof entry === 'object' && entry.enabled === true) configs[name] = { ...configs[name], ...entry }
    }
  }
  return configs
}

/**
 * Normalize one OpenCode MCP entry into the preflight config shape.
 * Remote (SSE/streamable HTTP) entries without a local command are reported
 * as unavailable-with-config (they cannot be stdio-discovered here).
 */
export function normalizeMcpEntry(name, entry) {
  const base = {
    name,
    available: false,
    enabled: Boolean(entry?.enabled),
    config_present: true,
    transport: 'unknown',
    reason: null,
    tools: [],
  }
  if (!entry || typeof entry !== 'object') return { ...base, reason: 'SERVER_CONFIGURATION_MISSING' }
  if (entry.command) {
    const commandList = Array.isArray(entry.command) ? entry.command : [entry.command]
    if (commandList.length === 0) return { ...base, reason: 'SERVER_CONFIGURATION_MISSING' }
    return {
      ...base,
      transport: 'stdio',
      command: commandList[0],
      args: commandList.slice(1),
      cwd: entry.cwd || process.cwd(),
      timeout_ms: entry.timeout || entry.timeout_ms || 5000,
      trust_tier: entry.trust_tier || trustTierForServer(name),
      environment: entry.environment || {},
    }
  }
  if (entry.url) {
    return { ...base, transport: 'remote', url: entry.url, reason: 'REMOTE_TRANSPORT_NOT_STDIO_DISCOVERABLE' }
  }
  return { ...base, reason: 'SERVER_CONFIGURATION_MISSING' }
}

/**
 * Discover real servers: returns the inventory in preflight shape, plus
 * per-server metadata. Only stdio servers are live-discovered; remote entries
 * are reported as unavailable (they are never granted automatically).
 */
export function discoverRealMcpServers({ repoRoot = process.cwd(), env = process.env } = {}) {
  const configs = loadMcpConfig({ repoRoot, env })
  const normalized = {}
  for (const [name, entry] of Object.entries(configs)) {
    const normalizedEntry = normalizeMcpEntry(name, entry)
    if (normalizedEntry.command) {
      normalized[name] = {
        command: normalizedEntry.command,
        args: normalizedEntry.args,
        cwd: normalizedEntry.cwd,
        timeout_ms: normalizedEntry.timeout_ms,
        trust_tier: normalizedEntry.trust_tier,
      }
    }
  }
  const inventory = discoverMcpServers(normalized)
  return {
    schema_version: MCP_REGISTRY_SCHEMA_VERSION,
    configured_servers: Object.keys(configs),
    reachable_servers: Object.entries(inventory).filter(([, server]) => server.available === true).map(([name]) => name),
    unavailable_servers: Object.entries(inventory).filter(([, server]) => server.available !== true).map(([name]) => name),
    inventory,
  }
}
