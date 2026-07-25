#!/usr/bin/env node

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  toAbsolutePath,
  assertSafePath,
  lstatIfExists,
  pathExists,
  ensureDirectory,
  copyFile,
} from "./lib/paths.mjs"
import { createBackup, restoreBackup } from "./lib/backup.mjs"
import { safeRedactText, secretValuesFromEnv } from "./lib/security/redaction.mjs"

// ---------------------------------------------------------------------------
// Directory skip list (mirrors discovery.mjs and validate-ecosystem.mjs)
// ---------------------------------------------------------------------------
const IGNORE_DIR_NAMES = new Set([".git", "node_modules"])

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const homeDir = os.homedir()
const globalConfigRoot = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(homeDir, ".config"),
  "opencode",
)

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2))

if (process.getuid && process.getuid() === 0) {
  console.error("Error: install-global.mjs must not be run as root or with sudo.")
  console.error("It operates on user-level configuration paths only.")
  process.exit(1)
}

if (args.help) {
  printHelp()
  process.exit(0)
}

if (args.rollback) {
  await rollbackFromBackup(args.rollback)
  process.exit(0)
}

if (args.dryRun) {
  await dryRun()
  // Drain stdout before exit: when stdout is piped (not a TTY),
  // Node.js buffers output; process.exit() would discard pending
  // data. write("") with a callback forces the buffer to flush.
  await new Promise((resolve) => process.stdout.write("", resolve))
  process.exit(0)
}

try {
  await install()
} catch (error) {
  console.error(safeRedactText(error instanceof Error ? error.message : String(error), { secrets: secretValuesFromEnv() }))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Main install logic
// ---------------------------------------------------------------------------
async function install() {
  // 1 — Validate boundaries -------------------------------------------------
  // Source: repoRoot must not be a symlink; individual source files validated
  //         below against repoRoot boundary with assertSafePath(repoRoot, …).
  const repoStat = await lstatIfExists(repoRoot)
  if (!repoStat) throw new Error(`Repository root does not exist: ${repoRoot}`)
  if (!repoStat.isDirectory()) throw new Error(`Repository root is not a directory: ${repoRoot}`)
  if (repoStat.isSymbolicLink()) throw new Error(`Repository root is a symlink and is not allowed: ${repoRoot}`)

  // Target: globalConfigRoot must be inside the home directory trust boundary.
  await assertSafePath(homeDir, globalConfigRoot, "OpenCode config root")

  // 2 — Pre-check target type ------------------------------------------------
  const targetStat = await lstatIfExists(globalConfigRoot)
  if (targetStat && !targetStat.isDirectory()) {
    throw new Error(`Target exists but is not a directory: ${globalConfigRoot}`)
  }

  // 3 — Backup existing config if present ------------------------------------
  const backupRoot = path.join(globalConfigRoot, ".backups", timestampSlug())
  if (await pathExists(globalConfigRoot)) {
    const existingFiles = await collectExistingFiles(globalConfigRoot)
    if (existingFiles.length > 0) {
      await assertSafePath(globalConfigRoot, backupRoot, "backup root")
      const backupResult = await createBackup({
        targetRoot: globalConfigRoot,
        files: existingFiles,
        backupRoot,
      })
      console.log(`Backed up existing OpenCode config to ${backupResult.backupDir}`)
    }
  }

  // 4 — Ensure target directory exists (safe after boundary check) -----------
  await fs.mkdir(globalConfigRoot, { recursive: true })

  // 5 — Copy tree directories first (these perform deeper path validation;
  //     if a symlink is detected mid-tree, the flat files below haven't
  //     been touched yet, reducing partial-install risk). ------------------------

  const dotOpenCodeSource = path.join(repoRoot, ".opencode")
  const dotOpenCodeTarget = path.join(globalConfigRoot, ".opencode")
  await copyTreeSafe(dotOpenCodeSource, dotOpenCodeTarget, repoRoot, globalConfigRoot)

  for (const folderName of ["agents", "skills"]) {
    const sourceDir = path.join(repoRoot, ".opencode", folderName)
    const targetDir = path.join(globalConfigRoot, folderName)
    await copyTreeSafe(sourceDir, targetDir, repoRoot, globalConfigRoot)
  }

  // 6 — Copy top-level instruction files --------------------------------------
  for (const fileName of ["AGENTS.md", "CONTRIBUTING.md", "SECURITY.md"]) {
    const sourcePath = path.join(repoRoot, fileName)
    const targetPath = path.join(globalConfigRoot, fileName)
    await assertSafePath(repoRoot, sourcePath, "source")
    await assertSafePath(globalConfigRoot, targetPath, "target")
    if (await lstatIfExists(sourcePath)) {
      await copyFile(sourcePath, targetPath)
    }
  }

  // 7 — Copy opencode.jsonc as opencode.json ---------------------------------
  const configSource = path.join(repoRoot, "opencode.jsonc")
  const configTarget = path.join(globalConfigRoot, "opencode.json")
  await assertSafePath(repoRoot, configSource, "config source")
  await assertSafePath(globalConfigRoot, configTarget, "config target")
  if (await lstatIfExists(configSource)) {
    await copyFile(configSource, configTarget)
  }

  console.log(`Installed OpenCode config into ${globalConfigRoot}`)
  console.log("Restart OpenCode so it reloads the updated configuration.")
}

// ---------------------------------------------------------------------------
// Dry-run: validate and print what would happen
// ---------------------------------------------------------------------------
async function dryRun() {
  // Validate source root is a real non-symlink directory
  const repoStat = await lstatIfExists(repoRoot)
  if (!repoStat) throw new Error(`Repository root does not exist: ${repoRoot}`)
  if (!repoStat.isDirectory()) throw new Error(`Repository root is not a directory: ${repoRoot}`)
  if (repoStat.isSymbolicLink()) throw new Error(`Repository root is a symlink and is not allowed: ${repoRoot}`)

  await assertSafePath(homeDir, globalConfigRoot, "OpenCode config root")

  console.log(`[DRY-RUN] Would install OpenCode config to: ${globalConfigRoot}`)
  console.log(`[DRY-RUN] Source repository root:     ${repoRoot}`)

  const targetStat = await lstatIfExists(globalConfigRoot)
  if (targetStat && !targetStat.isDirectory()) {
    console.error(`[DRY-RUN] Target exists but is not a directory: ${globalConfigRoot}`)
    process.exit(1)
  }

  if (await pathExists(globalConfigRoot)) {
    const existing = await collectExistingFiles(globalConfigRoot)
    const backupRoot = path.join(globalConfigRoot, ".backups", timestampSlug())
    await assertSafePath(globalConfigRoot, backupRoot, "backup root")
    console.log(`[DRY-RUN] Would back up ${existing.length} existing file(s) to ${backupRoot}`)
  }

  const planned = await collectSourceFiles()
  for (const entry of planned) {
    console.log(`[DRY-RUN] ${entry.source} -> ${entry.target}`)
  }
  console.log("[DRY-RUN] No files were modified.")
}

// ---------------------------------------------------------------------------
// Rollback: restore from backup manifest
// ---------------------------------------------------------------------------
async function rollbackFromBackup(backupDir) {
  const absBackup = toAbsolutePath(backupDir)
  await assertSafePath(absBackup, `${absBackup}/backup-manifest.json`, "backup manifest")
  const result = await restoreBackup({ backupRoot: absBackup, expectedTargetRoot: globalConfigRoot })
  console.log(`Rollback completed for ${result.targetRoot}`)
  console.log("GREEN_SAFE")
}

// ---------------------------------------------------------------------------
// Safe recursive tree copy (source → target)
// ---------------------------------------------------------------------------
async function copyTreeSafe(source, target, sourceRoot, targetRoot) {
  const sourceStat = await lstatIfExists(source)
  if (!sourceStat) return
  if (sourceStat.isSymbolicLink()) return

  await assertSafePath(sourceRoot, source, "copy source")
  await assertSafePath(targetRoot, target, "copy target")

  if (!sourceStat.isDirectory()) {
    await copyFile(source, target)
    return
  }

  // Check target if it exists — must not be a symlink, must be a directory
  const targetStat = await lstatIfExists(target)
  if (targetStat) {
    if (targetStat.isSymbolicLink()) {
      throw new Error(`Target is a symlink and is not allowed: ${target}`)
    }
    if (!targetStat.isDirectory()) {
      throw new Error(`Target exists but is not a directory: ${target}`)
    }
  }

  await ensureDirectory(target)

  const entries = await fs.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    if (IGNORE_DIR_NAMES.has(entry.name)) continue
    await copyTreeSafe(
      path.join(source, entry.name),
      path.join(target, entry.name),
      sourceRoot,
      targetRoot,
    )
  }
}

// ---------------------------------------------------------------------------
// Collect existing files in the target (for backup)
// ---------------------------------------------------------------------------
async function collectExistingFiles(root) {
  const files = []
  const candidatePaths = [
    path.join(root, "AGENTS.md"),
    path.join(root, "CONTRIBUTING.md"),
    path.join(root, "SECURITY.md"),
    path.join(root, "opencode.json"),
    path.join(root, ".opencode"),
    path.join(root, "agents"),
    path.join(root, "skills"),
  ]
  for (const candidate of candidatePaths) {
    const stat = await lstatIfExists(candidate)
    if (!stat) continue
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) {
      await collectFilesRecursive(candidate, files)
      continue
    }
    files.push(candidate)
  }
  return files
}

async function collectFilesRecursive(dir, accumulator) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (IGNORE_DIR_NAMES.has(entry.name)) continue
    if (entry.isDirectory()) {
      await collectFilesRecursive(full, accumulator)
      continue
    }
    accumulator.push(full)
  }
}

// ---------------------------------------------------------------------------
// Collect source files for dry-run display
// ---------------------------------------------------------------------------
async function collectSourceFiles(root = repoRoot) {
  const planned = []
  const filesToCopy = [
    ["AGENTS.md", "AGENTS.md"],
    ["CONTRIBUTING.md", "CONTRIBUTING.md"],
    ["SECURITY.md", "SECURITY.md"],
    ["opencode.jsonc", "opencode.json"],
  ]
  for (const [srcName, dstName] of filesToCopy) {
    const source = path.join(root, srcName)
    const target = path.join(globalConfigRoot, dstName)
    if (await lstatIfExists(source)) {
      planned.push({ source, target })
    }
  }
  await collectDirSources(path.join(root, ".opencode"), path.join(globalConfigRoot, ".opencode"), planned)
  for (const folder of ["agents", "skills"]) {
    await collectDirSources(
      path.join(root, ".opencode", folder),
      path.join(globalConfigRoot, folder),
      planned,
    )
  }
  return planned
}

async function collectDirSources(sourceDir, targetDir, planned) {
  const stat = await lstatIfExists(sourceDir)
  if (!stat) return
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    if (IGNORE_DIR_NAMES.has(entry.name)) continue
    const src = path.join(sourceDir, entry.name)
    const dst = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      await collectDirSources(src, dst, planned)
      continue
    }
    planned.push({ source: src, target: dst })
  }
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      result.help = true
    } else if (arg === "--dry-run") {
      result.dryRun = true
    } else if (arg === "--rollback") {
      result.rollback = argv[++i]
      if (!result.rollback) {
        throw new Error("--rollback requires a backup directory path")
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return result
}

function printHelp() {
  console.log(`Usage:
  node scripts/install-global.mjs              # Apply (default)
  node scripts/install-global.mjs --dry-run    # Show what would change
  node scripts/install-global.mjs --rollback <backup-dir>
  node scripts/install-global.mjs --help       # This message
`)
}

function timestampSlug(date = new Date()) {
  return `install-${date.toISOString().replace(/[:.]/g, "-")}`
}
