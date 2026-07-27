import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  classifyRuntimeProof,
  createRuntimeProof,
  runSyntheticRuntimeControls,
  validateRuntimeProof,
} from "../../scripts/lib/runtime-activation-proof.mjs"

const activation = {
  runtime_detected: true,
  adapter_selected: true,
  hook_registered: true,
  plugin_loaded: true,
  hook_observed: true,
  positive_control: "PASS",
  negative_control: "PASS",
  restart_performed: true,
  restart_plugin_loaded: true,
  restart_hook_observed: true,
  restart_positive_control: "PASS",
  restart_negative_control: "PASS",
  receipt_required_without_receipt: "BLOCK",
  valid_receipt: "ALLOW",
  replay: "BLOCK",
  session_binding: "PASS",
  call_binding: "PASS",
  resource_binding: "PASS",
  effect_binding: "PASS",
  parallel_single_use: "PASS",
  restart_replay_persistence: "PASS",
  safe_action_allowed: true,
  forbidden_action_blocked: true,
  scope_escape_blocked: true,
  secret_isolation_blocked: true,
  approval_required_action_blocked_without_receipt: true,
  approval_receipt_accepted: true,
  replay_blocked: true,
  restart_verified: false,
  bypass_scan_completed: true,
}

test("activation proof cannot collapse an unproven restart into VERIFIED_IN_SCOPE", () => {
  const proof = createRuntimeProof({
    project_id: "fixture",
    runtime: { name: "opencode", adapter: "opencode" },
    activation,
    evidence: [
      { kind: "isolated-runtime", result: "passed" },
      { kind: "bypass-scan", dynamic: true, result: "passed", critical_open_paths: 0 },
    ],
  })
  assert.deepEqual(validateRuntimeProof(proof), [])
  assert.equal(classifyRuntimeProof(proof).classification, "NEEDS_REVIEW")
  assert.ok(classifyRuntimeProof(proof).substatus.includes("RESTART_UNPROVEN"))
})

test("activation proof requires every control before VERIFIED_IN_SCOPE", () => {
  const proof = createRuntimeProof({
    project_id: "fixture",
    runtime: { name: "opencode", adapter: "opencode" },
    activation: { ...activation, restart_verified: true },
    evidence: [
      { kind: "isolated-runtime", result: "passed" },
      { kind: "bypass-scan", dynamic: true, result: "passed", critical_open_paths: 0 },
    ],
  })
  assert.equal(classifyRuntimeProof(proof).classification, "VERIFIED_IN_SCOPE")

  const unsafe = structuredClone(proof)
  unsafe.activation.forbidden_action_blocked = false
  assert.equal(classifyRuntimeProof(unsafe).classification, "RED_BLOCK")
})

test("a static bypass scan and adapter simulation cannot claim runtime activation", () => {
  const staticOnly = createRuntimeProof({
    project_id: "fixture",
    runtime: { name: "opencode", adapter: "opencode" },
    activation: { ...activation },
    evidence: [{ kind: "bypass-scan", method: "static-known-paths", result: "passed", critical_open_paths: 0 }],
  })
  assert.equal(classifyRuntimeProof(staticOnly).substatus[0], "BYPASS_RISK")

  const simulation = structuredClone(staticOnly)
  simulation.evidence.push({ kind: "adapter-simulation", result: "passed" })
  simulation.evidence.push({ kind: "bypass-scan", method: "synthetic-adapter-controls", dynamic: true, result: "passed", critical_open_paths: 0 })
  assert.equal(classifyRuntimeProof(simulation).substatus[0], "SIMULATION_ONLY")
})

test("synthetic control proof blocks force, scope escape, secret access, and receipt replay without exposing fixture content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-proof-unit-"))
  const secret = "TEST_ONLY_ACTIVATION_SECRET_DO_NOT_PRINT"
  try {
    await fs.writeFile(path.join(root, ".env"), `TOKEN=${secret}\n`, { mode: 0o600 })
    const controls = await runSyntheticRuntimeControls({ targetRoot: root, syntheticSecret: secret })
    assert.equal(controls.safe_action_allowed, true)
    assert.equal(controls.forbidden_action_blocked, true)
    assert.equal(controls.scope_escape_blocked, true)
    assert.equal(controls.secret_isolation_blocked, true)
    assert.equal(controls.approval_required_action_blocked_without_receipt, true)
    assert.equal(controls.approval_receipt_accepted, true)
    assert.equal(controls.replay_blocked, true)
    assert.equal(JSON.stringify(controls).includes(secret), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("Hermes has the same isolated adapter-control contract without claiming a Hermes process ran", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-hermes-adapter-"))
  try {
    const controls = await runSyntheticRuntimeControls({ targetRoot: root, adapter: "hermes" })
    assert.equal(controls.adapter, "hermes")
    for (const key of ["safe_action_allowed", "forbidden_action_blocked", "scope_escape_blocked", "secret_isolation_blocked", "approval_required_action_blocked_without_receipt", "approval_receipt_accepted", "replay_blocked"]) {
      assert.equal(controls[key], true)
    }
    const proof = createRuntimeProof({
      project_id: "hermes-fixture",
      runtime: { name: "hermes", adapter: "hermes" },
      activation: { ...activation, ...controls },
      evidence: [
        { kind: "adapter-simulation", adapter: "hermes", result: "passed" },
        { kind: "bypass-scan", dynamic: true, result: "passed", critical_open_paths: 0 },
      ],
    })
    assert.equal(classifyRuntimeProof(proof).substatus[0], "SIMULATION_ONLY")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
