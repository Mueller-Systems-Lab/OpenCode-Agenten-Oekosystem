import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { appendGovernanceEvent, createGovernanceEvent } from "../../runtime/observability/events.mjs"

export const MCP_PREFLIGHT_FAILURE = "FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT"
export const OPTIONAL_MCP_DEGRADED = "DEGRADED_OPTIONAL_MCP_CAPABILITY"
export const MCP_PREFLIGHT_SCHEMA_VERSION = "1.0.0"

const REQUIRED_PROFILE_KEYS = Object.freeze([
  "agent_id", "role", "required_tools", "optional_tools", "allowed_operations",
  "denied_operations", "allowed_paths", "write_paths", "network_policy",
  "egress_policy", "trust_tier", "tool_version_constraints", "auth_requirement",
  "timeout_ms", "preflight_failure_policy",
])

const TRUST_RANK = Object.freeze({ "0_readonly": 0, "1_sandboxed": 1, "2_trusted": 2 })

export async function loadAgentCapabilityProfile(manifestPath, agentId) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
  const profile = manifest?.catalogs?.agents?.profiles?.[agentId]
  if (!profile) throw new Error(`FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT: capability profile not found for ${agentId}`)
  const issues = validateCapabilityProfile(profile)
  if (issues.length > 0) throw new Error(`FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT: invalid profile for ${agentId}: ${issues.join("; ")}`)
  return profile
}

export function validateCapabilityProfile(profile) {
  const issues = []
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return ["profile must be an object"]
  for (const key of REQUIRED_PROFILE_KEYS) if (!(key in profile)) issues.push(`missing ${key}`)
  for (const key of ["required_tools", "optional_tools", "allowed_operations", "denied_operations", "allowed_paths", "write_paths"]) {
    if (key in profile && !Array.isArray(profile[key])) issues.push(`${key} must be an array`)
  }
  if (profile.preflight_failure_policy && profile.preflight_failure_policy !== MCP_PREFLIGHT_FAILURE) {
    issues.push(`preflight_failure_policy must be ${MCP_PREFLIGHT_FAILURE}`)
  }
  if (profile.timeout_ms !== undefined && (!Number.isInteger(profile.timeout_ms) || profile.timeout_ms <= 0)) issues.push("timeout_ms must be positive")
  if (profile.trust_tier && !(profile.trust_tier in TRUST_RANK)) issues.push(`unknown trust tier: ${profile.trust_tier}`)
  return issues
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
  return JSON.stringify(value)
}

export function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex")
}

export function capabilityProfileHash(profile) {
  return `sha256:${sha256(profile)}`
}

export function preflightFingerprint({ profile, inventory = {}, configHash = null }) {
  return `sha256:${sha256({ schema_version: MCP_PREFLIGHT_SCHEMA_VERSION, profile, inventory, config_hash: configHash })}`
}

export function normalizeInventory(inventory = {}) {
  if (Array.isArray(inventory)) return Object.fromEntries(inventory.map((server) => [server.name, server]))
  return inventory && typeof inventory === "object" ? inventory : {}
}

function requirementOf(value) {
  return typeof value === "string" ? { name: value } : { ...(value || {}) }
}

function allRequirements(profile, kind) {
  return (profile?.[kind] || []).map(requirementOf).filter((item) => item.name)
}

function candidateTools(inventory, requirement) {
  const servers = normalizeInventory(inventory)
  const entries = []
  for (const [serverName, server] of Object.entries(servers)) {
    if (requirement.server && requirement.server !== serverName) continue
    for (const tool of server?.tools || []) {
      if (tool.name === requirement.name) entries.push({ serverName, server, tool })
    }
  }
  return entries
}

function versionParts(value) {
  const match = String(value || "").match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null
}

function compareVersions(left, right) {
  const a = versionParts(left); const b = versionParts(right)
  if (!a || !b) return null
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  return 0
}

function versionMatches(actual, constraint) {
  if (!constraint) return true
  const pieces = Array.isArray(constraint) ? constraint : String(constraint).split(/\s+/).filter(Boolean)
  return pieces.every((piece) => {
    const match = piece.match(/^(>=|<=|>|<|=|~\s*)?\s*(\d+(?:\.\d+){0,2})$/)
    if (!match) return false
    const comparison = compareVersions(actual, match[2])
    if (comparison === null) return false
    switch (match[1] || "=") {
      case ">=": return comparison >= 0
      case "<=": return comparison <= 0
      case ">": return comparison > 0
      case "<": return comparison < 0
      case "~": return comparison >= 0 && versionParts(actual)?.[0] === versionParts(match[2])?.[0]
      default: return comparison === 0
    }
  })
}

function scopeMatches(scope, candidate, root = process.cwd()) {
  const value = String(candidate || "")
  if (!Array.isArray(scope) || scope.length === 0) return false
  const normalized = value.replaceAll("\\", "/")
  const absolute = path.resolve(root, value)
  const rootAbsolute = path.resolve(root)
  const relative = path.relative(rootAbsolute, absolute).replaceAll("\\", "/")
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false
  return scope.some((pattern) => {
    const p = String(pattern).replaceAll("\\", "/")
    if (p === "**") return true
    if (p.endsWith("/**")) return relative === p.slice(0, -3) || relative.startsWith(`${p.slice(0, -3)}/`)
    return normalized === p || relative === p
  })
}

function checkCandidate(candidate, requirement, profile, operation = {}) {
  if (!candidate) return "TOOL_NOT_FOUND"
  const { server, tool } = candidate
  if (server.available !== true) return "SERVER_UNAVAILABLE"
  if (requirement.protocol_versions && !requirement.protocol_versions.includes(server.protocol_version)) return "PROTOCOL_INCOMPATIBLE"
  const versionConstraint = requirement.version || profile.tool_version_constraints?.[requirement.name]
  if (versionConstraint && !versionMatches(tool.version || server.version, versionConstraint)) return "TOOL_VERSION_INCOMPATIBLE"
  if (requirement.operations && !requirement.operations.every((item) => (tool.operations || []).includes(item))) return "OPERATION_UNAVAILABLE"
  const authRequired = requirement.auth_required ?? profile.auth_requirement?.[requirement.name] ?? false
  if (authRequired && server.auth_present !== true) return "AUTH_UNAVAILABLE"
  const requiredTrustTier = requirement.trust_tier || profile.trust_tier
  if (requiredTrustTier && (TRUST_RANK[server.trust_tier] ?? -1) < (TRUST_RANK[requiredTrustTier] ?? 99)) return "TRUST_TIER_INSUFFICIENT"
  if (server.timeout_ms && profile.timeout_ms && server.timeout_ms > profile.timeout_ms) return "TIMEOUT_INCOMPATIBLE"
  if (requirement.network_policy && server.network_policy !== requirement.network_policy) return "NETWORK_POLICY_INCOMPATIBLE"
  if (requirement.egress_policy && server.egress_policy !== requirement.egress_policy) return "EGRESS_POLICY_INCOMPATIBLE"
  if (operation.path && !scopeMatches(requirement.allowed_paths || profile.allowed_paths, operation.path, operation.root)) return "PATH_SCOPE_DENIED"
  if (operation.write && !scopeMatches(requirement.write_paths || profile.write_paths, operation.path, operation.root)) return "WRITE_SCOPE_DENIED"
  return null
}

function evaluateRequirements(profile, inventory, kind) {
  const findings = []
  for (const requirement of allRequirements(profile, kind)) {
    const candidates = candidateTools(inventory, requirement)
    const candidateFailures = candidates.map((candidate) => checkCandidate(candidate, requirement, profile))
    const failure = candidates.length === 0 ? "TOOL_NOT_FOUND" : candidateFailures.some((value) => value === null) ? null : candidateFailures[0]
    if (failure) findings.push({ tool: requirement.name, server: requirement.server || null, code: failure, required: kind === "required_tools" })
  }
  return findings
}

export function runMcpPreflight({ profile, inventory = {}, configHash = null, previous = null } = {}) {
  const profileIssues = validateCapabilityProfile(profile)
  if (profileIssues.length > 0) return { schema_version: MCP_PREFLIGHT_SCHEMA_VERSION, status: MCP_PREFLIGHT_FAILURE, allowed: false, code: MCP_PREFLIGHT_FAILURE, reasons: profileIssues, fingerprint: null, profile_hash: null }
  const fingerprint = preflightFingerprint({ profile, inventory, configHash })
  const profileHash = capabilityProfileHash(profile)
  if (previous && previous.fingerprint === fingerprint && previous.profile_hash === profileHash && ["PASS", OPTIONAL_MCP_DEGRADED].includes(previous.status)) {
    return { ...previous, reused: true }
  }
  const requiredFailures = evaluateRequirements(profile, inventory, "required_tools")
  const optionalFailures = evaluateRequirements(profile, inventory, "optional_tools")
  if (requiredFailures.length > 0) {
    return { schema_version: MCP_PREFLIGHT_SCHEMA_VERSION, status: MCP_PREFLIGHT_FAILURE, allowed: false, code: MCP_PREFLIGHT_FAILURE, required_failures: requiredFailures, optional_degradations: optionalFailures, fingerprint, profile_hash: profileHash, reused: false }
  }
  if (optionalFailures.length > 0) {
    return { schema_version: MCP_PREFLIGHT_SCHEMA_VERSION, status: OPTIONAL_MCP_DEGRADED, allowed: true, code: OPTIONAL_MCP_DEGRADED, required_failures: [], optional_degradations: optionalFailures, fingerprint, profile_hash: profileHash, reused: false }
  }
  return { schema_version: MCP_PREFLIGHT_SCHEMA_VERSION, status: "PASS", allowed: true, code: "MCP_PREFLIGHT_PASS", required_failures: [], optional_degradations: [], fingerprint, profile_hash: profileHash, reused: false }
}

export function authorizeMcpOperation({ profile, tool, operation, path: resourcePath, root } = {}) {
  const issues = validateCapabilityProfile(profile)
  if (issues.length > 0) return { allowed: false, code: MCP_PREFLIGHT_FAILURE, reasons: issues }
  const declared = [...allRequirements(profile, "required_tools"), ...allRequirements(profile, "optional_tools")].find((item) => item.name === tool)
  if (!declared) return { allowed: false, code: "UNDECLARED_MCP_CAPABILITY" }
  if ((profile.denied_operations || []).includes(operation)) return { allowed: false, code: "MCP_OPERATION_DENIED" }
  if (!(profile.allowed_operations || []).includes(operation)) return { allowed: false, code: "MCP_OPERATION_NOT_DECLARED" }
  if (resourcePath && !scopeMatches(declared.allowed_paths || profile.allowed_paths, resourcePath, root)) return { allowed: false, code: "MCP_PATH_SCOPE_DENIED" }
  if (operation === "write" && !scopeMatches(declared.write_paths || profile.write_paths, resourcePath, root)) return { allowed: false, code: "MCP_WRITE_SCOPE_DENIED" }
  return { allowed: true, code: "MCP_CAPABILITY_ALLOWED" }
}

export async function authorizeMcpOperationWithEvidence({ tracePath, ...input } = {}) {
  const decision = authorizeMcpOperation(input)
  if (tracePath) await appendGovernanceEvent(tracePath, createGovernanceEvent({ name: decision.allowed ? "policy.allow" : "policy.deny", attributes: { "agent.role": input.profile?.role, tool: input.tool, status: decision.allowed ? "ALLOW" : "DENY", code: decision.code, reason: decision.code } }))
  return decision
}

export function discoverMcpServers(configs = {}, { protocolVersion = "2024-11-05" } = {}) {
  const result = {}
  for (const [name, config] of Object.entries(configs || {})) {
    const authPresent = !config.auth_env || (Array.isArray(config.auth_env) ? config.auth_env : [config.auth_env]).every((key) => Boolean(process.env[key]))
    if (!config.command) {
      result[name] = { name, available: false, auth_present: authPresent, reason: "SERVER_CONFIGURATION_MISSING", tools: [] }
      continue
    }
    const input = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {}, clientInfo: { name: "ocae-mcp-preflight", version: "1.0.0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ].map((message) => JSON.stringify(message)).join("\n") + "\n"
    const child = spawnSync(config.command, config.args || [], { cwd: config.cwd || process.cwd(), input, encoding: "utf8", timeout: config.timeout_ms || 5000, stdio: "pipe", shell: false })
    const messages = String(child.stdout || "").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
    const initialize = messages.find((message) => message.id === 1)
    const listed = messages.find((message) => message.id === 2)
    result[name] = {
      name, available: child.status === 0 && !child.error && !initialize?.error && Boolean(listed?.result?.tools),
      protocol_version: initialize?.result?.protocolVersion || null,
      tools: (listed?.result?.tools || []).map((tool) => ({ name: tool.name, version: tool.version || null, operations: tool.operations || [] })),
      auth_present: authPresent,
      trust_tier: config.trust_tier || "0_readonly",
      network_policy: config.network_policy || "deny",
      egress_policy: config.egress_policy || "deny",
      timeout_ms: config.timeout_ms || 5000,
    }
  }
  return result
}
