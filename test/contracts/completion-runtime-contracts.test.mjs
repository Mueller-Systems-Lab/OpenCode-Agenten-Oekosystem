import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  discoverMcpServers,
  authorizeMcpOperation,
  authorizeMcpOperationWithEvidence,
  runMcpPreflight,
} from "../../scripts/lib/mcp-preflight.mjs"
import { executeResumableRun, loadRunState } from "../../runtime/agent/run-state.mjs"
import { startAgent } from "../../runtime/agent/start.mjs"
import { createGovernanceEvent } from "../../runtime/observability/events.mjs"

const baseProfile = (overrides = {}) => ({
  agent_id: "test-agent", role: "test", required_tools: [], optional_tools: [],
  allowed_operations: ["read", "write"], denied_operations: ["production_write"],
  allowed_paths: ["fixtures/**"], write_paths: ["fixtures/**"], network_policy: "deny",
  egress_policy: "deny", trust_tier: "1_sandboxed", tool_version_constraints: {},
  auth_requirement: {}, timeout_ms: 5000,
  preflight_failure_policy: "FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT", ...overrides,
})

const inventory = (tool = {}) => ({
  server: {
    name: "server", available: true, protocol_version: "2024-11-05", auth_present: true,
    trust_tier: "1_sandboxed", network_policy: "deny", egress_policy: "deny", timeout_ms: 1000,
    tools: [
      { name: "read_fixture", version: "1.2.0", operations: ["read"] },
      { name: "write_fixture", version: "1.2.0", operations: ["write"] }, tool,
    ],
  },
})

describe("mandatory MCP preflight contract", () => {
  it("N1/N2/N3/N4 fail closed for unavailable, missing, version, and operation failures", () => {
    assert.equal(runMcpPreflight({ profile: baseProfile({ required_tools: ["missing"] }), inventory: {} }).code, "FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT")
    assert.equal(runMcpPreflight({ profile: baseProfile({ required_tools: [{ name: "missing", server: "server" }] }), inventory: inventory() }).allowed, false)
    assert.equal(runMcpPreflight({ profile: baseProfile({ required_tools: [{ name: "read_fixture", version: ">=2.0" }] }), inventory: inventory() }).allowed, false)
    assert.equal(runMcpPreflight({ profile: baseProfile({ required_tools: [{ name: "read_fixture", operations: ["write"] }] }), inventory: inventory() }).allowed, false)
  })

  it("N5/N6/N7 block undeclared tools, denied operations, and path escapes", () => {
    const profile = baseProfile({ optional_tools: ["read_fixture"] })
    assert.equal(authorizeMcpOperation({ profile, tool: "unknown", operation: "read" }).code, "UNDECLARED_MCP_CAPABILITY")
    assert.equal(authorizeMcpOperation({ profile, tool: "read_fixture", operation: "production_write", path: "fixtures/a" }).allowed, false)
    assert.equal(authorizeMcpOperation({ profile, tool: "read_fixture", operation: "read", path: "../outside", root: os.tmpdir() }).allowed, false)
    const noWriteProfile = baseProfile({ optional_tools: ["read_fixture"], write_paths: [] })
    assert.equal(authorizeMcpOperation({ profile: noWriteProfile, tool: "read_fixture", operation: "write", path: "fixtures/a", root: os.tmpdir() }).code, "MCP_WRITE_SCOPE_DENIED")
  })

  it("N8/N9/N10 degrade optional absence, invalidate changed fingerprints, and fail closed on bad profiles", () => {
    const profile = baseProfile({ optional_tools: ["optional_missing"] })
    const first = runMcpPreflight({ profile, inventory: {}, configHash: "a" })
    assert.equal(first.code, "DEGRADED_OPTIONAL_MCP_CAPABILITY")
    assert.equal(first.allowed, true)
    const changed = runMcpPreflight({ profile, inventory: {}, configHash: "b", previous: first })
    assert.equal(changed.reused, false)
    assert.notEqual(changed.fingerprint, first.fingerprint)
    const invalid = runMcpPreflight({ profile: { agent_id: "bad" }, inventory: {} })
    assert.equal(invalid.allowed, false)
    assert.equal(invalid.code, "FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT")
  })

  it("performs a real local MCP initialize/tools-list discovery without exposing credentials", () => {
    const fixture = path.resolve("test/fixtures/mcp-governance-server.mjs")
    const discovered = discoverMcpServers({ fixture: { command: process.execPath, args: [fixture], auth_env: "NOT_A_REAL_SECRET" } })
    assert.equal(discovered.fixture.available, true)
    assert.deepEqual(discovered.fixture.tools.map((tool) => tool.name), ["read_fixture", "write_fixture", "mystery_effect"])
    assert.equal(JSON.stringify(discovered).includes("NOT_A_REAL_SECRET"), false)
  })
})

describe("generic resumable agent run contract", () => {
  const context = (root, sha = "a".repeat(40)) => ({
    project_id: "completion-test", run_id: "run-1", task_id: "task-1", agent_role: "test-agent",
    agent_execution_id: "exec-1", repository_start_sha: sha, repository_current_sha: sha,
  })

  it("R1 resumes after a persisted pause without repeating completed work", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-run-state-"))
    const statePath = path.join(root, "run.json")
    const calls = []
    const first = await executeResumableRun({ statePath, context: context(root), profile: baseProfile(), steps: ["A", "B"], stopAfterSteps: 1, executeStep: async (step) => { calls.push(step); return { gate: "STEP_PASS" } } })
    const second = await executeResumableRun({ statePath, context: context(root), profile: baseProfile(), steps: ["A", "B"], executeStep: async (step) => { calls.push(step); return { gate: "STEP_PASS" } } })
    assert.equal(first.code, "RUN_PAUSED")
    assert.equal(second.code, "RUN_COMPLETE")
    assert.deepEqual(calls, ["A", "B"])
    await fs.rm(root, { recursive: true, force: true })
  })

  it("R2/R3 require reconciliation for repository and capability/preflight drift", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-run-drift-"))
    const statePath = path.join(root, "run.json")
    await executeResumableRun({ statePath, context: context(root), profile: baseProfile(), steps: ["A"], stopAfterSteps: 1, executeStep: async () => ({}) })
    const repoDrift = await executeResumableRun({ statePath, context: context(root, "b".repeat(40)), profile: baseProfile(), steps: ["A"], executeStep: async () => ({}) })
    assert.equal(repoDrift.code, "RESUME_STATE_RECONCILIATION_REQUIRED")
    const profileDrift = await executeResumableRun({ statePath, context: context(root), profile: baseProfile({ role: "changed" }), steps: ["A"], executeStep: async () => ({}) })
    assert.equal(profileDrift.code, "RESUME_STATE_RECONCILIATION_REQUIRED")
    await fs.rm(root, { recursive: true, force: true })
  })

  it("R4 rejects corruption and R5 serializes parallel starts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-run-lock-"))
    const statePath = path.join(root, "run.json")
    await fs.writeFile(statePath, "{broken")
    await assert.rejects(() => loadRunState(statePath), /RUN_STATE_CORRUPT/)
    await fs.rm(statePath, { force: true })
    const run = () => executeResumableRun({ statePath, context: context(root), profile: baseProfile(), steps: ["A"], executeStep: async () => { await new Promise((resolve) => setTimeout(resolve, 30)); return {} } })
    const results = await Promise.allSettled([run(), run()])
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1)
    assert.equal(results.filter((result) => result.status === "rejected" && /RESUME_RUN_LOCKED/.test(result.reason.message)).length, 1)
    await fs.rm(root, { recursive: true, force: true })
  })

  it("starts only with a manifest capability profile", async () => {
    const missing = await startAgent({ agentId: "does-not-exist", statePath: path.join(os.tmpdir(), "unused-run-state.json"), context: context(os.tmpdir()), steps: [], executeStep: async () => ({}) })
    assert.equal(missing.code, "FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT")
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-start-"))
    const statePath = path.join(root, "run.json")
    const started = await startAgent({ agentId: "review-agent", statePath, context: context(root), steps: ["inspect"], executeStep: async () => ({ gate: "PREFLIGHT_AND_TASK_PASS" }) })
    assert.equal(started.code, "RUN_COMPLETE")
    await fs.rm(root, { recursive: true, force: true })
  })
})

describe("governed observability contract", () => {
  it("emits only the governed event names and separates project attributes", async () => {
    const event = createGovernanceEvent({ name: "agent.preflight.result", attributes: { "project.id": "p", "run.id": "r", "gen_ai.secret": "must-drop", prompt: "must-drop", status: "PASS" } })
    assert.equal(event.attributes["project.id"], "p")
    assert.equal(event.attributes.status, "PASS")
    assert.equal("gen_ai.secret" in event.attributes, false)
    assert.equal("prompt" in event.attributes, false)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-trace-"))
    const tracePath = path.join(root, "events.jsonl")
    const denied = await authorizeMcpOperationWithEvidence({ profile: baseProfile({ optional_tools: ["read_fixture"] }), tool: "read_fixture", operation: "production_write", path: "fixtures/a", tracePath })
    assert.equal(denied.allowed, false)
    assert.match(await fs.readFile(tracePath, "utf8"), /policy\.deny/)
    await fs.rm(root, { recursive: true, force: true })
  })
})
