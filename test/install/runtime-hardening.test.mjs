import test from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { repoRoot, runNodeScript } from "../helpers.mjs"

const INSTALLER = "scripts/install-governance.mjs"
const GOVERNANCE_PLUGIN = "./.opencode/plugins/governance-v2.mjs"

function sourceCommit() {
  return spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
}

function installerEnv() {
  return {
    OCAE_BOOTSTRAP_SOURCE_COMMIT: sourceCommit(),
    OCAE_BOOTSTRAP_SOURCE_REPOSITORY: "https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem",
  }
}

function parseJsonc(text) {
  return JSON.parse(text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1"))
}

async function targetDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
}

function install(target, extraArgs = []) {
  return runNodeScript(INSTALLER, ["--target", target, "--apply", "--json", ...extraArgs], { env: installerEnv() })
}

test("OpenCode installer activation contract covers fresh, merge, idempotency, and rollback", async (t) => {
  const fresh = await targetDir("ocae-hardening-fresh")
  const existing = await targetDir("ocae-hardening-existing")
  t.after(async () => {
    await Promise.all([
      fs.rm(fresh, { recursive: true, force: true }),
      fs.rm(existing, { recursive: true, force: true }),
    ])
  })

  const freshResult = install(fresh, ["--runtime", "opencode"])
  assert.equal(freshResult.status, 0, freshResult.stderr || freshResult.stdout)
  const freshConfigPath = path.join(fresh, "opencode.jsonc")
  assert.equal((await fs.stat(path.join(fresh, ".opencode/plugins/governance-v2.mjs"))).isFile(), true)
  const freshConfig = parseJsonc(await fs.readFile(freshConfigPath, "utf8"))
  assert.deepEqual(freshConfig.plugin, [GOVERNANCE_PLUGIN])
  const freshInstallation = JSON.parse(await fs.readFile(path.join(fresh, ".opencode/ecosystem-installation.json"), "utf8"))
  assert.ok(freshInstallation.managed_files.includes("opencode.jsonc"))

  const originalConfig = `{
  // preserve this owner comment
  "plugin": [
    "./third-party/plugin.mjs",
  ],
  "agent": { "owner-agent": { "description": "keep" } },
  "mcp": { "third-party": { "enabled": false } },
  "permission": { "edit": "ask" }
}\n`
  await fs.writeFile(path.join(existing, "opencode.jsonc"), originalConfig, "utf8")

  const first = install(existing)
  assert.equal(first.status, 0, first.stderr || first.stdout)
  const firstResult = JSON.parse(first.stdout)
  const mergedText = await fs.readFile(path.join(existing, "opencode.jsonc"), "utf8")
  const merged = parseJsonc(mergedText)
  assert.match(mergedText, /preserve this owner comment/)
  assert.deepEqual(merged.plugin, ["./third-party/plugin.mjs", GOVERNANCE_PLUGIN])
  assert.deepEqual(merged.agent, { "owner-agent": { description: "keep" } })
  assert.deepEqual(merged.mcp, { "third-party": { enabled: false } })
  assert.deepEqual(merged.permission, { edit: "ask" })
  assert.equal((merged.plugin || []).filter((entry) => entry === GOVERNANCE_PLUGIN).length, 1)
  assert.equal((await fs.readFile(path.join(existing, ".opencode/plugins/governance-v2.mjs"), "utf8")).includes("CanonicalGovernancePlugin"), true)

  const second = install(existing)
  assert.equal(second.status, 0, second.stderr || second.stdout)
  assert.equal(JSON.parse(second.stdout).mode, "NOOP_IDEMPOTENT")
  const backupRoot = firstResult.backup_root
  assert.ok(backupRoot)

  const rollback = runNodeScript(INSTALLER, ["--target", existing, "--rollback", backupRoot, "--json"], { env: installerEnv() })
  assert.equal(rollback.status, 0, rollback.stderr || rollback.stdout)
  assert.equal(await fs.readFile(path.join(existing, "opencode.jsonc"), "utf8"), originalConfig)
  await assert.rejects(fs.access(path.join(existing, ".opencode/plugins/governance-v2.mjs")))
})

test("early missing/invalid Task Capsule decisions are audited once and remain fail-closed", async (t) => {
  const dir = await targetDir("ocae-hardening-audit")
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const auditPath = path.join(dir, "action-audit.jsonl")
  const { evaluateAction } = await import(pathToFileURL(path.join(repoRoot, "runtime/gates/evaluate-action.mjs")).href)

  const missing = await evaluateAction({
    runtime: "opencode",
    tool: "write",
    action: "write",
    resource: "token=supersecret",
    auditPath,
  })
  assert.equal(missing.allowed, false)
  assert.equal(missing.code, "RED_BLOCK_TASK_CAPSULE_MISSING_OR_INVALID")

  const invalid = await evaluateAction({
    runtime: "opencode",
    tool: "write",
    action: "write",
    resource: "invalid-capsule",
    capsule: { task_id: "invalid" },
    auditPath,
  })
  assert.equal(invalid.allowed, false)
  assert.equal(invalid.code, "RED_BLOCK_TASK_CAPSULE_MISSING_OR_INVALID")

  const lines = (await fs.readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  assert.equal(lines.length, 2)
  assert.ok(lines.every((entry) => entry.event === "ACTION_DECISION"))
  assert.ok(lines.every((entry) => entry.code === "RED_BLOCK_TASK_CAPSULE_MISSING_OR_INVALID"))
  assert.doesNotMatch(JSON.stringify(lines), /supersecret/)

  const auditDirectory = path.join(dir, "audit-failure")
  await fs.mkdir(auditDirectory)
  const failedAudit = await evaluateAction({
    runtime: "opencode",
    tool: "write",
    action: "write",
    resource: "audit-failure",
    auditPath: auditDirectory,
  })
  assert.equal(failedAudit.allowed, false)
  assert.equal(failedAudit.code, "RED_BLOCK_TASK_CAPSULE_MISSING_OR_INVALID")
})

test("installed evaluate-action source matches the repository source", async (t) => {
  const target = await targetDir("ocae-hardening-identity")
  t.after(() => fs.rm(target, { recursive: true, force: true }))
  const result = install(target, ["--runtime", "opencode"])
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const source = await fs.readFile(path.join(repoRoot, "runtime/gates/evaluate-action.mjs"))
  const installed = await fs.readFile(path.join(target, ".agent-governance/runtime/gates/evaluate-action.mjs"))
  assert.equal(crypto.createHash("sha256").update(installed).digest("hex"), crypto.createHash("sha256").update(source).digest("hex"))
})
