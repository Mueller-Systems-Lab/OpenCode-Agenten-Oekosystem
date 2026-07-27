import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { createUserActionHandoff, validateUserActionHandoff } from "./user-action-handoff.mjs"

const REGISTRY_KIND = "ocae-ecosystem-registry"
const REGISTRY_VERSION = "1.0.0"
const LOCK_RETRIES = 80
const LOCK_DELAY_MS = 15

export function createRegistry() {
  return {
    schema_version: REGISTRY_VERSION,
    kind: REGISTRY_KIND,
    updated_at: new Date().toISOString(),
    projects: [],
  }
}

export function validateRegistry(registry) {
  const issues = []
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) return ["registry must be an object"]
  if (registry.schema_version !== REGISTRY_VERSION) issues.push("unsupported registry schema_version")
  if (registry.kind !== REGISTRY_KIND) issues.push("registry kind mismatch")
  if (!Array.isArray(registry.projects)) issues.push("registry projects must be an array")
  const ids = new Set()
  for (const entry of registry.projects || []) {
    if (!entry || typeof entry !== "object") {
      issues.push("registry entry must be an object")
      continue
    }
    if (!entry.project_id || typeof entry.project_id !== "string") issues.push("registry entry project_id is required")
    if (ids.has(entry.project_id)) issues.push(`duplicate project_id: ${entry.project_id}`)
    ids.add(entry.project_id)
    if (!entry.project || typeof entry.project !== "object") issues.push(`registry entry ${entry.project_id || "unknown"} project is required`)
    if (!entry.classification?.main || !Array.isArray(entry.classification?.substatus)) issues.push(`registry entry ${entry.project_id || "unknown"} classification is invalid`)
    if (Object.hasOwn(entry, "user_action_handoff")) {
      issues.push(...validateUserActionHandoff(entry.user_action_handoff).map((finding) => `registry entry ${entry.project_id || "unknown"} user_action_handoff: ${finding.code}`))
    } else if (Array.isArray(entry.owner_actions) && entry.owner_actions.length > 0) {
      issues.push(`registry entry ${entry.project_id || "unknown"} legacy owner_actions require capability-first migration`)
    }
    if (!entry.updated_at || !Number.isFinite(Date.parse(entry.updated_at))) issues.push(`registry entry ${entry.project_id || "unknown"} updated_at is invalid`)
  }
  return issues
}

export async function readRegistry(registryPath, { allowMissing = true } = {}) {
  const absolute = await assertSafeRegistryPath(registryPath)
  let text
  try {
    text = await fs.readFile(absolute, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT" && allowMissing) return createRegistry()
    throw new Error(`Cannot read registry: ${error?.message || String(error)}`)
  }
  let registry
  try {
    registry = JSON.parse(text)
  } catch {
    throw new Error("Registry JSON is corrupted.")
  }
  const issues = validateRegistry(registry)
  if (issues.length > 0) throw new Error(`Registry validation failed: ${issues.join("; ")}`)
  return registry
}

export async function updateRegistry(registryPath, entry) {
  if (!entry?.project_id || typeof entry.project_id !== "string") throw new Error("Registry entry requires project_id.")
  const absolute = await assertSafeRegistryPath(registryPath)
  return withRegistryLock(absolute, async () => {
    const registry = await readRegistry(absolute)
    const normalized = normalizeEntry(entry)
    const index = registry.projects.findIndex((candidate) => candidate.project_id === normalized.project_id)
    if (index === -1) registry.projects.push(normalized)
    else registry.projects[index] = normalized
    registry.projects.sort((left, right) => left.project_id.localeCompare(right.project_id))
    registry.updated_at = new Date().toISOString()
    await writeRegistry(absolute, registry)
    return normalized
  })
}

export async function removeRegistryEntry(registryPath, projectId) {
  const absolute = await assertSafeRegistryPath(registryPath)
  return withRegistryLock(absolute, async () => {
    const registry = await readRegistry(absolute)
    const before = registry.projects.length
    registry.projects = registry.projects.filter((entry) => entry.project_id !== projectId)
    registry.updated_at = new Date().toISOString()
    await writeRegistry(absolute, registry)
    return { removed: before !== registry.projects.length, project_id: projectId }
  })
}

export function exportPortableRegistry(registry) {
  const issues = validateRegistry(registry)
  if (issues.length > 0) throw new Error(`Registry validation failed: ${issues.join("; ")}`)
  return {
    schema_version: registry.schema_version,
    kind: registry.kind,
    exported_at: new Date().toISOString(),
    projects: registry.projects.map(portableEntry),
  }
}

export async function writeRegistry(registryPath, registry) {
  const absolute = await assertSafeRegistryPath(registryPath)
  const issues = validateRegistry(registry)
  if (issues.length > 0) throw new Error(`Registry validation failed: ${issues.join("; ")}`)
  await fs.mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 })
  await assertSafeRegistryPath(absolute)
  const temporary = `${absolute}.tmp-${process.pid}-${crypto.randomUUID()}`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" })
    await fs.rename(temporary, absolute)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}

export async function withRegistryLock(registryPath, operation) {
  const absolute = await assertSafeRegistryPath(registryPath)
  const lockPath = `${absolute}.lock`
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600)
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }))
        return await operation()
      } finally {
        await handle.close().catch(() => {})
        await fs.rm(lockPath, { force: true }).catch(() => {})
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw new Error(`Cannot acquire registry lock: ${error?.message || String(error)}`)
      await delay(LOCK_DELAY_MS)
    }
  }
  throw new Error(`Registry lock unavailable after ${LOCK_RETRIES} attempts.`)
}

export function projectIdFor({ projectId, projectName, repositoryUrl } = {}) {
  if (projectId) return String(projectId)
  const base = String(projectName || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"
  const fingerprint = crypto.createHash("sha256").update(String(repositoryUrl || base)).digest("hex").slice(0, 12)
  return `${base}-${fingerprint}`
}

function normalizeEntry(entry) {
  const now = new Date().toISOString()
  let userActionHandoff
  if (Object.hasOwn(entry, "user_action_handoff")) {
    const handoffIssues = validateUserActionHandoff(entry.user_action_handoff)
    if (handoffIssues.length > 0) {
      throw new Error(`Invalid user_action_handoff: ${handoffIssues.map((finding) => finding.code).join(", ")}`)
    }
    userActionHandoff = createUserActionHandoff(entry.user_action_handoff.actions)
  } else {
    userActionHandoff = createUserActionHandoff([])
  }
  const normalized = {
    project_id: entry.project_id,
    project: { ...entry.project },
    governance: entry.governance ? { ...entry.governance } : {},
    runtime: entry.runtime ? { ...entry.runtime } : {},
    verification: entry.verification ? { ...entry.verification } : {},
    tool_gaps: Array.isArray(entry.tool_gaps) ? entry.tool_gaps.map(String) : [],
    owner_actions: Array.isArray(entry.owner_actions) ? entry.owner_actions.map(String) : [],
    user_action_handoff: userActionHandoff,
    classification: {
      main: String(entry.classification?.main || "NEEDS_REVIEW"),
      substatus: Array.isArray(entry.classification?.substatus) ? entry.classification.substatus.map(String) : [],
    },
    updated_at: entry.updated_at || now,
  }
  if (entry.local && typeof entry.local === "object") normalized.local = { ...entry.local }
  return normalized
}

function portableEntry(entry) {
  return {
    project_id: safePortableCode(entry.project_id),
    project_name: safePortableName(entry.project?.name),
    governance_version: safePortableVersion(entry.governance?.version),
    runtime: Array.isArray(entry.runtime?.detected) ? entry.runtime.detected.filter((value) => ['opencode', 'hermes', 'odysseus', 'generic'].includes(value)) : [],
    activation_status: safePortableStatus(entry.verification?.activation_status),
    verification_timestamp: Number.isFinite(Date.parse(entry.verification?.last_verification || '')) ? entry.verification.last_verification : null,
    classification: {
      main: ['VERIFIED_IN_SCOPE', 'NEEDS_REVIEW', 'RED_BLOCK', 'TOOL_GAP'].includes(entry.classification?.main) ? entry.classification.main : 'NEEDS_REVIEW',
      substatus: Array.isArray(entry.classification?.substatus) ? entry.classification.substatus.filter((value) => /^[A-Z0-9_-]{1,96}$/.test(String(value))).map(String) : [],
    },
    capability_summary: safePortableCodes(entry.runtime?.capability_summary),
    tool_gap_summary: safePortableCodes(entry.tool_gaps),
  }
}

function safePortableCode(value) {
  const text = String(value || 'unknown')
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(text) ? text : 'REDACTED'
}

function safePortableName(value) {
  const text = String(value || 'unknown').trim()
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/.test(text) ? text : 'REDACTED'
}

function safePortableVersion(value) {
  const text = String(value || 'unknown')
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(text) ? text : 'unknown'
}

function safePortableStatus(value) {
  const text = String(value || 'UNPROVEN')
  return /^[A-Z][A-Z0-9_-]{0,63}$/.test(text) ? text : 'UNPROVEN'
}

function safePortableCodes(values) {
  return Array.isArray(values) ? values.map(String).filter((value) => /^[A-Z][A-Z0-9_-]{0,95}$/.test(value)).slice(0, 64) : []
}

async function assertSafeRegistryPath(registryPath) {
  if (!registryPath || typeof registryPath !== "string") throw new Error("Registry path is required.")
  const absolute = path.resolve(registryPath)
  const existingParent = await nearestExistingParent(path.dirname(absolute))
  if (!existingParent) throw new Error("Registry parent cannot be resolved.")
  await assertNoSymlink(existingParent)
  try {
    const stat = await fs.lstat(absolute)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Registry path must be a regular file, never a symlink.")
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  return absolute
}

async function nearestExistingParent(start) {
  let current = path.resolve(start)
  while (true) {
    try {
      const stat = await fs.lstat(current)
      if (!stat.isDirectory()) throw new Error("Registry parent is not a directory.")
      return current
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function assertNoSymlink(existingDirectory) {
  let current = path.resolve(existingDirectory)
  while (true) {
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink()) throw new Error(`Registry path traverses a symlink: ${current}`)
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
