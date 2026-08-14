import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { repoRoot } from "../helpers.mjs"
import adapter from "../../src/ocae_cli/_adapter/opencode-handoff.js"

const { inspectProjectMetadata, reconcileProject } = adapter

const CURRENT_COMMIT = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
const OLD_COMMIT = "93a779a6fd7da32c937430191570bda2a83ffab4"
const TRUSTED_MANIFEST = {
  adapter_version: "1.0.4",
  ocae_version: "1.0.4",
  opencode_version: "1.18.18",
  cli_path: "C:\\trusted\\ocae.exe",
  source_commit: CURRENT_COMMIT,
}

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" })
}

async function makeGitTarget(prefix) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  await fs.writeFile(path.join(target, "README.md"), "# target\n", "utf8")
  git(target, ["init", "--initial-branch=master"])
  git(target, ["config", "user.email", "ocae-test@example.invalid"])
  git(target, ["config", "user.name", "OCAE Test"])
  git(target, ["add", "README.md"])
  git(target, ["commit", "-m", "initial"])
  return target
}

async function makeOldInstallation(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-old-release-fixture-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const oldSource = path.join(root, "old-source")
  await fs.mkdir(oldSource)
  const archive = spawnSync("git", ["archive", "--format=tar", OLD_COMMIT], { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 })
  assert.equal(archive.status, 0, archive.stderr?.toString())
  const extracted = spawnSync("tar", ["-xf", "-", "-C", oldSource], { input: archive.stdout, encoding: "utf8" })
  assert.equal(extracted.status, 0, extracted.stderr || "old release extraction failed")
  const target = await makeGitTarget("ocae-old-project")
  t.after(() => fs.rm(target, { recursive: true, force: true }))
  await fs.writeFile(path.join(target, "opencode.jsonc"), '{"plugin": []}\n', "utf8")
  const environment = {
    ...process.env,
    OCAE_BOOTSTRAP_SOURCE_COMMIT: OLD_COMMIT,
    OCAE_BOOTSTRAP_SOURCE_REPOSITORY: "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem",
  }
  const installed = spawnSync(process.execPath, [path.join(oldSource, "scripts/install-governance.mjs"), "--target", target, "--apply", "--json"], {
    cwd: oldSource,
    env: environment,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  })
  assert.equal(installed.status, 0, installed.stderr || installed.stdout)
  assert.equal(JSON.parse(await fs.readFile(path.join(target, ".agent-governance/source-lock.json"), "utf8")).source_commit, OLD_COMMIT)
  assert.equal((await fs.stat(path.join(target, ".opencode/plugins/governance-v2.mjs"))).isFile(), true)
  assert.equal(await fs.access(path.join(target, ".agent-governance/runtime/bootstrap/task-bootstrap.mjs")).then(() => true).catch(() => false), false)
  return target
}

test("real pre-v1.0.2 installation is detected before task bootstrap", async (t) => {
  const target = await makeOldInstallation(t)
  const state = inspectProjectMetadata(target, TRUSTED_MANIFEST)
  assert.equal(state.state, "MIGRATION_REQUIRED")
  assert.equal(state.reason, "RUNTIME_STATE_MISSING")
  assert.equal(await fs.access(path.join(target, ".agent-governance/owner-intent.json")).then(() => true).catch(() => false), false)
  assert.equal(await fs.access(path.join(target, ".agent-governance/task-capsule.json")).then(() => true).catch(() => false), false)
})

test("trusted reconciliation updates the real old fixture and preserves owner files", async (t) => {
  const target = await makeOldInstallation(t)
  await fs.appendFile(path.join(target, "README.md"), "owner edit\n", "utf8")
  const untracked = path.join(target, "user-untracked.txt")
  await fs.writeFile(untracked, "keep me\n", "utf8")
  const readmeBefore = await fs.readFile(path.join(target, "README.md"))
  const untrackedBefore = await fs.readFile(untracked)
  const calls = []
  const events = []
  const runner = async (executable, args, cwd) => {
    calls.push({ executable, args, cwd, shell: false })
    if (args[0] === "doctor") return { exit_code: 1, stdout: JSON.stringify({ classification: "PROJECT_MIGRATION_REQUIRED" }), stderr: "" }
    if (args[0] === "update") {
      const result = spawnSync(process.execPath, [
        path.join(repoRoot, "scripts/install-governance.mjs"), "--target", target, "--apply", "--json", "--mode", "UPDATE_EXISTING",
      ], {
        cwd: repoRoot,
        env: { ...process.env, OCAE_BOOTSTRAP_SOURCE_COMMIT: CURRENT_COMMIT, OCAE_BOOTSTRAP_SOURCE_REPOSITORY: TRUSTED_MANIFEST.source_repository || "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem" },
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      })
      return { exit_code: result.status, stdout: result.stdout, stderr: result.stderr }
    }
    assert.equal(args[0], "verify")
    return { exit_code: 0, stdout: JSON.stringify({ classification: "VERIFIED_IN_SCOPE", governance_bootstrap_ready: true }), stderr: "" }
  }
  const result = await reconcileProject({
    client: { app: { log: async ({ body }) => events.push(body) } },
    targetRoot: target,
    manifest: TRUSTED_MANIFEST,
    runner,
  })
  assert.equal(result.state, "CURRENT")
  assert.equal(result.migrated, true)
  assert.deepEqual(calls.map((call) => call.args[0]), ["doctor", "update", "verify"])
  assert.ok(calls.every((call) => path.isAbsolute(call.args[1]) || call.args[1] === target))
  assert.ok(calls.every((call) => call.args.includes(target)))
  assert.deepEqual(events.map((event) => event.message).filter((event) => event.startsWith("OCAE_PROJECT_")), [
    "OCAE_PROJECT_RECONCILE_STARTED",
    "OCAE_PROJECT_VERSION_DETECTED",
    "OCAE_PROJECT_MIGRATION_REQUIRED",
    "OCAE_PROJECT_MIGRATION_STARTED",
    "OCAE_PROJECT_MIGRATION_COMPLETED",
    "OCAE_PROJECT_VERIFY_COMPLETED",
  ])
  assert.deepEqual(await fs.readFile(path.join(target, "README.md")), readmeBefore)
  assert.deepEqual(await fs.readFile(untracked), untrackedBefore)
  assert.equal((await fs.stat(path.join(target, ".agent-governance/runtime/bootstrap/task-bootstrap.mjs"))).isFile(), true)
  const migratedPlugin = await fs.readFile(path.join(target, ".agent-governance/hooks/opencode/canonical-governance.mjs"), "utf8")
  assert.match(migratedPlugin, /chat\.message/)
  const marker = JSON.parse(await fs.readFile(path.join(target, ".agent-governance/runtime-state.json"), "utf8"))
  assert.equal(marker.source_commit, CURRENT_COMMIT)

  const runtime = await import(pathToFileURL(path.join(target, ".agent-governance/runtime/bootstrap/task-bootstrap.mjs")).href)
  const task = await runtime.bootstrapTask({
    targetRoot: target,
    sessionId: "old-migration-session",
    messageId: "old-migration-message",
    userMessage: "Create a small file and run the tests.",
  })
  assert.equal(task.state, "TASK_READY")
  assert.ok(await runtime.readTaskContext(target))
})

test("current marker is a no-CLI fast path and foreign projects pass through", async (t) => {
  const target = await makeGitTarget("ocae-current-fast-path")
  t.after(() => fs.rm(target, { recursive: true, force: true }))
  const install = spawnSync(process.execPath, [path.join(repoRoot, "scripts/install-governance.mjs"), "--target", target, "--apply", "--json"], {
    cwd: repoRoot,
    env: { ...process.env, OCAE_BOOTSTRAP_SOURCE_COMMIT: CURRENT_COMMIT, OCAE_BOOTSTRAP_SOURCE_REPOSITORY: "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem" },
    encoding: "utf8",
  })
  assert.equal(install.status, 0, install.stderr || install.stdout)
  const calls = []
  const current = await reconcileProject({ targetRoot: target, manifest: TRUSTED_MANIFEST, runner: async (...args) => { calls.push(args); throw new Error("fast path must not invoke CLI") } })
  assert.equal(current.state, "CURRENT")
  assert.equal(calls.length, 0)

  const foreign = await makeGitTarget("ocae-foreign-project")
  t.after(() => fs.rm(foreign, { recursive: true, force: true }))
  const passed = await reconcileProject({ targetRoot: foreign, manifest: TRUSTED_MANIFEST, runner: async () => { throw new Error("foreign project must pass through") } })
  assert.equal(passed.state, "NOT_INSTALLED")
})
