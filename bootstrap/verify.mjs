#!/usr/bin/env node

import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { validateBootstrapManifest, containsPrivateAbsolutePath } from "./lib/contract.mjs"
import {
  createUserActionHandoff,
  renderUserActionHandoff,
} from "../scripts/lib/user-action-handoff.mjs"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export async function verifyInstallation({ targetRoot, sourceRoot: source = sourceRoot, expectedCommit = null } = {}) {
  const issues = []
  const warnings = []
  const target = path.resolve(targetRoot || "")
  const sourceDir = path.resolve(source)

  if (!targetRoot || !fsSync.existsSync(target)) return completionResult({ classification: "RED_BLOCK", issues: ["target project does not exist"], warnings, target_root: target })
  if (await isSymlink(target)) return completionResult({ classification: "RED_BLOCK", issues: ["target project is a symlink"], warnings, target_root: target })

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

  if (installation) {
    if (installation.bootstrap_protocol !== "url-only-v1") issues.push("installation manifest has wrong bootstrap protocol")
    if (!/^[0-9a-f]{40}$/i.test(installation.source_commit || "")) issues.push("installation manifest has no full source commit")
    if (sourceCommit && installation.source_commit !== sourceCommit) issues.push("installation source commit differs from current source checkout")
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
  return completionResult({
    classification,
    target_root: target,
    source_root: sourceDir,
    source_commit: sourceCommit,
    expected_commit: expectedCommit,
    issues,
    warnings,
    checked_at: new Date().toISOString(),
  })
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
    const result = completionResult({ classification: validateBootstrapManifest(manifest).length === 0 ? "VERIFIED_IN_SCOPE" : "RED_BLOCK", issues: validateBootstrapManifest(manifest), warnings: [] })
    console.log(args.json ? JSON.stringify(result, null, 2) : renderHumanResult(result))
    process.exitCode = result.classification === "VERIFIED_IN_SCOPE" ? 0 : 2
    return
  }
  if (!args.target) throw new Error("--target is required")
  const result = await verifyInstallation({ targetRoot: args.target, sourceRoot: args.source || sourceRoot, expectedCommit: args.expectedCommit || null })
  console.log(args.json ? JSON.stringify(result, null, 2) : renderHumanResult(result))
  process.exitCode = result.classification === "VERIFIED_IN_SCOPE" ? 0 : result.classification === "NEEDS_REVIEW" ? 1 : 2
}

function completionResult(result) {
  return { ...result, user_action_handoff: createUserActionHandoff([]) }
}

function renderHumanResult(result) {
  const details = [...(result.issues || []), ...(result.warnings || [])].join("\n")
  return `${result.classification}${details ? `\n${details}` : ""}\n\n${renderUserActionHandoff(result.user_action_handoff)}`
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isDirect) main().catch((error) => { console.error(error.message); process.exitCode = 2 })
