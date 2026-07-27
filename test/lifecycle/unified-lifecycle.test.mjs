import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  LIFECYCLE_OPERATIONS,
  buildRunMetric,
  detectInstallationState,
  inspectLifecycle,
} from "../../scripts/lib/lifecycle.mjs"

test("lifecycle exposes one explicit state-machine vocabulary", () => {
  assert.deepEqual(LIFECYCLE_OPERATIONS, [
    "INSPECT",
    "PLAN",
    "INSTALL_NEW",
    "UPDATE_EXISTING",
    "VERIFY_ONLY",
    "STATUS",
    "ROLLBACK",
  ])
})

test("empty, overlay-only, governance-only, and combined installations stay distinguishable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-lifecycle-unit-"))
  try {
    await fs.writeFile(path.join(root, "README.md"), "# fixture\n")
    assert.equal((await detectInstallationState(root)).layer_state, "NOT_INSTALLED")

    await fs.mkdir(path.join(root, ".opencode", "reports", "bootstrap"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "reports", "bootstrap", "report.json"), "{}")
    assert.equal((await detectInstallationState(root)).layer_state, "OVERLAY_ONLY")

    await fs.rm(path.join(root, ".opencode"), { recursive: true, force: true })
    await fs.mkdir(path.join(root, ".agent-governance"), { recursive: true })
    await fs.writeFile(path.join(root, ".agent-governance", "manifest.json"), JSON.stringify({ schema_version: "1.0.0", managed_files: [] }))
    assert.equal((await detectInstallationState(root)).layer_state, "GOVERNANCE_ONLY")

    await fs.mkdir(path.join(root, ".opencode", "reports", "bootstrap"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "reports", "bootstrap", "report.json"), "{}")
    const inspected = await inspectLifecycle(root)
    assert.equal(inspected.substatus, "BOTH_LAYERS_INSTALLED")
    assert.equal(inspected.classification, "NEEDS_REVIEW")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("metrics are local, schema-shaped, and omit prompt and tool-output fields", () => {
  const metric = buildRunMetric({
    project_id: "fixture",
    runtime: "opencode",
    planned_actions: ["inspect"],
    executed_actions: ["inspect"],
    final_classification: "NEEDS_REVIEW",
    prompt: "must not survive",
    tool_output: "must not survive",
  })
  assert.equal(metric.project_id, "fixture")
  assert.equal("prompt" in metric, false)
  assert.equal("tool_output" in metric, false)
  assert.ok(metric.run_id)
})

test("an OpenCode bridge file is not a registered hook without an explicit project registration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-hook-registration-"))
  try {
    await fs.mkdir(path.join(root, ".opencode", "plugins"), { recursive: true })
    await fs.writeFile(path.join(root, "opencode.jsonc"), "{}")
    await fs.writeFile(path.join(root, ".opencode", "plugins", "governance-v2.mjs"), "export default async () => ({})\n")
    assert.equal((await detectInstallationState(root)).runtimes[0].hook_registered_structurally, false)

    await fs.writeFile(path.join(root, "opencode.jsonc"), '{ "plugin": [".opencode/plugins/governance-v2.mjs"] }')
    assert.equal((await detectInstallationState(root)).runtimes[0].hook_registered_structurally, true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
