#!/usr/bin/env node

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { discoverMcpServers, authorizeMcpOperationWithEvidence } from "./lib/mcp-preflight.mjs"
import { startAgent } from "../runtime/agent/start.mjs"
import { executeResumableRun } from "../runtime/agent/run-state.mjs"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-completion-canary-"))
const statePath = path.join(root, "run-state.json")
const evidenceDir = path.resolve("evidence/completion-canary-r3")
await fs.mkdir(evidenceDir, { recursive: true, mode: 0o700 })
const tracePath = path.join(evidenceDir, "events.jsonl")
const fixture = path.resolve("test/fixtures/mcp-governance-server.mjs")
const inventory = discoverMcpServers({ fixture: { command: process.execPath, args: [fixture], trust_tier: "1_sandboxed", network_policy: "deny", egress_policy: "deny" } })
const context = { project_id: "completion-canary", run_id: "canary-run", task_id: "canary-task", agent_role: "review-agent", agent_execution_id: "canary-exec", repository_start_sha: "canary", repository_current_sha: "canary" }

const valid = await startAgent({ agentId: "review-agent", statePath, context, inventory, steps: ["inspect"], tracePath, executeStep: async () => ({ gate: "CANARY_TASK_PASS", evidence_paths: ["events.jsonl"] }) })
const requiredProfile = {
  agent_id: "canary-required", role: "canary", required_tools: [{ name: "missing_required", server: "missing-server" }], optional_tools: [],
  allowed_operations: ["read"], denied_operations: ["write"], allowed_paths: ["fixtures/**"], write_paths: [],
  network_policy: "deny", egress_policy: "deny", trust_tier: "1_sandboxed", tool_version_constraints: {}, auth_requirement: {},
  timeout_ms: 5000, preflight_failure_policy: "FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT",
}
const missing = await executeResumableRun({ statePath: path.join(root, "missing-state.json"), context: { ...context, run_id: "missing-run", agent_role: "canary-required" }, profile: requiredProfile, inventory, steps: ["must-not-run"], executeStep: async () => { throw new Error("agent work must not start") } })
const denied = await authorizeMcpOperationWithEvidence({ profile: { ...requiredProfile, required_tools: ["fixture"] }, tool: "fixture", operation: "write", path: "fixtures/blocked", tracePath })
const resumeStatePath = path.join(root, "resume-state.json")
const firstResume = await executeResumableRun({ statePath: resumeStatePath, context: { ...context, run_id: "resume-run" }, profile: { ...requiredProfile, agent_id: "resume-agent", required_tools: [] }, steps: ["A", "B"], stopAfterSteps: 1, executeStep: async () => ({}) })
const secondResume = await executeResumableRun({ statePath: resumeStatePath, context: { ...context, run_id: "resume-run" }, profile: { ...requiredProfile, agent_id: "resume-agent", required_tools: [] }, steps: ["A", "B"], executeStep: async () => ({}) })

const report = {
  canary: "LOCAL_COMPLETION_CANARY",
  valid_agent: { classification: valid.classification, code: valid.code, preflight: valid.preflight.status },
  missing_required_mcp: { classification: missing.classification, code: missing.code, executed: missing.executed },
  policy_deny: { allowed: denied.allowed, code: denied.code },
  resume: { first: firstResume.code, second: secondResume.code },
  trace_path: path.relative(process.cwd(), tracePath).replaceAll("\\", "/"),
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
await fs.writeFile(path.join(evidenceDir, "canary-report.json"), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
await fs.rm(root, { recursive: true, force: true })
