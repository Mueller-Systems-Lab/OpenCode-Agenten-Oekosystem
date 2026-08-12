import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { pathToFileURL } from "node:url"
import { runNodeScript, repoRoot } from "../helpers.mjs"

const sourceAgents = path.join(repoRoot, ".opencode", "agents")

test("URL-only apply installs runtime-discoverable ecosystem agents into a fresh target", async (t) => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-agent-install-"))
  t.after(() => fs.rm(target, { recursive: true, force: true }))

  const before = runNodeScript("scripts/install-governance.mjs", ["--target", target, "--apply", "--json"])
  assert.equal(before.status, 0, before.stderr || before.stdout)

  const expected = (await fs.readdir(sourceAgents))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => name.slice(0, -3))

  const installedAgentsDir = path.join(target, ".opencode", "agents")
  assert.ok(await fs.stat(installedAgentsDir), "fresh apply must create .opencode/agents")
  const installed = (await fs.readdir(installedAgentsDir))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => name.slice(0, -3))
  assert.deepEqual(installed, expected)
  assert.ok(await fs.stat(path.join(target, "opencode.jsonc")), "fresh apply must create OpenCode config")

  const installation = JSON.parse(await fs.readFile(path.join(target, ".opencode", "ecosystem-installation.json"), "utf8"))
  assert.deepEqual(installation.installed_agents, expected)
  assert.equal(installation.capability_profile_bindings["review-agent"].mode, "subagent")
  assert.equal(installation.capability_profile_bindings["issue-orchestrator"].mode, "primary")

  const lock = JSON.parse(await fs.readFile(path.join(target, ".agent-governance", "source-lock.json"), "utf8"))
  const agentLocks = lock.files.filter((entry) => entry.kind === "agent_definition")
  assert.equal(agentLocks.length, expected.length)
  assert.ok(agentLocks.every((entry) => entry.installed_path && entry.sha256.startsWith("sha256:") && entry.installed_sha256.startsWith("sha256:")))
})

test("existing OpenCode configuration is merged without losing user settings", async (t) => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-agent-merge-"))
  t.after(() => fs.rm(target, { recursive: true, force: true }))
  await fs.writeFile(path.join(target, "opencode.jsonc"), `{
  // owner configuration
  "model": "fixture/custom-model",
  "provider": { "custom": { "baseURL": "http://127.0.0.1:9999/v1" } },
  "mcp": { "owner": { "type": "remote", "url": "http://127.0.0.1:4545/mcp", "enabled": true } }
}\n`, "utf8")

  const result = runNodeScript("scripts/install-governance.mjs", ["--target", target, "--apply", "--json"])
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const config = await fs.readFile(path.join(target, "opencode.jsonc"), "utf8")
  assert.match(config, /fixture\/custom-model/)
  assert.match(config, /127\.0\.0\.1:9999/)
  assert.match(config, /127\.0\.0\.1:4545/)
  assert.match(config, /\.opencode\/plugins\/governance-v2\.mjs/)
})

test("foreign agent name conflicts are preserved and fail closed", async (t) => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-agent-conflict-"))
  t.after(() => fs.rm(target, { recursive: true, force: true }))
  const agents = path.join(target, ".opencode", "agents")
  await fs.mkdir(agents, { recursive: true })
  const foreign = "---\ndescription: owner agent\nmode: subagent\n---\nOwner content\n"
  await fs.writeFile(path.join(agents, "review-agent.md"), foreign, "utf8")

  const result = runNodeScript("scripts/install-governance.mjs", ["--target", target, "--apply", "--json"])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /NAME_CONFLICT/)
  assert.equal(await fs.readFile(path.join(agents, "review-agent.md"), "utf8"), foreign)
  assert.equal(await fs.stat(path.join(target, ".agent-governance")).then(() => true).catch(() => false), false)
})

test("second apply is idempotent and rollback removes newly installed agents", async (t) => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-agent-lifecycle-"))
  t.after(() => fs.rm(target, { recursive: true, force: true }))
  const first = runNodeScript("scripts/install-governance.mjs", ["--target", target, "--apply", "--json"])
  assert.equal(first.status, 0, first.stderr || first.stdout)
  const second = runNodeScript("scripts/install-governance.mjs", ["--target", target, "--apply", "--json"])
  assert.equal(second.status, 0, second.stderr || second.stdout)
  assert.equal(JSON.parse(second.stdout).mode, "NOOP_IDEMPOTENT")

  const backup = (await fs.readdir(path.join(target, ".opencode", "backups"))).find((name) => name.startsWith("governance-"))
  assert.ok(backup)
  const rollback = runNodeScript("scripts/install-governance.mjs", ["--target", target, "--rollback", path.join(target, ".opencode", "backups", backup), "--json"])
  assert.equal(rollback.status, 0, rollback.stderr || rollback.stdout)
  assert.equal(await fs.stat(path.join(target, ".opencode", "agents")).then(() => true).catch(() => false), false)
  assert.equal(await fs.stat(path.join(target, "opencode.jsonc")).then(() => true).catch(() => false), false)
})

test("managed agent tampering is detected by the installed governance plugin", async (t) => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-agent-tamper-"))
  t.after(() => fs.rm(target, { recursive: true, force: true }))
  const apply = runNodeScript("scripts/install-governance.mjs", ["--target", target, "--apply", "--json"])
  assert.equal(apply.status, 0, apply.stderr || apply.stdout)
  await fs.appendFile(path.join(target, ".opencode", "agents", "review-agent.md"), "\n// tampered\n", "utf8")
  const plugin = await import(pathToFileURL(path.join(target, ".agent-governance", "hooks", "opencode", "canonical-governance.mjs")).href)
  const hooks = await plugin.default({ directory: target, worktree: target })
  await assert.rejects(
    hooks["tool.execute.before"]({ tool: "read", callID: "tamper-test" }, { args: { filePath: "README.md" } }),
    /TAMPER_DETECTED|source-lock integrity failed/
  )
})
