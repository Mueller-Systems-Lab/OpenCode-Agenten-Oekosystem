import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { assertSafePath, fileHash, relativePath } from "./paths.mjs"

export const LIFECYCLE_OPERATIONS = Object.freeze([
  "INSPECT",
  "PLAN",
  "INSTALL_NEW",
  "UPDATE_EXISTING",
  "VERIFY_ONLY",
  "STATUS",
  "ROLLBACK",
])

export const MAIN_CLASSIFICATIONS = Object.freeze(["VERIFIED_IN_SCOPE", "NEEDS_REVIEW", "RED_BLOCK", "TOOL_GAP"])
export const CLASSIFICATION_PRIORITY = Object.freeze({ RED_BLOCK: 4, NEEDS_REVIEW: 3, TOOL_GAP: 2, VERIFIED_IN_SCOPE: 1 })
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export async function detectInstallationState(targetRoot) {
  const root = await assertTargetRoot(targetRoot)
  const governanceManifest = await readSafeJson(root, ".agent-governance/manifest.json")
  const installationManifest = await readSafeJson(root, ".opencode/ecosystem-installation.json")
  const sourceLock = await readSafeJson(root, ".agent-governance/source-lock.json")
  const overlaySignals = await presentPaths(root, [
    ".opencode/reports/bootstrap/report.json",
    ".opencode/reports/bootstrap/discovery.json",
    ".hermes/bundles/project-bootstrap.json",
  ])
  const governanceDirectory = await pathKind(root, ".agent-governance")
  const governancePresent = Boolean(governanceManifest.value || installationManifest.value || sourceLock.value)
  const errors = [governanceManifest.error, installationManifest.error, sourceLock.error].filter(Boolean)
  let layer_state = "NOT_INSTALLED"
  if (governanceDirectory === "symlink") errors.push(".agent-governance is a symlink")
  if (governanceDirectory && governanceDirectory !== "directory") errors.push(".agent-governance is not a directory")
  if (governanceDirectory === "directory" && !governancePresent) errors.push(".agent-governance exists without a readable governance manifest or source lock")
  if (errors.length > 0) layer_state = "CORRUPT_INSTALLATION"
  else if (governancePresent && overlaySignals.length > 0) layer_state = "BOTH_LAYERS"
  else if (governancePresent) layer_state = "GOVERNANCE_ONLY"
  else if (overlaySignals.length > 0) layer_state = "OVERLAY_ONLY"

  const managed_drift = installationManifest.value ? await collectManagedDrift(root, installationManifest.value) : []
  const current_source_commit = sourceCommit()
  const installed_source_commit = installationManifest.value?.source_commit || sourceLock.value?.source_commit || null
  const runtimes = await detectRuntimes(root)
  return {
    target_root: root,
    layer_state,
    overlay_signals: overlaySignals,
    governance: {
      manifest: governanceManifest.value,
      installation_manifest: installationManifest.value,
      source_lock: sourceLock.value,
      source_commit: installed_source_commit,
      current_source_commit,
      source_status: installed_source_commit && current_source_commit
        ? installed_source_commit === current_source_commit ? "CURRENT" : "UPDATE_AVAILABLE"
        : "UNAVAILABLE",
      installed_at: installationManifest.value?.installed_at || null,
      managed_drift,
      owner_conflicts: (installationManifest.value?.conflicts || []).filter((entry) => /OWNER|CONFLICT/.test(String(entry?.classification || ""))),
    },
    runtimes,
    errors,
  }
}

export async function inspectLifecycle(targetRoot) {
  try {
    const state = await detectInstallationState(targetRoot)
    if (state.layer_state === "CORRUPT_INSTALLATION") return lifecycleResult({
      operation: "INSPECT", classification: "RED_BLOCK", substatus: "INSTALLATION_CORRUPT", state,
      blockers: state.errors, checked_claims: ["target path safety", "installation manifest readability"],
    })
    if (state.governance.managed_drift.length > 0) return lifecycleResult({
      operation: "INSPECT", classification: "NEEDS_REVIEW", substatus: "OWNER_CONTENT_CONFLICT", state,
      blockers: [], owner_actions: ["Review locally modified managed files before update or rollback."],
      checked_claims: ["target path safety", "managed-file hashes"],
    })
    const substatus = state.layer_state === "NOT_INSTALLED"
      ? "NOT_INSTALLED"
      : state.layer_state === "OVERLAY_ONLY"
        ? "OVERLAY_ONLY"
        : state.layer_state === "GOVERNANCE_ONLY"
          ? "GOVERNANCE_ONLY"
          : "BOTH_LAYERS_INSTALLED"
    return lifecycleResult({
      operation: "INSPECT", classification: "NEEDS_REVIEW", substatus, state,
      checked_claims: ["target path safety", "installation layer discovery", "managed-file hashes", "runtime signals"],
      unchecked_claims: ["runtime hook invocation", "restart persistence", "complete bypass coverage"],
      tool_gaps: state.runtimes.length === 0 ? ["RUNTIME_NOT_FOUND"] : [],
    })
  } catch (error) {
    return lifecycleResult({
      operation: "INSPECT", classification: "RED_BLOCK", substatus: "TARGET_PATH_UNSAFE", blockers: [safeError(error)],
      checked_claims: ["target path safety"],
    })
  }
}

export async function planLifecycle(targetRoot) {
  const inspected = await inspectLifecycle(targetRoot)
  if (inspected.classification === "RED_BLOCK") return { ...inspected, operation: "PLAN", plan: [] }
  const state = inspected.state
  const mode = state.layer_state === "NOT_INSTALLED" || state.layer_state === "OVERLAY_ONLY" ? "INSTALL_NEW" : "UPDATE_EXISTING"
  const plan = []
  if (state.layer_state === "NOT_INSTALLED" || state.layer_state === "GOVERNANCE_ONLY") plan.push({ component: "overlay-bootstrap", entrypoint: "scripts/bootstrap-project.mjs", action: "apply", ownership: "overlay artifacts only" })
  if (state.layer_state === "NOT_INSTALLED" || state.layer_state === "OVERLAY_ONLY" || state.layer_state === "GOVERNANCE_ONLY" || state.layer_state === "BOTH_LAYERS") {
    plan.push({ component: "governance-v2", entrypoint: "scripts/install-governance.mjs", action: state.layer_state === "BOTH_LAYERS" ? "update" : "install", ownership: ".agent-governance and generated runtime bridges" })
  }
  plan.push({ component: "runtime-proof", entrypoint: "scripts/ocae.mjs verify", action: "verify", ownership: "evidence only" })
  return {
    ...inspected,
    operation: "PLAN",
    mode,
    plan,
    substatus: state.governance.managed_drift.length > 0 ? "OWNER_CONTENT_CONFLICT" : `${mode}_PLANNED`,
    substatuses: [state.governance.managed_drift.length > 0 ? "OWNER_CONTENT_CONFLICT" : `${mode}_PLANNED`],
    owner_actions: state.governance.managed_drift.length > 0 ? ["Owner approval is required before modifying locally changed managed files."] : inspected.owner_actions,
  }
}

export function resultExitCode(result) {
  if (result?.classification === "VERIFIED_IN_SCOPE" || result?.substatus === "NOOP_IDEMPOTENT") return 0
  if (result?.classification === "RED_BLOCK") return 2
  return 1
}

export function preservePrimaryClassification(result, secondaryFinding) {
  const finding = typeof secondaryFinding === "string"
    ? { type: secondaryFinding, classification: "TOOL_GAP" }
    : { type: "SECONDARY_FAILURE", classification: "TOOL_GAP", ...secondaryFinding }
  return {
    ...result,
    classification: result.classification,
    secondary_findings: [...(result.secondary_findings || []), finding],
  }
}

export function buildRunMetric(input = {}) {
  const now = new Date().toISOString()
  return {
    schema_version: "1.0.0",
    run_id: input.run_id || crypto.randomUUID(),
    project_id: String(input.project_id || "unknown-project"),
    task_id: input.task_id ? String(input.task_id) : null,
    runtime: input.runtime ? String(input.runtime) : null,
    agent: input.agent ? String(input.agent) : null,
    model: input.model ? String(input.model) : null,
    start_time: input.start_time || now,
    end_time: input.end_time || now,
    planned_actions: stringArray(input.planned_actions),
    executed_actions: stringArray(input.executed_actions),
    blocked_actions: stringArray(input.blocked_actions),
    approval_requests: nonNegativeInteger(input.approval_requests),
    approval_receipts: nonNegativeInteger(input.approval_receipts),
    tool_gaps: stringArray(input.tool_gaps),
    test_runs: nonNegativeInteger(input.test_runs),
    failed_tests: nonNegativeInteger(input.failed_tests),
    rollbacks: nonNegativeInteger(input.rollbacks),
    human_corrections: nonNegativeInteger(input.human_corrections),
    final_classification: String(input.final_classification || "NEEDS_REVIEW"),
    evidence_paths: stringArray(input.evidence_paths),
  }
}

export function validateRunMetric(metric) {
  const required = ["schema_version", "run_id", "project_id", "start_time", "end_time", "planned_actions", "executed_actions", "blocked_actions", "approval_requests", "approval_receipts", "tool_gaps", "test_runs", "failed_tests", "rollbacks", "human_corrections", "final_classification", "evidence_paths"]
  const issues = required.filter((key) => !(key in (metric || {}))).map((key) => `missing ${key}`)
  if (metric?.schema_version !== "1.0.0") issues.push("unsupported metrics schema_version")
  for (const key of ["planned_actions", "executed_actions", "blocked_actions", "tool_gaps", "evidence_paths"]) if (!Array.isArray(metric?.[key])) issues.push(`${key} must be an array`)
  for (const key of ["approval_requests", "approval_receipts", "test_runs", "failed_tests", "rollbacks", "human_corrections"]) if (!Number.isInteger(metric?.[key]) || metric[key] < 0) issues.push(`${key} must be a non-negative integer`)
  if (Object.hasOwn(metric || {}, "prompt") || Object.hasOwn(metric || {}, "tool_output")) issues.push("metrics may not contain prompt or tool_output")
  return issues
}

export async function appendRunMetric(targetRoot, metricPath, metric) {
  const root = await assertTargetRoot(targetRoot)
  const destination = path.resolve(metricPath)
  await assertSafePath(root, destination, "metrics destination")
  const issues = validateRunMetric(metric)
  if (issues.length > 0) throw new Error(`Invalid run metric: ${issues.join("; ")}`)
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await assertSafePath(root, destination, "metrics destination")
  await fs.appendFile(destination, `${JSON.stringify(metric)}\n`, { encoding: "utf8", mode: 0o600 })
  return relativePath(root, destination)
}

async function assertTargetRoot(targetRoot) {
  if (!targetRoot) throw new Error("Target path is required.")
  const root = path.resolve(targetRoot)
  const stat = await fs.lstat(root).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`Target does not exist: ${root}`)
    throw error
  })
  if (!stat.isDirectory()) throw new Error(`Target is not a directory: ${root}`)
  if (stat.isSymbolicLink()) throw new Error(`Target is a symlink and is not allowed: ${root}`)
  await assertSafePath(root, root, "target")
  return root
}

async function readSafeJson(root, relative) {
  const absolute = path.join(root, relative)
  try {
    await assertSafePath(root, absolute, relative)
    const stat = await fs.lstat(absolute)
    if (!stat.isFile()) return { value: null, error: `${relative} is not a regular file` }
    return { value: JSON.parse(await fs.readFile(absolute, "utf8")), error: null }
  } catch (error) {
    if (error?.code === "ENOENT" || /ENOENT/.test(String(error?.message || ""))) return { value: null, error: null }
    if (error instanceof SyntaxError) return { value: null, error: `${relative} contains invalid JSON` }
    return { value: null, error: safeError(error) }
  }
}

async function presentPaths(root, relatives) {
  const result = []
  for (const relative of relatives) {
    const kind = await pathKind(root, relative)
    if (kind === "file") result.push(relative)
  }
  return result
}

async function pathKind(root, relative) {
  const absolute = path.join(root, relative)
  try {
    await assertSafePath(root, absolute, relative)
    const stat = await fs.lstat(absolute)
    if (stat.isSymbolicLink()) return "symlink"
    if (stat.isDirectory()) return "directory"
    if (stat.isFile()) return "file"
    return "special"
  } catch (error) {
    if (error?.code === "ENOENT" || /ENOENT/.test(String(error?.message || ""))) return null
    throw error
  }
}

async function collectManagedDrift(root, installation) {
  const drift = []
  for (const [relative, expected] of Object.entries(installation?.file_hashes || {})) {
    const destination = path.join(root, relative)
    try {
      await assertSafePath(root, destination, `managed file ${relative}`)
      const current = `sha256:${await fileHash(destination)}`
      const expectedHash = String(expected).startsWith("sha256:") ? String(expected) : `sha256:${expected}`
      if (current !== expectedHash) drift.push({ path: relative, reason: "HASH_MISMATCH" })
    } catch (error) {
      drift.push({ path: relative, reason: /ENOENT/.test(String(error?.message || "")) ? "MISSING" : "UNSAFE" })
    }
  }
  return drift
}

async function detectRuntimes(root) {
  const runtimes = []
  const opencodeConfig = await presentPaths(root, ["opencode.json", "opencode.jsonc"])
  const opencodeHook = (await pathKind(root, ".opencode/plugin/governance-v2.ts")) === "file"
    ? ".opencode/plugin/governance-v2.ts"
    : (await pathKind(root, ".opencode/plugins/governance-v2.mjs")) === "file"
      ? ".opencode/plugins/governance-v2.mjs"
      : null
  const opencodeRegistered = opencodeHook && await hasOpenCodePluginRegistration(root, opencodeConfig)
  if (opencodeConfig.length > 0 || opencodeHook) runtimes.push({
    name: "opencode", adapter: "opencode", configuration_paths: opencodeConfig,
    hook_path: opencodeHook || null,
    hook_bridge_present: Boolean(opencodeHook),
    hook_registered_structurally: opencodeRegistered,
    hook_registration_reason: opencodeRegistered ? "project configuration references governance bridge" : "bridge file is present but no explicit project registration was found",
  })
  const hermesHook = await pathKind(root, ".hermes/governance/gate_hook.py")
  const hermesEvaluator = await pathKind(root, ".hermes/governance/evaluate.mjs")
  const hermesBundle = await pathKind(root, ".hermes/bundles/project-bootstrap.json")
  if (hermesHook === "file" || hermesEvaluator === "file" || hermesBundle === "file") runtimes.push({
    name: "hermes", adapter: "hermes", configuration_paths: hermesBundle === "file" ? [".hermes/bundles/project-bootstrap.json"] : [],
    hook_path: hermesHook === "file" ? ".hermes/governance/gate_hook.py" : hermesEvaluator === "file" ? ".hermes/governance/evaluate.mjs" : null,
    hook_registered_structurally: hermesHook === "file",
  })
  return runtimes
}

async function hasOpenCodePluginRegistration(root, configPaths) {
  for (const relative of configPaths) {
    const absolute = path.join(root, relative)
    try {
      await assertSafePath(root, absolute, `OpenCode configuration ${relative}`)
      const text = await fs.readFile(absolute, "utf8")
      if (/governance-v2\.(?:mjs|ts)|canonical-governance\.mjs/.test(text)) return true
    } catch (error) {
      if (error?.code !== "ENOENT" && !/ENOENT/.test(String(error?.message || ""))) throw error
    }
  }
  return false
}

function lifecycleResult(input) {
  const substatus = input.substatus || "UNSPECIFIED"
  return {
    operation: input.operation,
    classification: input.classification,
    substatus,
    substatuses: [substatus],
    scope: { target: input.state?.target_root || null, mode: input.operation },
    checked_claims: input.checked_claims || [],
    unchecked_claims: input.unchecked_claims || [],
    blockers: input.blockers || [],
    tool_gaps: input.tool_gaps || [],
    owner_actions: input.owner_actions || [],
    evidence: input.evidence || [],
    state: input.state || null,
  }
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(String) : []
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function safeError(error) {
  return String(error?.message || error || "Unknown error").replace(/(?:token|secret|password)=[^\s]+/gi, "[REDACTED]").slice(0, 500)
}

function sourceCommit() {
  const pinned = process.env.OCAE_BOOTSTRAP_SOURCE_COMMIT
  if (/^[a-f0-9]{40}$/i.test(pinned || "")) return pinned
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8", stdio: "pipe", timeout: 5_000 }).trim()
    return /^[a-f0-9]{40}$/i.test(value) ? value : null
  } catch {
    return null
  }
}
