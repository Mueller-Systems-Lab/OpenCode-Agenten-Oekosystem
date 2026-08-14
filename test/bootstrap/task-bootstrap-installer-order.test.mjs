import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"
import { repoRoot, runNodeScript } from "../helpers.mjs"

test("installer reports bootstrap readiness and activates the hook only after self-test", async (t) => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-bootstrap-order-"))
  t.after(() => fs.rm(target, { recursive: true, force: true }))
  spawnSync("git", ["init", "--initial-branch=master"], { cwd: target, stdio: "ignore" })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: target, stdio: "ignore" })
  spawnSync("git", ["config", "user.name", "Bootstrap Test"], { cwd: target, stdio: "ignore" })
  const result = runNodeScript("scripts/install-governance.mjs", ["--target", target, "--apply", "--json"])
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const output = JSON.parse(result.stdout)
  assert.equal(output.governance_bootstrap_ready, true)
  assert.equal(output.manual_bootstrap_required, false)
  assert.equal(output.hook_activation_order, "VALID")
  assert.equal(output.bootstrap_self_test, "PASS")
  assert.equal(output.post_validation.task_bootstrap_runtime, "PRESENT")
  assert.equal(output.post_validation.task_bootstrap_policy, "VALID")
  assert.equal(output.post_validation.task_context_writer, "VALID")

  const verify = runNodeScript("bootstrap/verify.mjs", ["--target", target, "--json"])
  assert.equal(verify.status, 0, verify.stderr || verify.stdout)
  const verified = JSON.parse(verify.stdout)
  assert.equal(verified.governance_bootstrap_ready, true)
  assert.equal(verified.hook_activation_order, "VALID")
  assert.ok(await fs.stat(path.join(target, ".agent-governance/policies/task-bootstrap-policy.json")))
  assert.ok(await fs.stat(path.join(target, ".agent-governance/runtime/governance/owner-intent.schema.json")))
  assert.ok(await fs.stat(path.join(target, ".agent-governance/runtime/governance/task-capsule.schema.json")))

  const installer = await fs.readFile(path.join(repoRoot, "scripts/install-governance.mjs"), "utf8")
  assert.ok(installer.indexOf("validateBootstrapRuntime") < installer.indexOf("mergeOpenCodePluginConfig"))
})
