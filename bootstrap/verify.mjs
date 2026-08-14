#!/usr/bin/env node

import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { validateBootstrapManifest, containsPrivateAbsolutePath } from "./lib/contract.mjs"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export async function verifyInstallation({ targetRoot, sourceRoot: source = sourceRoot, expectedCommit = null } = {}) {
  const issues = []
  const warnings = []
  const target = path.resolve(targetRoot || "")
  const sourceDir = path.resolve(source)

  if (!targetRoot || !fsSync.existsSync(target)) return { classification: "RED_BLOCK", issues: ["target project does not exist"], warnings, target_root: target }
  if (await isSymlink(target)) return { classification: "RED_BLOCK", issues: ["target project is a symlink"], warnings, target_root: target }

  const manifestPath = path.join(sourceDir, "bootstrap", "manifest.json")
  let manifest
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
    issues.push(...validateBootstrapManifest(manifest))
  } catch (error) {
    issues.push(`source manifest cannot be read: ${error.message}`)
  }

  const pinnedCommit = process.env.OCAE_BOOTSTRAP_SOURCE_COMMIT
  const sourceCommit = /^[0-9a-f]{40}$/i.test(pinnedCommit || "") ? pinnedCommit : readGitHead(sourceDir)
  if (!sourceCommit) issues.push("source commit cannot be determined")
  if (expectedCommit && sourceCommit !== expectedCommit) issues.push(`source commit mismatch: expected ${expectedCommit}, got ${sourceCommit || "UNKNOWN"}`)

  const installationPath = path.join(target, ".opencode", "ecosystem-installation.json")
  let installation
  try {
    installation = JSON.parse(await fs.readFile(installationPath, "utf8"))
  } catch (error) {
    issues.push(`installation manifest cannot be read: ${error.message}`)
  }

  const required = [
    ".agent-governance/manifest.json",
    ".agent-governance/source-lock.json",
    ".agent-governance/bin/evaluate.mjs",
    ".agent-governance/runtime/governance/policy-core.yaml",
    ".agent-governance/runtime/governance/generated/policy-core.json",
    ".agent-governance/runtime/governance/generated/risk-profiles.json",
    ".agent-governance/runtime/governance/generated/capability-registry.json",
    ".agent-governance/runtime/governance/owner-intent.schema.json",
    ".agent-governance/runtime/governance/task-capsule.schema.json",
    ".agent-governance/runtime/governance/task-bootstrap-policy.schema.json",
    ".agent-governance/runtime/bootstrap/task-bootstrap.mjs",
    ".agent-governance/policies/task-bootstrap-policy.json",
    ".agent-governance/state/task-bootstrap-state.json",
    ".agent-governance/runtime/PROMPT-KERNEL.md",
  ]
  if (manifest) {
    for (const rel of manifest.managed_paths || []) {
      if (rel.endsWith("/**")) continue
      required.push(rel)
    }
  }
  for (const rel of required) {
    if (!fsSync.existsSync(path.join(target, rel))) issues.push(`missing installed file: ${rel}`)
  }

  let taskBootstrapPolicy = null
  let taskBootstrapPolicyStatus = "INVALID"
  try {
    taskBootstrapPolicy = JSON.parse(await fs.readFile(path.join(target, ".agent-governance/policies/task-bootstrap-policy.json"), "utf8"))
    if (taskBootstrapPolicy.schema_version !== "governance-v2.task-bootstrap-policy.1") issues.push("task bootstrap policy has an unsupported schema version")
    if (!taskBootstrapPolicy.bootstrap_ceiling?.allowed_effects?.includes("LOCAL_WRITE")) issues.push("task bootstrap policy does not allow bounded local writes")
    if (taskBootstrapPolicy.bootstrap_ceiling?.allowed_effects?.includes("PUSH")) issues.push("task bootstrap policy expands the automatic PUSH ceiling")
    if (taskBootstrapPolicy.schema_version === "governance-v2.task-bootstrap-policy.1" && taskBootstrapPolicy.bootstrap_ceiling?.allowed_effects?.includes("LOCAL_WRITE") && !taskBootstrapPolicy.bootstrap_ceiling?.allowed_effects?.includes("PUSH")) taskBootstrapPolicyStatus = "VALID"
  } catch {
    issues.push("task bootstrap policy cannot be read")
  }
  let bootstrapState = null
  try {
    bootstrapState = JSON.parse(await fs.readFile(path.join(target, ".agent-governance/state/task-bootstrap-state.json"), "utf8"))
    if (!['COLD_READ_ONLY', 'TASK_BOOTSTRAPPING', 'TASK_READY', 'TASK_BLOCKED', 'TASK_COMPLETED'].includes(bootstrapState.state)) issues.push("task bootstrap state is invalid")
  } catch {
    issues.push("task bootstrap state cannot be read")
  }
  const opencodeConfig = path.join(target, fsSync.existsSync(path.join(target, "opencode.jsonc")) ? "opencode.jsonc" : "opencode.json")
  let hookActivationOrder = "VALID"
  try {
    const configText = await fs.readFile(opencodeConfig, "utf8")
    if (!configText.includes(".opencode/plugins/governance-v2.mjs")) {
      hookActivationOrder = "INVALID"
      issues.push("governance hook is not activated through the installed project plugin")
    }
  } catch {
    hookActivationOrder = "INVALID"
    issues.push("OpenCode config cannot be read for hook activation verification")
  }
  const bootstrapRuntimePath = path.join(target, ".agent-governance/runtime/bootstrap/task-bootstrap.mjs")
  const bootstrapSchemasPresent = [
    ".agent-governance/runtime/governance/owner-intent.schema.json",
    ".agent-governance/runtime/governance/task-capsule.schema.json",
    ".agent-governance/runtime/governance/task-bootstrap-policy.schema.json",
  ].every((rel) => fsSync.existsSync(path.join(target, rel)))
  const taskBootstrapRuntimeStatus = fsSync.existsSync(bootstrapRuntimePath) ? "PRESENT" : "MISSING"

  if (installation) {
    if (installation.bootstrap_protocol !== "url-only-v1") issues.push("installation manifest has wrong bootstrap protocol")
    if (!/^[0-9a-f]{40}$/i.test(installation.source_commit || "")) issues.push("installation manifest has no full source commit")
    if (sourceCommit && installation.source_commit !== sourceCommit) issues.push("installation source commit differs from current source checkout")
    if (installation.governance_bootstrap_ready !== true) issues.push("installation manifest does not confirm governance bootstrap readiness")
    if (installation.manual_bootstrap_required === true) issues.push("installation manifest requires manual bootstrap")
    if (!Array.isArray(installation.managed_files)) issues.push("installation manifest managed_files must be an array")
    if (!Array.isArray(installation.preserved_files)) issues.push("installation manifest preserved_files must be an array")
    const serialized = JSON.stringify(installation)
    if (containsPrivateAbsolutePath(serialized)) issues.push("installation manifest contains a private absolute path")
    if (/file:\/\//i.test(serialized)) issues.push("installation manifest contains a file URL")
    if (secretLike(serialized)) issues.push("installation manifest contains secret-like content")
  }

  for (const rel of ["governance/policy-core.yaml", "governance/generated/policy-core.json", "governance/generated/capability-registry.json", "PROMPT-KERNEL.md"]) {
    if (!fsSync.existsSync(path.join(sourceDir, rel))) issues.push(`source governance artifact missing: ${rel}`)
  }

  for (const command of [["scripts/generate-governance.mjs", "--check"], ["scripts/check-governance-drift.mjs"]]) {
    const result = spawnSync(process.execPath, [path.join(sourceDir, command[0]), ...command.slice(1)], { cwd: sourceDir, encoding: "utf8" })
    if (result.status !== 0) warnings.push(`source verification command failed: ${command.join(" ")}`)
  }

  const classification = issues.length > 0 ? "RED_BLOCK" : warnings.length > 0 ? "NEEDS_REVIEW" : "VERIFIED_IN_SCOPE"
  return {
    classification,
    target_root: target,
    source_root: sourceDir,
    source_commit: sourceCommit,
    expected_commit: expectedCommit,
    issues,
    warnings,
    task_bootstrap_runtime: taskBootstrapRuntimeStatus,
    task_bootstrap_policy: taskBootstrapPolicyStatus,
    task_context_writer: taskBootstrapRuntimeStatus === "PRESENT" && taskBootstrapPolicyStatus === "VALID" && bootstrapSchemasPresent ? "VALID" : "INVALID",
    hook_activation_order: hookActivationOrder,
    bootstrap_state: bootstrapState?.state || null,
    governance_bootstrap_ready: classification === "VERIFIED_IN_SCOPE",
    manual_bootstrap_required: false,
    checked_at: new Date().toISOString(),
  }
}

function readGitHead(cwd) {
  try {
    let gitPath = path.join(cwd, ".git")
    if (fsSync.lstatSync(gitPath).isFile()) {
      const gitMarker = fsSync.readFileSync(gitPath, "utf8").trim()
      if (!gitMarker.startsWith("gitdir:")) return null
      gitPath = path.resolve(cwd, gitMarker.slice("gitdir:".length).trim())
    }
    const head = fsSync.readFileSync(path.join(gitPath, "HEAD"), "utf8").trim()
    if (fsSync.existsSync(path.join(gitPath, "commondir"))) {
      gitPath = path.resolve(gitPath, fsSync.readFileSync(path.join(gitPath, "commondir"), "utf8").trim())
    }
    if (/^[0-9a-f]{40}$/i.test(head)) return head
    const match = /^ref:\s+(.+)$/.exec(head)
    if (!match || !/^[A-Za-z0-9._/-]+$/.test(match[1])) return null
    const refPath = path.join(gitPath, match[1])
    if (fsSync.existsSync(refPath)) {
      const refValue = fsSync.readFileSync(refPath, "utf8").trim()
      return /^[0-9a-f]{40}$/i.test(refValue) ? refValue : null
    }
    const packedRefs = fsSync.readFileSync(path.join(gitPath, "packed-refs"), "utf8")
    for (const line of packedRefs.split(/\r?\n/)) {
      const packed = /^(?:[0-9a-f]{40})\s+(.+)$/.exec(line)
      if (packed?.[1] === match[1]) return line.slice(0, 40)
    }
    return null
  } catch {
    return null
  }
}

async function isSymlink(filePath) {
  try { return (await fs.lstat(filePath)).isSymbolicLink() } catch { return false }
}

function secretLike(text) {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})\b|(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"'}]{8,}/i.test(text)
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--target") result.target = argv[++index]
    else if (arg === "--source") result.source = argv[++index]
    else if (arg === "--source-commit") result.expectedCommit = argv[++index]
    else if (arg === "--source-only") result.sourceOnly = true
    else if (arg === "--json") result.json = true
    else if (arg === "--help" || arg === "-h") result.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log("Usage: node bootstrap/verify.mjs --target <project> [--source-commit <sha>] [--json]")
    return
  }
  if (args.sourceOnly) {
    const manifest = JSON.parse(await fs.readFile(path.join(args.source || sourceRoot, "bootstrap", "manifest.json"), "utf8"))
    const result = { classification: validateBootstrapManifest(manifest).length === 0 ? "VERIFIED_IN_SCOPE" : "RED_BLOCK", issues: validateBootstrapManifest(manifest) }
    console.log(args.json ? JSON.stringify(result, null, 2) : `${result.classification}\n${result.issues.join("\n")}`)
    process.exitCode = result.classification === "VERIFIED_IN_SCOPE" ? 0 : 2
    return
  }
  if (!args.target) throw new Error("--target is required")
  const result = await verifyInstallation({ targetRoot: args.target, sourceRoot: args.source || sourceRoot, expectedCommit: args.expectedCommit || null })
  console.log(args.json ? JSON.stringify(result, null, 2) : `${result.classification}\n${[...result.issues, ...result.warnings].join("\n")}`)
  process.exitCode = result.classification === "VERIFIED_IN_SCOPE" ? 0 : result.classification === "NEEDS_REVIEW" ? 1 : 2
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isDirect) main().catch((error) => { console.error(error.message); process.exitCode = 2 })
