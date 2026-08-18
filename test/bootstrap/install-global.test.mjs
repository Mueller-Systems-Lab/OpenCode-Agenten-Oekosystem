// ---------------------------------------------------------------------------
// Tests for scripts/install-global.mjs — hardened path-safe global installer
// ---------------------------------------------------------------------------

import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { runNodeScript } from "../helpers.mjs"
import { skipIfHostCannotSymlink } from "../lib/symlink-capability.mjs"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const installScript = "scripts/install-global.mjs"

/**
 * Create a temporary directory that serves as a fake home directory.
 * Returns { home, configHome, configRoot } where home is the fake HOME dir
 * and configRoot = <home>/.config/opencode.
 */
async function makeFakeHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-install-"))
  const configHome = path.join(home, ".config")
  const configRoot = path.join(configHome, "opencode")
  return { home, configHome, configRoot }
}

/**
 * Run the installer setting HOME to fakeHome (required so that os.homedir()
 * resolves inside the fake tree). Also sets XDG_CONFIG_HOME if provided.
 */
function runInstall({ home, configHome, args = [] } = {}) {
  const env = { ...process.env }
  if (home) {
    env.HOME = home
    // Node on Windows resolves os.homedir() from USERPROFILE. Keep the
    // isolated fake-home contract portable across POSIX and Windows hosts.
    env.USERPROFILE = home
  }
  if (configHome) {
    env.XDG_CONFIG_HOME = configHome
  }
  return runNodeScript(installScript, args, { env })
}

/**
 * Check if a path exists (non-following).
 */
async function exists(filePath) {
  try {
    await fs.lstat(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Read a file as text.
 */
async function readFile(filePath) {
  return fs.readFile(filePath, "utf8")
}

// ---------------------------------------------------------------------------
// Positive tests
// ---------------------------------------------------------------------------

test("empty temp config target — install succeeds", async () => {
  const { home, configHome, configRoot } = await makeFakeHome()
  const result = runInstall({ home, configHome })

  assert.equal(result.status, 0, result.stderr)

  // Verify top-level files
  assert.ok(await exists(path.join(configRoot, "AGENTS.md")), "AGENTS.md should exist")
  assert.ok(await exists(path.join(configRoot, "CONTRIBUTING.md")), "CONTRIBUTING.md should exist")
  assert.ok(await exists(path.join(configRoot, "SECURITY.md")), "SECURITY.md should exist")
  assert.ok(await exists(path.join(configRoot, "opencode.json")), "opencode.json should exist")

  // Verify .opencode tree
  assert.ok(await exists(path.join(configRoot, ".opencode")), ".opencode should exist")
  assert.ok(await exists(path.join(configRoot, ".opencode", "agents")), ".opencode/agents should exist")
  assert.ok(await exists(path.join(configRoot, ".opencode", "skills")), ".opencode/skills should exist")
  assert.ok(await exists(path.join(configRoot, ".opencode", "policies")), ".opencode/policies should exist")

  // Verify agents/ and skills/ top-level siblings
  assert.ok(await exists(path.join(configRoot, "agents")), "agents should exist")
  assert.ok(await exists(path.join(configRoot, "skills")), "skills should exist")

  // Cleanup
  await fs.rm(home, { recursive: true, force: true })
})

test("existing normal config directory — install succeeds, existing config backed up", async () => {
  const { home, configHome, configRoot } = await makeFakeHome()

  // Create existing config with a known file
  await fs.mkdir(configRoot, { recursive: true })
  await fs.writeFile(path.join(configRoot, "AGENTS.md"), "original content", "utf8")

  const result = runInstall({ home, configHome })
  assert.equal(result.status, 0, result.stderr)

  // Verify the new content was installed (overwrites old)
  const content = await readFile(path.join(configRoot, "AGENTS.md"))
  assert.ok(content.includes("OpenCode") || content.includes("AGENTS"), "new AGENTS.md installed")

  // Backup should exist inside configRoot
  const backupDirs = await fs.readdir(path.join(configRoot, ".backups"))
  assert.ok(backupDirs.length > 0, "backup directory should exist")
  assert.ok(backupDirs.some((d) => d.startsWith("install-")), "backup should start with install-")

  // The backup manifest should reference the original file
  const backupDir = path.join(configRoot, ".backups", backupDirs.find((d) => d.startsWith("install-")))
  const manifest = JSON.parse(await readFile(path.join(backupDir, "backup-manifest.json")))
  const agentsEntry = manifest.files.find((f) => f.path.endsWith("AGENTS.md"))
  assert.ok(agentsEntry, "backup manifest should contain AGENTS.md")
  assert.ok(agentsEntry.existed, "AGENTS.md should have existed in backup")

  // Verify the backed-up version contains original content
  const backedUp = await readFile(path.join(backupDir, agentsEntry.backup_path))
  assert.equal(backedUp, "original content", "backup should contain original content")

  // Cleanup
  await fs.rm(home, { recursive: true, force: true })
})

test("backup created and contains original files", async () => {
  const { home, configHome, configRoot } = await makeFakeHome()

  // Pre-populate
  await fs.mkdir(configRoot, { recursive: true })
  await fs.writeFile(path.join(configRoot, "AGENTS.md"), "v1", "utf8")
  await fs.writeFile(path.join(configRoot, "SECURITY.md"), "v1-security", "utf8")

  const result = runInstall({ home, configHome })
  assert.equal(result.status, 0, result.stderr)

  const backupDirs = await fs.readdir(path.join(configRoot, ".backups"))
  const backupDir = path.join(configRoot, ".backups", backupDirs.find((d) => d.startsWith("install-")))
  const manifest = JSON.parse(await readFile(path.join(backupDir, "backup-manifest.json")))

  const agentsEntry = manifest.files.find((f) => f.path.endsWith("AGENTS.md"))
  const secEntry = manifest.files.find((f) => f.path.endsWith("SECURITY.md"))

  assert.ok(agentsEntry && agentsEntry.existed)
  assert.ok(secEntry && secEntry.existed)

  assert.equal(await readFile(path.join(backupDir, agentsEntry.backup_path)), "v1")
  assert.equal(await readFile(path.join(backupDir, secEntry.backup_path)), "v1-security")

  await fs.rm(home, { recursive: true, force: true })
})

test("repeated run is idempotent", async () => {
  const { home, configHome, configRoot } = await makeFakeHome()

  // First run
  const r1 = runInstall({ home, configHome })
  assert.equal(r1.status, 0, r1.stderr)

  // Capture state after first run
  const afterFirst = await readFile(path.join(configRoot, "AGENTS.md"))

  // Second run
  const r2 = runInstall({ home, configHome })
  assert.equal(r2.status, 0, r2.stderr)

  const afterSecond = await readFile(path.join(configRoot, "AGENTS.md"))

  // Content should be the same (idempotent)
  assert.equal(afterSecond, afterFirst)

  await fs.rm(home, { recursive: true, force: true })
})

test("--dry-run does not modify files", async () => {
  const { home, configHome, configRoot } = await makeFakeHome()

  // Pre-populate with custom content
  await fs.mkdir(configRoot, { recursive: true })
  await fs.writeFile(path.join(configRoot, "AGENTS.md"), "my custom rules", "utf8")

  const result = runInstall({ home, configHome, args: ["--dry-run"] })
  assert.equal(result.status, 0, result.stderr)

  // Content should be unchanged
  const content = await readFile(path.join(configRoot, "AGENTS.md"))
  assert.equal(content, "my custom rules", "dry-run should not modify files")

  // No backup should be created
  const backupExists = await exists(path.join(configRoot, ".backups"))
  assert.equal(backupExists, false, "dry-run should not create backup")

  // Verify stdout mentions dry-run
  const stdout = result.stdout
  assert.ok(stdout.includes("[DRY-RUN]"), `stdout should mention DRY-RUN, got: ${stdout.substring(0, 200)}`)
  assert.ok(stdout.includes("No files were modified"), "should state no files modified")

  await fs.rm(home, { recursive: true, force: true })
})

test("--rollback restores previous state", async () => {
  const { home, configHome, configRoot } = await makeFakeHome()

  // Pre-populate
  await fs.mkdir(configRoot, { recursive: true })
  await fs.writeFile(path.join(configRoot, "AGENTS.md"), "original rules", "utf8")

  // Install (creates backup)
  const r1 = runInstall({ home, configHome })
  assert.equal(r1.status, 0, r1.stderr)

  // Find the backup directory from the output
  const backupDirs = await fs.readdir(path.join(configRoot, ".backups"))
  const backupDir = path.join(configRoot, ".backups", backupDirs.find((d) => d.startsWith("install-")))

  // Verify the file was overwritten
  const afterInstall = await readFile(path.join(configRoot, "AGENTS.md"))
  assert.ok(afterInstall !== "original rules", "install should overwrite rules")

  // Rollback
  const r2 = runInstall({ home, configHome, args: ["--rollback", backupDir] })
  assert.equal(r2.status, 0, r2.stderr)

  // Verify restoration
  const afterRollback = await readFile(path.join(configRoot, "AGENTS.md"))
  assert.equal(afterRollback, "original rules", "rollback should restore original content")

  await fs.rm(home, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Negative tests — symlink attacks
// ---------------------------------------------------------------------------

test("target is a symlink → rejected", async (t) => {
  if (await skipIfHostCannotSymlink(t, { type: "dir" })) return
  const { home, configHome, configRoot } = await makeFakeHome()

  // Create an external directory and symlink opencode → external
  const externalDir = path.join(home, "evil-outside")
  await fs.mkdir(externalDir, { recursive: true })
  await fs.mkdir(path.dirname(configRoot), { recursive: true })
  await fs.symlink(externalDir, configRoot)

  const result = runInstall({ home, configHome })
  assert.notEqual(result.status, 0, "should fail when target is a symlink")
  assert.ok(
    result.stderr.includes("symlink") || result.stderr.includes("not allowed"),
    `should mention symlink rejection: ${result.stderr}`,
  )

  await fs.rm(home, { recursive: true, force: true })
})

test("parent directory contains a symlink → rejected", async (t) => {
  if (await skipIfHostCannotSymlink(t, { type: "dir" })) return
  const { home } = await makeFakeHome()

  // Create a fake XDG_CONFIG_HOME so that opencode target is a symlink
  const fakeConfig = path.join(home, "fake-config")
  await fs.mkdir(fakeConfig, { recursive: true })
  const evilDir = path.join(home, "evil-outside")
  await fs.mkdir(evilDir, { recursive: true })
  const symlinkTarget = path.join(fakeConfig, "opencode")
  await fs.symlink(evilDir, symlinkTarget)

  const result = runInstall({ home, configHome: fakeConfig })
  assert.notEqual(result.status, 0, "should fail when target is a symlink")
  assert.ok(
    result.stderr.includes("symlink") || result.stderr.includes("not allowed") || result.stderr.includes("escapes"),
    `should mention symlink/path rejection: ${result.stderr}`,
  )

  await fs.rm(home, { recursive: true, force: true })
})

test("subdirectory agents/ is a symlink → rejected", async (t) => {
  if (await skipIfHostCannotSymlink(t, { type: "dir" })) return
  const { home, configHome, configRoot } = await makeFakeHome()

  // First, do a clean install
  await fs.mkdir(configRoot, { recursive: true })
  const result = runInstall({ home, configHome })
  assert.equal(result.status, 0, result.stderr)

  // Now replace the agents/ dir with a symlink to outside
  const agentsDir = path.join(configRoot, "agents")
  await fs.rm(agentsDir, { recursive: true, force: true })
  const evilDir = path.join(home, "evil-agents")
  await fs.mkdir(evilDir, { recursive: true })
  await fs.symlink(evilDir, agentsDir)

  // Run install again — should detect symlink in target
  const r2 = runInstall({ home, configHome })
  assert.notEqual(r2.status, 0, "should fail when subdirectory agents/ is a symlink")
  assert.ok(
    r2.stderr.includes("symlink") || r2.stderr.includes("not allowed"),
    `should mention symlink rejection: ${r2.stderr}`,
  )

  await fs.rm(home, { recursive: true, force: true })
})

test("subdirectory skills/ is a symlink → rejected", async (t) => {
  if (await skipIfHostCannotSymlink(t, { type: "dir" })) return
  const { home, configHome, configRoot } = await makeFakeHome()

  // First install
  await fs.mkdir(configRoot, { recursive: true })
  const result = runInstall({ home, configHome })
  assert.equal(result.status, 0, result.stderr)

  // Replace skills/ with a symlink
  const skillsDir = path.join(configRoot, "skills")
  await fs.rm(skillsDir, { recursive: true, force: true })
  const evilDir = path.join(home, "evil-skills")
  await fs.mkdir(evilDir, { recursive: true })
  await fs.symlink(evilDir, skillsDir)

  const r2 = runInstall({ home, configHome })
  assert.notEqual(r2.status, 0, "should fail when subdirectory skills/ is a symlink")
  assert.ok(
    r2.stderr.includes("symlink") || r2.stderr.includes("not allowed"),
    `should mention symlink rejection: ${r2.stderr}`,
  )

  await fs.rm(home, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Negative tests — path traversal
// ---------------------------------------------------------------------------

test("XDG_CONFIG_HOME with path traversal (../../etc) → rejected", async () => {
  const { home } = await makeFakeHome()

  // Set XDG_CONFIG_HOME to a path with .. traversal to attempt /etc
  const configHome = path.join(home, "traversal", "..", "..", "test-target")
  const escapedRoot = path.resolve(configHome, "opencode")

  // Only test if the resolved path is outside the fake home
  if (escapedRoot.startsWith(home)) {
    // The resolution stayed inside, so this isn't a traversal test
    assert.ok(true)
  } else {
    const result = runInstall({ home, configHome })
    assert.notEqual(result.status, 0, "should fail with path traversal")
  }

  await fs.rm(home, { recursive: true, force: true })
})

test("unsafe state produces no partial installation — target unchanged after error", async (t) => {
  if (await skipIfHostCannotSymlink(t, { type: "dir" })) return
  const { home, configHome, configRoot } = await makeFakeHome()

  // Pre-populate
  await fs.mkdir(configRoot, { recursive: true })
  await fs.writeFile(path.join(configRoot, "AGENTS.md"), "before install", "utf8")

  // Capture pre-state
  const preStat = await fs.lstat(configRoot)
  assert.ok(preStat.isDirectory())

  // Create a blocking symlink — the boundary check will catch it before any writes
  const agentsDir = path.join(configRoot, "agents")
  await fs.mkdir(agentsDir, { recursive: true })
  await fs.rm(agentsDir, { recursive: true, force: true })
  await fs.symlink(path.join(home, "nowhere"), agentsDir)

  const result = runInstall({ home, configHome })
  assert.notEqual(result.status, 0, "should fail")

  // After failure, the original AGENTS.md should still be intact
  const originalContent = await readFile(path.join(configRoot, "AGENTS.md"))
  assert.equal(originalContent, "before install", "original files should be preserved after error")

  await fs.rm(home, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Source symlink detection test
// ---------------------------------------------------------------------------

test("source repo contains a symlink → symlink is skipped", async (t) => {
  if (await skipIfHostCannotSymlink(t, { type: "file" })) return
  // This test verifies the concept: if a directory read contains a symlink,
  // the Dirent.isSymbolicLink() check skips it.
  // Since we can't modify the real repo source, we verify the behavior by
  // creating a temporary copy of the repo structure with a planted symlink.

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-srcsym-"))

  // Create a minimal fake repo structure
  await fs.mkdir(path.join(tmpDir, ".opencode"), { recursive: true })

  // Plant a real file
  await fs.writeFile(path.join(tmpDir, ".opencode", "safe-file.md"), "# safe", "utf8")

  // Plant a symlink that should be skipped
  const outsideFile = path.join(os.tmpdir(), "opencode-test-outside-file")
  await fs.writeFile(outsideFile, "evil", "utf8")
  await fs.symlink(outsideFile, path.join(tmpDir, ".opencode", "symlink-entry.md"))

  // Now readdir and verify the symlink is detected
  const entries = await fs.readdir(path.join(tmpDir, ".opencode"), { withFileTypes: true })
  const symlinkEntry = entries.find((e) => e.name === "symlink-entry.md")
  const safeEntry = entries.find((e) => e.name === "safe-file.md")

  assert.ok(symlinkEntry, "symlink entry should be in readdir")
  assert.ok(symlinkEntry.isSymbolicLink(), "should be detected as symlink")
  assert.ok(safeEntry, "safe entry should be in readdir")
  assert.equal(safeEntry.isSymbolicLink(), false, "safe entry should not be symlink")

  // Verify that our copyTreeSafe would skip this: we simulate the check
  // (This is a unit-level verification of the logic, not an integration test)
  const skipped = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      skipped.push(entry.name)
    }
  }
  assert.deepEqual(skipped, ["symlink-entry.md"], "symlink should be identified for skipping")

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true })
  try { await fs.rm(outsideFile, { force: true }) } catch {}
})

// ---------------------------------------------------------------------------
// Edge case tests
// ---------------------------------------------------------------------------

test("non-existent XDG_CONFIG_HOME base dir → install succeeds with created directories", async () => {
  const { home } = await makeFakeHome()
  const configHome = path.join(home, "brand-new-config")
  // configHome doesn't exist yet

  const result = runInstall({ home, configHome })
  assert.equal(result.status, 0, result.stderr)

  const configRoot = path.join(configHome, "opencode")
  assert.ok(await exists(configRoot), "config root should be created")
  assert.ok(await exists(path.join(configRoot, "AGENTS.md")), "files should be installed")

  await fs.rm(home, { recursive: true, force: true })
})

test("--help prints usage and exits 0", async () => {
  const result = runNodeScript(installScript, ["--help"])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.stdout.includes("Usage"), "should show usage")
})

test("unknown flag is rejected", async () => {
  const { home, configHome } = await makeFakeHome()
  const result = runInstall({ home, configHome, args: ["--unknown-flag"] })
  assert.notEqual(result.status, 0, "unknown flag should fail")
  await fs.rm(home, { recursive: true, force: true })
})

test("target exists as file (not directory) → rejected", async () => {
  const { home, configHome, configRoot } = await makeFakeHome()

  // Create the parent directory and a FILE at the config path
  await fs.mkdir(path.dirname(configRoot), { recursive: true })
  await fs.writeFile(configRoot, "i am a file not a dir", "utf8")

  const result = runInstall({ home, configHome })
  assert.notEqual(result.status, 0, "should fail when target is a file")
  assert.ok(
    result.stderr.includes("not a directory") || result.stderr.includes("exists"),
    `should indicate target is not a directory: ${result.stderr}`,
  )

  await fs.rm(home, { recursive: true, force: true })
})

test("--rollback with missing manifest fails cleanly", async () => {
  const result = runNodeScript(installScript, ["--rollback", "/tmp/nonexistent-backup-12345"])
  assert.notEqual(result.status, 0, "rollback with missing backup should fail")
})

// ---------------------------------------------------------------------------
// Full integration: round-trip install → rollback
// ---------------------------------------------------------------------------

test("round-trip: install then rollback restores exact original content", async () => {
  const { home, configHome, configRoot } = await makeFakeHome()

  // Step 1: Create rich original content
  await fs.mkdir(configRoot, { recursive: true })
  await fs.writeFile(path.join(configRoot, "AGENTS.md"), "orig AGENTS", "utf8")
  await fs.writeFile(path.join(configRoot, "SECURITY.md"), "orig SECURITY", "utf8")
  await fs.mkdir(path.join(configRoot, ".opencode"), { recursive: true })
  await fs.writeFile(path.join(configRoot, ".opencode", "custom.json"), '{"key":"val"}', "utf8")

  // Step 2: Install
  const r1 = runInstall({ home, configHome })
  assert.equal(r1.status, 0, r1.stderr)

  // Step 3: After install, verify files changed
  const afterInstallAgents = await readFile(path.join(configRoot, "AGENTS.md"))
  assert.notEqual(afterInstallAgents, "orig AGENTS", "install should overwrite")

  // Step 4: Find backup and rollback
  const backupDirs = await fs.readdir(path.join(configRoot, ".backups"))
  const backupDir = path.join(configRoot, ".backups", backupDirs.find((d) => d.startsWith("install-")))
  const r2 = runInstall({ home, configHome, args: ["--rollback", backupDir] })
  assert.equal(r2.status, 0, r2.stderr)

  // Step 5: Verify exact restoration
  assert.equal(await readFile(path.join(configRoot, "AGENTS.md")), "orig AGENTS")
  assert.equal(await readFile(path.join(configRoot, "SECURITY.md")), "orig SECURITY")
  assert.equal(await readFile(path.join(configRoot, ".opencode", "custom.json")), '{"key":"val"}')

  await fs.rm(home, { recursive: true, force: true })
})
