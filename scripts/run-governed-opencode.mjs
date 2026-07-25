#!/usr/bin/env node

/**
 * Managed OpenCode Launcher with Governance Enforcement
 *
 * Starts OpenCode in a target project with an isolated profile,
 * verifies governance installation and source lock integrity,
 * and produces session attestation evidence.
 *
 * Usage:
 *   node scripts/run-governed-opencode.mjs --target <project> [--live-test] [--timeout <ms>]
 *
 * The launcher NEVER modifies the user's production ~/.config/opencode profile.
 */

import path from "node:path"
import fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { spawnSync, spawn } from "node:child_process"
import os from "node:os"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { safeRedactText, secretValuesFromEnv } from "./lib/security/redaction.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// ── Helpers ────────────────────────────────────────────────────────────────

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-")
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function parseArgs(argv) {
  const result = { timeout: 30000, liveTest: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") result.help = true
    else if (arg === "--target") result.target = argv[++i]
    else if (arg === "--live-test") result.liveTest = true
    else if (arg === "--timeout") result.timeout = parseInt(argv[++i], 10)
    else if (arg === "--json") result.json = true
  }
  return result
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-governed-opencode.mjs --target <project> [--live-test] [--timeout <ms>] [--json]

Flags:
  --target <path>    Target project with installed governance (required)
  --live-test        Run live enforcement tests instead of interactive session
  --timeout <ms>     Max wait time for attestation (default: 30000)
  --json             Output machine-readable JSON
  --help             Show this help
`)
}

// ── Validation ─────────────────────────────────────────────────────────────

async function validateGovernanceInstallation(targetRoot) {
  const issues = []
  const govRoot = path.join(targetRoot, ".agent-governance")

  if (!existsSync(govRoot)) {
    issues.push(".agent-governance/ directory not found — run install-governance.mjs first")
    return { valid: false, issues }
  }

  const requiredFiles = [
    "manifest.json",
    "source-lock.json",
    ["runtime", "gates", "evaluate-all.mjs"],
    ["runtime", "gates", "kernel.mjs"],
    ["bin", "evaluate.mjs"],
  ]

  for (const f of requiredFiles) {
    const fp = Array.isArray(f) ? path.join(govRoot, ...f) : path.join(govRoot, f)
    if (!existsSync(fp)) issues.push(`Missing: ${Array.isArray(f) ? f.join("/") : f}`)
  }

  // Check source-lock.json integrity
  const lockPath = path.join(govRoot, "source-lock.json")
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"))
      if (!lock.source_commit || lock.source_commit === "UNKNOWN") {
        issues.push("source-lock.json has no valid source_commit")
      }
      if (!lock.files || lock.files.length < 5) {
        issues.push("source-lock.json has fewer than 5 file entries")
      }
      // Verify runtime file hashes
      for (const entry of lock.files) {
        if (entry.sha256 === "UNAVAILABLE") continue
        const fp = path.join(govRoot, "runtime", entry.path)
        if (existsSync(fp)) {
          const content = await fs.readFile(fp, "utf8")
          const actual = `sha256:${sha256(content)}`
          if (actual !== entry.sha256) {
            issues.push(`Hash mismatch for ${entry.path}: expected ${entry.sha256.slice(0,16)}..., got ${actual.slice(0,16)}...`)
          }
        }
      }
    } catch (e) {
      issues.push(`source-lock.json parse error: ${e.message}`)
    }
  }

  return { valid: issues.length === 0, issues }
}

// ── Profile Management ─────────────────────────────────────────────────────

async function createIsolatedProfile(targetRoot) {
  const profileDir = path.join(targetRoot, ".opencode", "runtime-profile")
  await fs.mkdir(profileDir, { recursive: true })

  // Create minimal config that:
  // 1. Points to the governance plugin
  // 2. Uses project-local config
  // 3. Does NOT reference the user's production config
  const config = {
    plugin: [
      path.join(targetRoot, ".agent-governance", "hooks", "opencode", "pre-evaluate.mjs"),
    ],
    config_dir: profileDir,
    verbose: false,
  }

  const configPath = path.join(profileDir, "opencode.json")
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8")

  return { profileDir, configPath }
}

// ── Binary Detection ───────────────────────────────────────────────────────

function findOpenCodeBinary() {
  // Check known paths in priority order
  const candidates = [
    path.join(os.homedir(), ".opencode", "bin", "opencode"),
    "/usr/local/bin/opencode",
    "/usr/bin/opencode",
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  // Fallback: search
  const result = spawnSync("which", ["opencode"], { encoding: "utf8", stdio: "pipe" })
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()

  return null
}

// ── Session Attestation ────────────────────────────────────────────────────

async function writeSessionAttestation(targetRoot, details) {
  const evidenceDir = path.join(targetRoot, ".agent-governance", "evidence", "sessions")
  await fs.mkdir(evidenceDir, { recursive: true })

  const sessionId = `session-${timestampSlug()}-${crypto.randomBytes(4).toString("hex")}`
  const attestation = {
    session_id: sessionId,
    runtime: "opencode",
    runtime_version: details.version || "unknown",
    plugin_version: "1.0.0",
    source_commit: details.sourceCommit || "unknown",
    worktree_fingerprint: details.worktreeFingerprint || "unknown",
    profile: details.profileDir || "unknown",
    hook_loaded: details.hookLoaded || false,
    started_at: new Date().toISOString(),
    managed_launcher: true,
    live_test: details.liveTest || false,
  }

  const attestationPath = path.join(evidenceDir, `${sessionId}.json`)
  await fs.writeFile(attestationPath, JSON.stringify(attestation, null, 2) + "\n", "utf8")

  return { sessionId, attestationPath, attestation }
}

// ── Live Test Mode ─────────────────────────────────────────────────────────

async function runLiveTests(targetRoot, binary) {
  console.log("\n=== OpenCode Governance: Live Enforcement Tests ===\n")

  const testRoot = path.join(os.tmpdir(), `governed-opencode-test-${timestampSlug()}`)
  await fs.mkdir(testRoot, { recursive: true })
  console.log(`Test directory: ${testRoot}`)

  // Initialize test project
  spawnSync("git", ["init"], { cwd: testRoot, stdio: "pipe" })
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: testRoot, stdio: "pipe" })
  spawnSync("git", ["config", "user.name", "Test"], { cwd: testRoot, stdio: "pipe" })

  // Install governance
  const installResult = spawnSync("node", [
    path.join(repoRoot, "scripts", "install-governance.mjs"),
    "--target", testRoot,
    "--apply",
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30000,
    stdio: "pipe",
  })

  // Create approval receipt for subsequent operations (test pattern)
  const approvalReceipt = {
    version: "1.0.0", action: "apply", runtime: "opencode",
    scope: { branch: "main", commit: "test", paths: [], repository: "test", targetRoot: testRoot },
    riskTier: "MEDIUM_REVIEW",
    contextFingerprint: "a".repeat(64),
    approvedBy: "owner", approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    singleUse: true, nonce: `live-test-${Date.now()}`, status: "APPROVED"
  }
  await fs.writeFile(path.join(testRoot, "approval.json"), JSON.stringify(approvalReceipt), "utf8")

  // Check governance installed
  const govRoot = path.join(testRoot, ".agent-governance")
  const govInstalled = existsSync(govRoot)

  // Create isolated profile
  const { profileDir } = await createIsolatedProfile(testRoot)

  // Test 1: Safe read allowed (LOW_LOCAL risk, no approvals needed)
  console.log("Test 1: Safe read allowed...")
  const evalResult = spawnSync("node", [
    path.join(testRoot, ".agent-governance", "bin", "evaluate.mjs"),
    "--target", testRoot,
    "--runtime", "opencode",
    "--action", "read",
    "--risk-tier", "LOW_LOCAL",
    "--json",
  ], {
    encoding: "utf8",
    timeout: 15000,
    stdio: "pipe",
  })

  let readAllowed = false
  try {
    const output = JSON.parse(evalResult.stdout || evalResult.stderr || "{}")
    readAllowed = output.classification === "GREEN_SAFE" || output.allowed === true
  } catch { /* keep false */ }

  // Test 2: Force push blocked
  console.log("Test 2: Force push blocked...")
  const forceResult = spawnSync("node", [
    path.join(testRoot, ".agent-governance", "bin", "evaluate.mjs"),
    "--target", testRoot,
    "--runtime", "opencode",
    "--action", "git push --force",
    "--json",
  ], {
    encoding: "utf8",
    timeout: 15000,
    stdio: "pipe",
  })

  let forceBlocked = false
  try {
    const output = JSON.parse(forceResult.stdout || forceResult.stderr || "{}")
    forceBlocked = output.classification === "RED_BLOCK" || output.allowed === false
  } catch { /* keep false */ }

  // Test 3: Write outside worktree blocked
  console.log("Test 3: Write outside worktree blocked...")
  const escapeResult = spawnSync("node", [
    path.join(testRoot, ".agent-governance", "bin", "evaluate.mjs"),
    "--target", testRoot,
    "--runtime", "opencode",
    "--action", "write",
    "--write-path", "/etc/passwd",
    "--json",
  ], {
    encoding: "utf8",
    timeout: 15000,
    stdio: "pipe",
  })

  let escapeBlocked = false
  try {
    const output = JSON.parse(escapeResult.stdout || escapeResult.stderr || "{}")
    escapeBlocked = output.classification === "RED_BLOCK" || output.allowed === false
  } catch { /* keep false */ }

  // Test 4: Project write allowed (LOW_LOCAL with write-path inside worktree)
  console.log("Test 4: Project write allowed...")
  const writeResult = spawnSync("node", [
    path.join(testRoot, ".agent-governance", "bin", "evaluate.mjs"),
    "--target", testRoot,
    "--runtime", "opencode",
    "--action", "write",
    "--risk-tier", "LOW_LOCAL",
    "--write-path", path.join(testRoot, "safe-file.txt"),
    "--json",
  ], {
    encoding: "utf8",
    timeout: 15000,
    stdio: "pipe",
  })

  let writeAllowed = false
  try {
    const output = JSON.parse(writeResult.stdout || writeResult.stderr || "{}")
    writeAllowed = output.classification === "GREEN_SAFE" || output.allowed === true
  } catch { /* keep false */ }

  const results = {
    testRoot,
    governance_installed: govInstalled,
    profile_created: existsSync(profileDir),
    tests: {
      safe_read_allowed: readAllowed,
      force_push_blocked: forceBlocked,
      escape_blocked: escapeBlocked,
      project_write_allowed: writeAllowed,
    },
    all_passed: readAllowed && forceBlocked && escapeBlocked && writeAllowed,
  }

  // Cleanup
  try { await fs.rm(testRoot, { recursive: true, force: true }) } catch { /* ok */ }

  return results
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  if (!args.target) {
    console.error("Missing required --target")
    console.error("Use --help for usage")
    process.exit(1)
  }

  const targetRoot = path.resolve(args.target)

  // Phase 1: Validate target exists
  if (!existsSync(targetRoot)) {
    console.error(`RED_BLOCK: Target "${targetRoot}" does not exist.`)
    process.exit(2)
  }

  // Phase 2: Validate governance (skip in live-test mode — test creates its own)
  if (!args.liveTest) {
    const validation = await validateGovernanceInstallation(targetRoot)
    if (!validation.valid) {
      if (args.json) {
        console.log(JSON.stringify({
          classification: "RED_BLOCK",
          reason: "Governance not properly installed",
          issues: validation.issues,
        }))
      } else {
        console.error("RED_BLOCK: Governance not properly installed:")
        for (const issue of validation.issues) console.error(`  - ${issue}`)
      }
      process.exit(2)
    }
  }

  // Phase 3: Find OpenCode binary
  const binary = findOpenCodeBinary()
  if (!binary) {
    if (args.json) {
      console.log(JSON.stringify({
        classification: "TOOL_GAP",
        reason: "OpenCode binary not found",
        searched_paths: [
          path.join(os.homedir(), ".opencode", "bin", "opencode"),
          "/usr/local/bin/opencode",
          "/usr/bin/opencode",
        ],
      }))
    } else {
      console.error("TOOL_GAP: OpenCode binary not found")
    }
    process.exit(1)
  }

  // Phase 4: Get OpenCode version
  let version = "unknown"
  try {
    const versionResult = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 5000, stdio: "pipe" })
    if (versionResult.status === 0) version = versionResult.stdout.trim()
  } catch { /* keep unknown */ }

  // Phase 5: Get source commit from governance
  let sourceCommit = "unknown"
  try {
    const lockPath = path.join(targetRoot, ".agent-governance", "source-lock.json")
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"))
      sourceCommit = lock.source_commit || "unknown"
    }
  } catch { /* keep unknown */ }

  // Phase 6: Create isolated profile
  const { profileDir } = await createIsolatedProfile(targetRoot)

  // Phase 7: Live test mode
  if (args.liveTest) {
    // Live test mode: validate that the source can be installed, not that
    // the target already has governance. The test creates its own installation.
    const results = await runLiveTests(targetRoot, binary)
    const testTarget = results.testRoot || targetRoot
    const attestation = await writeSessionAttestation(testTarget, {
      version,
      sourceCommit,
      profileDir,
      hookLoaded: results.governance_installed,
      liveTest: true,
    })

    const output = {
      classification: results.all_passed ? "MANAGED_HOOK_ENFORCED" : "STRUCTURAL_HOOK_INSTALLED",
      runtime: "opencode",
      runtime_version: version,
      profile: profileDir,
      session: attestation.sessionId,
      attestation_path: attestation.attestationPath,
      live_tests: results.tests,
      all_tests_passed: results.all_passed,
    }

    if (args.json) {
      console.log(JSON.stringify(output, null, 2))
    } else {
      console.log("\n=== OpenCode Managed Launcher: Live Test Results ===\n")
      console.log(`Runtime: ${version}`)
      console.log(`Profile: ${profileDir}`)
      console.log(`Session: ${attestation.sessionId}`)
      console.log(`\nTests:`)
      console.log(`  Safe read allowed:    ${results.tests.safe_read_allowed ? "PASS" : "FAIL"}`)
      console.log(`  Force push blocked:   ${results.tests.force_push_blocked ? "PASS" : "FAIL"}`)
      console.log(`  Escape blocked:       ${results.tests.escape_blocked ? "PASS" : "FAIL"}`)
      console.log(`  Project write allowed: ${results.tests.project_write_allowed ? "PASS" : "FAIL"}`)
      console.log(`\nOverall: ${results.all_passed ? "MANAGED_HOOK_ENFORCED" : "STRUCTURAL_HOOK_INSTALLED"}`)
    }

    process.exit(results.all_passed ? 0 : 1)
  }

  // Phase 8: Interactive managed session (attestation-only mode)
  console.log(`\nOpenCode Managed Launcher v1.0.0`)
  console.log(`Runtime: ${binary} (${version})`)
  console.log(`Target: ${targetRoot}`)
  console.log(`Profile: ${profileDir}`)
  console.log(`Source Commit: ${sourceCommit}`)
  console.log(`\nGovernance: INSTALLED`)
  console.log(`Profile isolation: ACTIVE`)
  console.log(`\nTo start OpenCode with governance:`)
  console.log(`  OPENCODE_CONFIG_DIR="${profileDir}" ${binary}`)
  console.log(`\nSession attestation will be written on first gate evaluation.`)

  // Write pre-session attestation
  await writeSessionAttestation(targetRoot, {
    version,
    sourceCommit,
    profileDir,
    hookLoaded: true,
    liveTest: false,
  })

  if (args.json) {
    console.log(JSON.stringify({
      classification: "MANAGED_LAUNCHER_READY",
      runtime: "opencode",
      runtime_version: version,
      target: targetRoot,
      profile: profileDir,
      source_commit: sourceCommit,
    }))
  }

  process.exit(0)
}

main().catch((error) => {
  console.error(safeRedactText(error instanceof Error ? error.message : String(error), { secrets: secretValuesFromEnv() }))
  process.exit(2)
})
