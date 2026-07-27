import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { runNodeScript } from "../helpers.mjs"

test("inspect, plan, registry status, and verify form a non-mutating lifecycle for an uninstalled target", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "ocae integration with spaces-"))
  const target = path.join(parent, "target project")
  const registry = path.join(parent, "local-registry.json")
  await fs.mkdir(target)
  await fs.writeFile(path.join(target, "README.md"), "# fixture\n")
  try {
    for (const operation of ["inspect", "plan", "verify"]) {
      const result = runNodeScript("scripts/ocae.mjs", [operation, "--target", target, "--json"])
      assert.equal(result.status, 1, `${operation}: ${result.stderr}`)
      const output = JSON.parse(result.stdout)
      assert.equal(
        output.substatus.includes("NOT_INSTALLED") || output.substatus.includes("RUNTIME_NOT_FOUND") || output.substatus.includes("INSTALL_NEW_PLANNED"),
        true,
      )
    }
    const update = runNodeScript("scripts/ocae.mjs", ["update", "--target", target, "--json"])
    assert.equal(update.status, 1, update.stderr)
    assert.equal(JSON.parse(update.stdout).substatus, "NOT_INSTALLED")

    const register = runNodeScript("scripts/ocae.mjs", ["register", "--target", target, "--registry", registry, "--json"])
    assert.equal(register.status, 0, register.stderr)
    assert.equal(JSON.parse(register.stdout).classification, "NEEDS_REVIEW")
    const status = runNodeScript("scripts/ocae.mjs", ["status", "--registry", registry, "--json"])
    assert.equal(status.status, 0, status.stderr)
    assert.equal(JSON.parse(status.stdout).projects.length, 1)
    assert.equal((await fs.readdir(target)).sort().join(","), "README.md")
  } finally {
    await fs.rm(parent, { recursive: true, force: true })
  }
})

test("install delegates both layers, preserves hash integrity, supports an idempotent update, and delegates rollback", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "ocae full lifecycle-"))
  const target = path.join(parent, "OpenCode target")
  const registry = path.join(parent, "registry.json")
  try {
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, "README.md"), "# lifecycle fixture\n")
    await fs.writeFile(path.join(target, "opencode.jsonc"), '{ "plugin": [".opencode/plugins/governance-v2.mjs"] }\n')

    const installed = runNodeScript("scripts/ocae.mjs", ["install", "--target", target, "--json"])
    assert.equal(installed.status, 1, installed.stderr)
    const installOutput = JSON.parse(installed.stdout)
    assert.equal(installOutput.state.layer_state, "BOTH_LAYERS")
    assert.deepEqual(installOutput.state.governance.managed_drift, [])
    assert.equal(await fs.stat(path.join(target, ".agent-governance", "manifest.json")).then((entry) => entry.isFile()), true)

    const simulated = runNodeScript("scripts/ocae.mjs", ["verify", "--target", target, "--registry", registry, "--simulate", "--json"])
    assert.equal(simulated.status, 1, simulated.stderr)
    const simulatedOutput = JSON.parse(simulated.stdout)
    assert.equal(simulatedOutput.substatus, "HOOK_NOT_PROVEN")
    assert.equal(simulatedOutput.proof.activation.restart_verified, false)
    assert.equal(simulatedOutput.registry.updated, true)

    const updated = runNodeScript("scripts/ocae.mjs", ["update", "--target", target, "--registry", registry, "--json"])
    assert.equal(updated.status, 0, updated.stderr)
    const updateOutput = JSON.parse(updated.stdout)
    assert.equal(updateOutput.substatus, "NOOP_IDEMPOTENT")
    assert.deepEqual(updateOutput.state.governance.managed_drift, [])
    assert.equal(updateOutput.registry.updated, true)

    const registryStatus = runNodeScript("scripts/ocae.mjs", ["status", "--registry", registry, "--json"])
    assert.equal(registryStatus.status, 0, registryStatus.stderr)
    assert.equal(JSON.parse(registryStatus.stdout).projects[0].activation, "HOOK_NOT_PROVEN")

    const backupRoot = path.join(target, ".opencode", "backups")
    const backups = await fs.readdir(backupRoot)
    const governanceBackup = backups.find((name) => name.startsWith("governance-"))
    assert.ok(governanceBackup, `expected governance backup in ${backups.join(", ")}`)
    const rolledBack = runNodeScript("scripts/ocae.mjs", ["rollback", "--target", target, "--backup", path.join(backupRoot, governanceBackup), "--json"])
    assert.equal(rolledBack.status, 1, rolledBack.stderr)
    assert.equal(JSON.parse(rolledBack.stdout).substatus, "ROLLBACK_DELEGATED_UNVERIFIED")
    await assert.rejects(fs.stat(path.join(target, ".agent-governance", "manifest.json")))
  } finally {
    await fs.rm(parent, { recursive: true, force: true })
  }
})
