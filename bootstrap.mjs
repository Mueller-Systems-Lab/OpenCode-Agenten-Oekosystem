#!/usr/bin/env node

import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { normalizeBootstrapUrl, validateBootstrapManifest } from "./bootstrap/lib/contract.mjs"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const manifestPath = path.join(sourceRoot, "bootstrap", "manifest.json")
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
const manifestIssues = validateBootstrapManifest(manifest)
if (manifestIssues.length > 0) fail(`Manifest validation failed: ${manifestIssues.join("; ")}`)

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log("Usage: node bootstrap.mjs --target <project> [--apply|--verify|--rollback <backup-dir>] [--source-url <github-url>]")
  process.exit(0)
}
if (!args.target) fail("--target is required")
if (args.sourceUrl) {
  const normalized = normalizeBootstrapUrl(args.sourceUrl)
  const actual = normalizeRemote(readRemote(sourceRoot))
  if (normalized.repository !== actual) fail(`Source URL does not match this checkout: expected ${normalized.repository}, got ${actual || "UNKNOWN"}`)
  if (normalized.ref && normalized.ref_type === "branch" && currentRef(sourceRoot) !== normalized.ref) fail(`Source branch mismatch: expected ${normalized.ref}, got ${currentRef(sourceRoot) || "DETACHED"}`)
  if (normalized.ref && normalized.ref_type === "commit" && currentCommit(sourceRoot) !== normalized.ref) fail(`Source commit mismatch: expected ${normalized.ref}, got ${currentCommit(sourceRoot)}`)
}

const target = path.resolve(args.target)
const commit = currentCommit(sourceRoot)
let command
if (args.verify) command = [manifest.verifier, "--target", target, "--source", sourceRoot, "--source-commit", commit, "--json"]
else if (args.rollback) command = [manifest.installer, "--target", target, "--rollback", path.resolve(args.rollback), "--json"]
else command = [manifest.installer, "--target", target, ...(args.apply ? ["--apply"] : []), "--json"]

const result = spawnSync(process.execPath, [path.join(sourceRoot, command[0]), ...command.slice(1)], {
  cwd: sourceRoot,
  encoding: "utf8",
  stdio: "inherit",
})
process.exitCode = result.status ?? 1

function parseArgs(argv) {
  const out = { target: null, apply: false, verify: false, rollback: null, sourceUrl: null, sourceRef: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--target") out.target = argv[++index]
    else if (arg === "--apply") out.apply = true
    else if (arg === "--dry-run") out.dryRun = true
    else if (arg === "--verify") out.verify = true
    else if (arg === "--rollback") out.rollback = argv[++index]
    else if (arg === "--source-url") out.sourceUrl = argv[++index]
    else if (arg === "--help" || arg === "-h") out.help = true
    else fail(`Unknown argument: ${arg}`)
  }
  if ([out.apply, out.verify, Boolean(out.rollback)].filter(Boolean).length > 1) fail("Choose only one of --apply, --verify, or --rollback")
  return out
}

function readRemote(root) {
  try {
    const config = fsSync.readFileSync(path.join(readCommonGitDir(root), "config"), "utf8")
    const match = /\[remote\s+"origin"\][\s\S]*?^\s*url\s*=\s*(.+)$/m.exec(config)
    return match?.[1]?.trim() || ""
  } catch { return "" }
}

function normalizeRemote(remote) {
  if (!remote) return ""
  return remote.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "").replace(/\/$/, "")
}

function currentCommit(root) {
  const gitDir = readGitDir(root)
  const head = fsSync.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim()
  if (/^[0-9a-f]{40}$/i.test(head)) return head
  const reference = /^ref:\s+(.+)$/.exec(head)?.[1]
  if (!reference || !/^[A-Za-z0-9._/-]+$/.test(reference)) fail("Current checkout is not pinned to a full commit")
  const refPath = path.join(gitDir, reference)
  if (fsSync.existsSync(refPath)) {
    const value = fsSync.readFileSync(refPath, "utf8").trim()
    if (/^[0-9a-f]{40}$/i.test(value)) return value
  }
  const packed = fsSync.existsSync(path.join(gitDir, "packed-refs")) ? fsSync.readFileSync(path.join(gitDir, "packed-refs"), "utf8") : ""
  const packedMatch = packed.split(/\r?\n/).find((line) => line.endsWith(` ${reference}`))
  if (packedMatch && /^[0-9a-f]{40}/i.test(packedMatch)) return packedMatch.slice(0, 40)
  fail(`Cannot resolve source ref: ${reference}`)
}

function currentRef(root) {
  const head = fsSync.readFileSync(path.join(readGitDir(root), "HEAD"), "utf8").trim()
  return /^ref:\s+refs\/heads\/(.+)$/.exec(head)?.[1] || null
}

function readGitDir(root) {
  const marker = path.join(root, ".git")
  const stat = fsSync.lstatSync(marker)
  if (stat.isDirectory()) return marker
  const text = fsSync.readFileSync(marker, "utf8").trim()
  if (!text.startsWith("gitdir:")) fail("Source checkout has an invalid .git marker")
  return path.resolve(root, text.slice("gitdir:".length).trim())
}

function readCommonGitDir(root) {
  const gitDir = readGitDir(root)
  const commonDirPath = path.join(gitDir, "commondir")
  return fsSync.existsSync(commonDirPath) ? path.resolve(gitDir, fsSync.readFileSync(commonDirPath, "utf8").trim()) : gitDir
}

function fail(message) {
  console.error(`BOOTSTRAP_RED_BLOCK: ${message}`)
  process.exit(2)
}
