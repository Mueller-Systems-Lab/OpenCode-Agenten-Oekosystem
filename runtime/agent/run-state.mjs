import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { capabilityProfileHash, preflightFingerprint, runMcpPreflight } from "../../scripts/lib/mcp-preflight.mjs"
import { appendGovernanceEvent, createGovernanceEvent } from "../observability/events.mjs"

export const RUN_STATE_SCHEMA_VERSION = "1.0.0"
export const RESUME_DRIFT = "RESUME_STATE_RECONCILIATION_REQUIRED"

const REQUIRED_FIELDS = [
  "schema_version", "project_id", "run_id", "task_id", "agent_role", "agent_execution_id",
  "repository_start_sha", "repository_current_sha", "state", "current_step", "completed_steps",
  "pending_steps", "blockers", "evidence_paths", "last_successful_gate", "mcp_preflight_fingerprint",
  "capability_profile_hash", "created_at", "updated_at",
]

export function newRunState({ project_id, run_id = crypto.randomUUID(), task_id, agent_role, agent_execution_id = crypto.randomUUID(), repository_start_sha, repository_current_sha = repository_start_sha, steps = [], mcp_preflight_fingerprint = null, capability_profile_hash: profileHash = null } = {}) {
  const now = new Date().toISOString()
  return {
    schema_version: RUN_STATE_SCHEMA_VERSION, project_id, run_id, task_id, agent_role, agent_execution_id,
    repository_start_sha, repository_current_sha, state: "READY", current_step: null,
    completed_steps: [], pending_steps: [...steps], blockers: [], evidence_paths: [],
    last_successful_gate: null, mcp_preflight_fingerprint, capability_profile_hash: profileHash,
    created_at: now, updated_at: now,
  }
}

export function validateRunState(state) {
  const issues = []
  if (!state || typeof state !== "object" || Array.isArray(state)) return ["state must be an object"]
  for (const field of REQUIRED_FIELDS) if (!(field in state)) issues.push(`missing ${field}`)
  if (state.schema_version !== RUN_STATE_SCHEMA_VERSION) issues.push("unsupported schema_version")
  for (const field of ["completed_steps", "pending_steps", "blockers", "evidence_paths"]) if (!Array.isArray(state[field])) issues.push(`${field} must be an array`)
  if (state.current_step && state.completed_steps.includes(state.current_step)) issues.push("current_step cannot be completed")
  return issues
}

async function atomicWrite(filePath, value) {
  const target = path.resolve(filePath)
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" })
    await fs.rename(temp, target)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

export async function saveRunState(filePath, state) {
  const issues = validateRunState(state)
  if (issues.length > 0) throw new Error(`Invalid run state: ${issues.join("; ")}`)
  await atomicWrite(filePath, state)
  return path.resolve(filePath)
}

export async function loadRunState(filePath) {
  let parsed
  try { parsed = JSON.parse(await fs.readFile(filePath, "utf8")) } catch (error) {
    if (error?.code === "ENOENT") return null
    throw new Error(`RUN_STATE_CORRUPT: ${error.message}`)
  }
  const issues = validateRunState(parsed)
  if (issues.length > 0) throw new Error(`RUN_STATE_CORRUPT: ${issues.join("; ")}`)
  return parsed
}

export function reconcileRunState(state, { repository_current_sha, capability_profile_hash: profileHash, mcp_preflight_fingerprint: preflightHash } = {}) {
  const reasons = []
  if (repository_current_sha && state.repository_current_sha !== repository_current_sha) reasons.push("repository commit changed")
  if (profileHash && state.capability_profile_hash !== profileHash) reasons.push("capability profile changed")
  if (preflightHash && state.mcp_preflight_fingerprint !== preflightHash) reasons.push("MCP preflight fingerprint changed")
  if (state.current_step && !state.completed_steps.includes(state.current_step) && state.state === "RUNNING") reasons.push("previous step was interrupted")
  return reasons.length === 0 ? { ok: true, state } : { ok: false, code: RESUME_DRIFT, reasons }
}

async function acquireRunLock(filePath) {
  const lock = `${path.resolve(filePath)}.lock`
  try {
    const handle = await fs.open(lock, "wx")
    await handle.writeFile(`${process.pid}\n`)
    return { lock, release: async () => { await handle.close(); await fs.rm(lock, { force: true }) } }
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("RESUME_RUN_LOCKED: another process owns this run")
    throw error
  }
}

export async function executeResumableRun({ statePath, context, profile, inventory = {}, configHash = null, steps = [], executeStep, tracePath = null, stopAfterSteps = null } = {}) {
  if (typeof executeStep !== "function") throw new Error("executeStep is required")
  const profileHash = capabilityProfileHash(profile)
  if (tracePath) await appendGovernanceEvent(tracePath, createGovernanceEvent({ name: "agent.preflight.start", attributes: { "project.id": context?.project_id, "run.id": context?.run_id, "task.id": context?.task_id, "agent.role": context?.agent_role, status: "START" } }))
  const preflight = runMcpPreflight({ profile, inventory, configHash })
  if (tracePath) await appendGovernanceEvent(tracePath, createGovernanceEvent({ name: "agent.preflight.result", attributes: { "project.id": context?.project_id, "run.id": context?.run_id, "task.id": context?.task_id, "agent.role": context?.agent_role, status: preflight.status, code: preflight.code } }))
  if (!preflight.allowed) return { state: null, preflight, classification: "RED_BLOCK", code: preflight.code, executed: [] }
  const runFingerprint = preflight.fingerprint || preflightFingerprint({ profile, inventory, configHash })
  let state = await loadRunState(statePath)
  if (!state) state = newRunState({ ...context, steps, mcp_preflight_fingerprint: runFingerprint, capability_profile_hash: profileHash })
  else {
    const reconciliation = reconcileRunState(state, { repository_current_sha: context.repository_current_sha, capability_profile_hash: profileHash, mcp_preflight_fingerprint: runFingerprint })
    if (!reconciliation.ok) return { state, preflight, classification: "NEEDS_REVIEW", code: RESUME_DRIFT, reasons: reconciliation.reasons, executed: [] }
    state = { ...state, state: state.state === "COMPLETE" ? "COMPLETE" : "READY", pending_steps: steps.filter((step) => !state.completed_steps.includes(step)), updated_at: new Date().toISOString() }
  }
  if (state.state === "COMPLETE") return { state, preflight, classification: "VERIFIED_IN_SCOPE", code: "RUN_ALREADY_COMPLETE", executed: [] }
  const lock = await acquireRunLock(statePath)
  const executed = []
  try {
    if (tracePath) await appendGovernanceEvent(tracePath, createGovernanceEvent({ name: state.completed_steps.length ? "agent.resume" : "agent.start", attributes: { "project.id": context.project_id, "run.id": state.run_id, "task.id": context.task_id, "agent.role": context.agent_role, "agent.execution.id": context.agent_execution_id, "source.commit": context.repository_current_sha, status: "START" } }))
    state = { ...state, state: "RUNNING", updated_at: new Date().toISOString() }
    await saveRunState(statePath, state)
    for (const step of state.pending_steps) {
      state = { ...state, current_step: step, pending_steps: state.pending_steps, updated_at: new Date().toISOString() }
      await saveRunState(statePath, state)
      if (tracePath) await appendGovernanceEvent(tracePath, createGovernanceEvent({ name: "agent.task.start", attributes: { "project.id": context.project_id, "run.id": state.run_id, "task.id": context.task_id, "agent.role": context.agent_role, step } }))
      const result = await executeStep(step, state)
      executed.push(step)
      state = { ...state, state: "RUNNING", current_step: null, completed_steps: [...state.completed_steps, step], pending_steps: state.pending_steps.filter((item) => item !== step), last_successful_gate: result?.gate || state.last_successful_gate, evidence_paths: [...new Set([...state.evidence_paths, ...(result?.evidence_paths || [])])], updated_at: new Date().toISOString() }
      await saveRunState(statePath, state)
      if (tracePath) await appendGovernanceEvent(tracePath, createGovernanceEvent({ name: "agent.task.result", attributes: { "project.id": context.project_id, "run.id": state.run_id, "task.id": context.task_id, "agent.role": context.agent_role, step, status: "PASS" } }))
      if (Number.isInteger(stopAfterSteps) && executed.length >= stopAfterSteps && state.pending_steps.length > 0) {
        state = { ...state, state: "PAUSED", current_step: null, updated_at: new Date().toISOString() }
        await saveRunState(statePath, state)
        return { state, preflight, classification: "VERIFIED_IN_SCOPE", code: "RUN_PAUSED", executed }
      }
    }
    state = { ...state, state: "COMPLETE", updated_at: new Date().toISOString() }
    await saveRunState(statePath, state)
    return { state, preflight, classification: "VERIFIED_IN_SCOPE", code: "RUN_COMPLETE", executed }
  } finally {
    await lock.release()
  }
}
