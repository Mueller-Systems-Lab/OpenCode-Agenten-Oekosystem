// SPDX-License-Identifier: MIT
/**
 * Trusted task-context bootstrap boundary.
 *
 * This module is installed inside the target project by the canonical
 * installer. It is intentionally deterministic: the owner message may shape
 * descriptive fields, but only this module, system policy, and the fixed
 * bootstrap ceiling decide effects and scopes.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { matchesScope } from "../approval/approval-engine.mjs"

export const BOOTSTRAP_STATES = Object.freeze([
  "COLD_READ_ONLY",
  "TASK_BOOTSTRAPPING",
  "TASK_READY",
  "TASK_BLOCKED",
  "TASK_COMPLETED",
])

export const OBSERVABILITY_EVENTS = Object.freeze([
  "TASK_BOOTSTRAP_STARTED",
  "OWNER_INTENT_COMPILED",
  "OWNER_INTENT_VALIDATED",
  "TASK_CAPSULE_COMPILED",
  "TASK_CAPSULE_VALIDATED",
  "TASK_CONTEXT_PERSISTED",
  "TASK_READY",
  "TASK_BOOTSTRAP_BLOCKED",
  "TASK_CAPSULE_RECONCILED",
])

const ALLOWED_EFFECTS = Object.freeze([
  "LOCAL_READ",
  "LOCAL_STATE",
  "LOCAL_WRITE",
  "LOCAL_DELETE",
  "LOCAL_EXECUTE",
  "TEST_EXECUTION",
  "LOCAL_COMMIT",
  "DELEGATE",
])

const DENIED_EFFECTS = Object.freeze([
  "PUSH",
  "MERGE",
  "PRODUCTION_DEPLOY",
  "EXTERNAL_COMMUNICATION",
  "SECRET_ACCESS",
  "IRREVERSIBLE_DELETE",
  "APPROVAL_ENGINE_MUTATION",
  "CAPABILITY_REGISTRY_MUTATION",
])

const REQUIRED_INTENT_FIELDS = Object.freeze([
  "intent_id",
  "goal",
  "why",
  "desired_outcome",
  "hard_constraints",
  "forbidden_outcomes",
  "risk_tolerance",
  "cost_limit",
  "external_effect_policy",
  "data_sensitivity",
  "completion_expectation",
  "valid_from",
  "valid_until",
])

const REQUIRED_CAPSULE_FIELDS = Object.freeze([
  "task_id",
  "owner_intent_id",
  "goal",
  "why",
  "risk_tier",
  "execution_profile",
  "source_of_truth",
  "baseline",
  "read_scope",
  "write_scope",
  "forbidden_scope",
  "allowed_effects",
  "acceptance_criteria",
  "evidence_required",
  "approval_budget",
  "active_approval_receipts",
  "active_change_leases",
  "stop_conditions",
])

const CONTEXT_FILES = Object.freeze({
  intent: [".agent-governance", "owner-intent.json"],
  capsule: [".agent-governance", "task-capsule.json"],
  metadata: [".agent-governance", "task-context.json"],
  state: [".agent-governance", "state", "task-bootstrap-state.json"],
  events: [".agent-governance", "evidence", "task-bootstrap-events.jsonl"],
  policy: [".agent-governance", "policies", "task-bootstrap-policy.json"],
  intentSchema: [".agent-governance", "runtime", "governance", "owner-intent.schema.json"],
  capsuleSchema: [".agent-governance", "runtime", "governance", "task-capsule.schema.json"],
  policySchema: [".agent-governance", "runtime", "governance", "task-bootstrap-policy.schema.json"],
  runtime: [".agent-governance", "runtime", "bootstrap", "task-bootstrap.mjs"],
})

const inProcessLocks = new Map()

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex")
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function sha256Bytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`
}

function safeErrorCode(error) {
  const value = String(error?.code || error?.message || "TASK_BOOTSTRAP_FAILED")
  return value.replace(/[^A-Z0-9_:-]+/gi, "_").slice(0, 120) || "TASK_BOOTSTRAP_FAILED"
}

function normalizeTargetRoot(targetRoot) {
  if (typeof targetRoot !== "string" || !path.isAbsolute(targetRoot)) throw new Error("RED_BLOCK_TARGET_ROOT_UNCLEAR")
  const absolute = path.resolve(targetRoot)
  const rootStat = fs.lstatSync(absolute)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("RED_BLOCK_TARGET_ROOT_SYMLINK")
  const canonical = path.normalize(fs.realpathSync(absolute))
  if (path.normalize(absolute) !== canonical) throw new Error("RED_BLOCK_TARGET_ROOT_CANONICALIZATION")
  return canonical
}

function exactPath(targetRoot, segments) {
  const root = normalizeTargetRoot(targetRoot)
  const destination = path.resolve(root, ...segments)
  const relative = path.relative(root, destination)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("RED_BLOCK_TARGET_ROOT_ESCAPE")
  }
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    let stat
    try { stat = fs.lstatSync(current) } catch (error) {
      if (error.code === "ENOENT") continue
      throw error
    }
    if (stat.isSymbolicLink()) throw new Error("RED_BLOCK_SYMLINK_ESCAPE")
  }
  return destination
}

function readJsonFile(targetRoot, segments, required = true) {
  const filePath = exactPath(targetRoot, segments)
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RED_BLOCK_SCHEMA_INVALID")
    return value
  } catch (error) {
    if (!required && error.code === "ENOENT") return null
    if (error.code === "ENOENT") throw new Error("RED_BLOCK_BOOTSTRAP_FILE_MISSING")
    if (error.message === "RED_BLOCK_SCHEMA_INVALID") throw error
    throw new Error("RED_BLOCK_BOOTSTRAP_JSON_INVALID")
  }
}

function loadPolicy(targetRoot) {
  const policy = readJsonFile(targetRoot, CONTEXT_FILES.policy)
  validatePolicy(policy)
  return policy
}

function validatePolicy(policy) {
  if (policy?.schema_version !== "governance-v2.task-bootstrap-policy.1") throw new Error("RED_BLOCK_BOOTSTRAP_POLICY_INVALID")
  if (!Array.isArray(policy.states) || !BOOTSTRAP_STATES.every((state) => policy.states.includes(state))) throw new Error("RED_BLOCK_BOOTSTRAP_POLICY_INVALID")
  const ceiling = policy.bootstrap_ceiling
  if (!ceiling || !Array.isArray(ceiling.allowed_effects) || !Array.isArray(ceiling.denied_effects)) throw new Error("RED_BLOCK_BOOTSTRAP_CEILING_INVALID")
  if (ceiling.allowed_effects.some((effect) => !ALLOWED_EFFECTS.includes(effect)) || ceiling.denied_effects.some((effect) => !DENIED_EFFECTS.includes(effect))) throw new Error("RED_BLOCK_BOOTSTRAP_CEILING_INVALID")
  if (ceiling.allowed_effects.some((effect) => ceiling.denied_effects.includes(effect))) throw new Error("RED_BLOCK_BOOTSTRAP_CEILING_CONFLICT")
  for (const name of ["read_scope", "write_scope", "external_effect_scope", "forbidden_scope"]) {
    if (!Array.isArray(ceiling[name])) throw new Error("RED_BLOCK_BOOTSTRAP_CEILING_INVALID")
  }
  const requiredForbidden = [".env", "**/.env", "**/.env.*", ".git/**", ".agent-governance/**"]
  if (requiredForbidden.some((entry) => !ceiling.forbidden_scope.includes(entry))) throw new Error("RED_BLOCK_BOOTSTRAP_FORBIDDEN_SCOPE_MISSING")
}

function validateOwnerIntent(intent) {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) throw new Error("RED_BLOCK_OWNER_INTENT_SCHEMA_INVALID")
  for (const field of REQUIRED_INTENT_FIELDS) {
    if (!(field in intent)) throw new Error("RED_BLOCK_OWNER_INTENT_SCHEMA_INVALID")
  }
  if (Object.keys(intent).some((field) => !REQUIRED_INTENT_FIELDS.includes(field) && field !== "default_decision_preferences")) throw new Error("RED_BLOCK_OWNER_INTENT_SCHEMA_INVALID")
  for (const field of ["intent_id", "goal", "why", "desired_outcome", "risk_tolerance", "external_effect_policy", "data_sensitivity", "completion_expectation", "valid_from", "valid_until"]) {
    if (typeof intent[field] !== "string" || !intent[field].trim()) throw new Error("RED_BLOCK_OWNER_INTENT_SCHEMA_INVALID")
  }
  for (const field of ["hard_constraints", "forbidden_outcomes"]) {
    if (!Array.isArray(intent[field]) || intent[field].some((value) => typeof value !== "string")) throw new Error("RED_BLOCK_OWNER_INTENT_SCHEMA_INVALID")
  }
  if (!(typeof intent.cost_limit === "number" || typeof intent.cost_limit === "string")) throw new Error("RED_BLOCK_OWNER_INTENT_SCHEMA_INVALID")
  if (Number.isNaN(Date.parse(intent.valid_from)) || Number.isNaN(Date.parse(intent.valid_until))) throw new Error("RED_BLOCK_OWNER_INTENT_SCHEMA_INVALID")
  return true
}

function validateTaskCapsule(capsule, intent, policy) {
  if (!capsule || typeof capsule !== "object" || Array.isArray(capsule)) throw new Error("RED_BLOCK_TASK_CAPSULE_SCHEMA_INVALID")
  for (const field of REQUIRED_CAPSULE_FIELDS) if (!(field in capsule)) throw new Error("RED_BLOCK_TASK_CAPSULE_SCHEMA_INVALID")
  if (capsule.owner_intent_id !== intent.intent_id) throw new Error("RED_BLOCK_OWNER_INTENT_BINDING_INVALID")
  if (!["LOW_LOCAL", "MEDIUM_REVIEW", "HIGH_HUMAN_GATE", "CRITICAL_BLOCK"].includes(capsule.risk_tier)) throw new Error("RED_BLOCK_TASK_CAPSULE_SCHEMA_INVALID")
  if (!["COMPACT", "STANDARD", "CRITICAL", "BLOCKED"].includes(capsule.execution_profile)) throw new Error("RED_BLOCK_TASK_CAPSULE_SCHEMA_INVALID")
  for (const field of ["read_scope", "write_scope", "forbidden_scope", "allowed_effects", "acceptance_criteria", "evidence_required", "active_approval_receipts", "active_change_leases", "stop_conditions"]) {
    if (!Array.isArray(capsule[field])) throw new Error("RED_BLOCK_TASK_CAPSULE_SCHEMA_INVALID")
  }
  if (!capsule.baseline || typeof capsule.baseline !== "object" || !capsule.baseline.base_sha) throw new Error("RED_BLOCK_TASK_CAPSULE_BASELINE_INVALID")
  if (!capsule.approval_budget || typeof capsule.approval_budget !== "object") throw new Error("RED_BLOCK_TASK_CAPSULE_SCHEMA_INVALID")
  const ceiling = policy.bootstrap_ceiling
  if (capsule.allowed_effects.some((effect) => !ceiling.allowed_effects.includes(effect) || ceiling.denied_effects.includes(effect))) throw new Error("RED_BLOCK_BOOTSTRAP_CEILING_EXPANDED")
  if (!ceiling.read_scope.every((entry) => capsule.read_scope.includes(entry)) || !ceiling.write_scope.every((entry) => capsule.write_scope.includes(entry))) throw new Error("RED_BLOCK_BOOTSTRAP_SCOPE_NARROWING_INVALID")
  if (ceiling.forbidden_scope.some((entry) => !capsule.forbidden_scope.includes(entry))) throw new Error("RED_BLOCK_BOOTSTRAP_FORBIDDEN_SCOPE_MISSING")
  return true
}

function redactPrompt(value) {
  return String(value || "")
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:sk|gh[pousr])_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_TOKEN]")
    .replace(/(api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*[^\s]+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512)
}

function gitBaseline(targetRoot) {
  try {
    const gitOptions = { cwd: targetRoot, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], gitOptions).trim()
    const branch = execFileSync("git", ["branch", "--show-current"], gitOptions).trim() || null
    let repository = null
    try { repository = execFileSync("git", ["config", "--get", "remote.origin.url"], gitOptions).trim() || null } catch {}
    return { base_sha: /^[0-9a-f]{40}$/i.test(baseSha) ? baseSha : "UNKNOWN", branch, repository }
  } catch {
    return { base_sha: "NO_GIT_BASELINE", branch: null, repository: null }
  }
}

function classifyRisk(message) {
  return /\b(?:deploy|production|publish|release|merge|push|send|communicat|veröffent|veroeffent)\b/i.test(message) ? "HIGH_HUMAN_GATE" : "MEDIUM_REVIEW"
}

function compileOwnerIntent({ targetRoot, sessionId, messageId, userMessage, now = new Date() }) {
  const excerpt = redactPrompt(userMessage) || "Owner requested a task in the target workspace."
  const identity = hash(`${targetRoot}\0${sessionId}\0${messageId}\0${userMessage}`)
  const validFrom = now.toISOString()
  const validUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  return {
    intent_id: `intent-${identity.slice(0, 32)}`,
    goal: excerpt,
    why: "Initialize the direct owner request within the trusted target boundary.",
    desired_outcome: "Complete the requested task with bounded local effects and verification.",
    hard_constraints: [
      "Only the direct top-level owner request is an intent source.",
      "Never access secrets or leave the immutable target root.",
      "External effects remain subject to the existing approval engine.",
    ],
    forbidden_outcomes: [
      "Automatic push, merge, production deploy, publish, or external communication.",
      "Secret access or mutation of approval, capability, or governance policy internals.",
    ],
    risk_tolerance: "bounded by system policy and the task-bootstrap ceiling",
    cost_limit: "not automatically authorized",
    external_effect_policy: "approval_required",
    data_sensitivity: "repository-code; secret access prohibited",
    completion_expectation: "verified local work within the task scope",
    valid_from: validFrom,
    valid_until: validUntil,
    default_decision_preferences: {
      prefer_reversible_changes: true,
      prefer_local_over_cloud: true,
      prefer_existing_dependencies: true,
      prefer_fail_closed: true,
      prefer_small_scoped_refactors: true,
      prefer_draft_pr_over_direct_merge: true,
      prefer_evidence_over_status_claims: true,
      prefer_continue_safe_work_when_partially_blocked: true,
    },
    default_decision_preferences: {
      prefer_reversible_changes: true,
      prefer_local_over_cloud: true,
      prefer_existing_dependencies: true,
      prefer_fail_closed: true,
      prefer_small_scoped_refactors: true,
      prefer_draft_pr_over_direct_merge: true,
      prefer_evidence_over_status_claims: true,
      prefer_continue_safe_work_when_partially_blocked: true,
    },
    _bootstrap: {
      request_digest: `sha256:${hash(userMessage)}`,
      request_length: String(userMessage).length,
      session_id: sessionId,
      message_id: messageId,
      target_root: targetRoot,
    },
  }
}

function stripIntentMetadata(intent) {
  const result = { ...intent }
  delete result._bootstrap
  return result
}

function compileTaskCapsule({ targetRoot, sessionId, messageId, userMessage, intent, policy }) {
  const baseline = gitBaseline(targetRoot)
  const identity = hash(`${intent.intent_id}\0${baseline.base_sha}\0${sessionId}\0${messageId}`)
  const excerpt = redactPrompt(userMessage) || "Owner-requested task"
  const ceiling = policy.bootstrap_ceiling
  return {
    task_id: `task-${identity.slice(0, 32)}`,
    owner_intent_id: intent.intent_id,
    goal: excerpt,
    why: "Bounded execution context compiled from the direct owner request.",
    risk_tier: classifyRisk(userMessage),
    execution_profile: classifyRisk(userMessage) === "HIGH_HUMAN_GATE" ? "CRITICAL" : "STANDARD",
    source_of_truth: ["DIRECT_OWNER_REQUEST", "SYSTEM_POLICY", "BOOTSTRAP_CEILING", "GIT_BASELINE"],
    baseline,
    read_scope: [...ceiling.read_scope],
    write_scope: [...ceiling.write_scope],
    external_effect_scope: [...ceiling.external_effect_scope],
    forbidden_scope: [...ceiling.forbidden_scope],
    allowed_effects: [...ceiling.allowed_effects],
    acceptance_criteria: ["Owner-requested local work is completed within scope.", "Relevant tests or verification are executed."],
    evidence_required: ["task-bootstrap-events", "action-audit", "relevant-test-output", "diff"],
    approval_budget: {
      target_owner_interruptions: 0,
      maximum_owner_interruptions: 1,
      allow_serial_approvals: false,
      bundling_required: true,
    },
    active_approval_receipts: [],
    active_change_leases: [],
    stop_conditions: [
      "Secret access requested",
      "Path outside target root",
      "Forbidden or immutable governance scope requested",
      "External effect without an existing valid approval or lease",
    ],
    required_fields_present: true,
  }
}

async function ensureDirectories(targetRoot) {
  for (const segments of [[".agent-governance"], [".agent-governance", "state"], [".agent-governance", "evidence"]]) {
    const destination = exactPath(targetRoot, segments)
    await fsp.mkdir(destination, { recursive: true })
  }
}

async function writeAtomic(destination, bytes) {
  const temporary = `${destination}.task-bootstrap-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`
  await fsp.writeFile(temporary, bytes, { flag: "wx" })
  try { await fsp.rename(temporary, destination) } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {})
  }
}

async function writeState(targetRoot, state, extra = {}) {
  const destination = exactPath(targetRoot, CONTEXT_FILES.state)
  await ensureDirectories(targetRoot)
  await writeAtomic(destination, jsonBytes({ schema_version: "governance-v2.task-bootstrap-state.1", state, bootstrap_attempted: state !== "COLD_READ_ONLY", updated_at: new Date().toISOString(), ...extra }))
}

async function appendEvent(targetRoot, event, extra = {}) {
  if (!OBSERVABILITY_EVENTS.includes(event)) throw new Error("RED_BLOCK_BOOTSTRAP_EVENT_INVALID")
  const destination = exactPath(targetRoot, CONTEXT_FILES.events)
  await ensureDirectories(targetRoot)
  const value = { event, timestamp: new Date().toISOString(), ...extra }
  await fsp.appendFile(destination, `${JSON.stringify(value)}\n`, "utf8")
}

async function readState(targetRoot) {
  const value = readJsonFile(targetRoot, CONTEXT_FILES.state, false)
  if (!value) return { state: "COLD_READ_ONLY", bootstrap_attempted: false }
  if (!BOOTSTRAP_STATES.includes(value.state)) throw new Error("RED_BLOCK_BOOTSTRAP_STATE_INVALID")
  return value
}

export async function readTaskContext(targetRoot) {
  const root = normalizeTargetRoot(targetRoot)
  let metadata
  try { metadata = readJsonFile(root, CONTEXT_FILES.metadata) } catch { return null }
  if (metadata.target_root !== root || typeof metadata.intent_sha256 !== "string" || typeof metadata.capsule_sha256 !== "string") return null
  let intent
  let capsule
  try {
    intent = readJsonFile(root, CONTEXT_FILES.intent)
    capsule = readJsonFile(root, CONTEXT_FILES.capsule)
  } catch { return null }
  const intentBytes = await fsp.readFile(exactPath(root, CONTEXT_FILES.intent))
  const capsuleBytes = await fsp.readFile(exactPath(root, CONTEXT_FILES.capsule))
  if (sha256Bytes(intentBytes) !== metadata.intent_sha256 || sha256Bytes(capsuleBytes) !== metadata.capsule_sha256) return null
  if (metadata.owner_intent_id !== intent.intent_id || metadata.task_id !== capsule.task_id || capsule.owner_intent_id !== intent.intent_id) return null
  try {
    validateOwnerIntent(intent)
    validateTaskCapsule(capsule, intent, loadPolicy(root))
  } catch { return null }
  return { intent, capsule, metadata }
}

async function persistContext({ targetRoot, intent, capsule, metadata }) {
  const root = normalizeTargetRoot(targetRoot)
  await ensureDirectories(root)
  validateOwnerIntent(intent)
  validateTaskCapsule(capsule, intent, loadPolicy(root))
  const intentPath = exactPath(root, CONTEXT_FILES.intent)
  const capsulePath = exactPath(root, CONTEXT_FILES.capsule)
  const metadataPath = exactPath(root, CONTEXT_FILES.metadata)
  const intentBytes = jsonBytes(intent)
  const capsuleBytes = jsonBytes(capsule)
  const metadataBytes = jsonBytes({
    schema_version: "governance-v2.task-context.1",
    target_root: root,
    owner_intent_id: intent.intent_id,
    task_id: capsule.task_id,
    intent_sha256: sha256Bytes(intentBytes),
    capsule_sha256: sha256Bytes(capsuleBytes),
    ...metadata,
  })
  const intentTemporary = `${intentPath}.task-bootstrap-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`
  const capsuleTemporary = `${capsulePath}.task-bootstrap-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`
  const metadataTemporary = `${metadataPath}.task-bootstrap-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`
  await Promise.all([
    fsp.writeFile(intentTemporary, intentBytes, { flag: "wx" }),
    fsp.writeFile(capsuleTemporary, capsuleBytes, { flag: "wx" }),
    fsp.writeFile(metadataTemporary, metadataBytes, { flag: "wx" }),
  ])
  try {
    await fsp.rename(intentTemporary, intentPath)
    await fsp.rename(capsuleTemporary, capsulePath)
    await fsp.rename(metadataTemporary, metadataPath)
  } finally {
    await Promise.all([intentTemporary, capsuleTemporary, metadataTemporary].map((file) => fsp.rm(file, { force: true }).catch(() => {})))
  }
  return JSON.parse(metadataBytes.toString("utf8"))
}

async function acquireLock(targetRoot) {
  const root = normalizeTargetRoot(targetRoot)
  if (inProcessLocks.has(root)) return null
  inProcessLocks.set(root, true)
  return () => inProcessLocks.delete(root)
}

export async function bootstrapTask({ targetRoot, sessionId, messageId, userMessage }) {
  const root = normalizeTargetRoot(targetRoot)
  if (typeof sessionId !== "string" || !sessionId || typeof messageId !== "string" || !messageId || typeof userMessage !== "string" || !userMessage.trim()) {
    await writeState(root, "TASK_BLOCKED", { reason_code: "RED_BLOCK_OWNER_REQUEST_MISSING" })
    await appendEvent(root, "TASK_BOOTSTRAP_BLOCKED", { reason_code: "RED_BLOCK_OWNER_REQUEST_MISSING" })
    return { state: "TASK_BLOCKED", code: "RED_BLOCK_OWNER_REQUEST_MISSING" }
  }
  const release = await acquireLock(root)
  if (!release) {
    const existing = await readTaskContext(root)
    if (existing?.metadata?.message_id === messageId) return { state: "TASK_READY", task_id: existing.capsule.task_id, idempotent: true }
    return { state: "TASK_BLOCKED", code: "RED_BLOCK_TASK_BOOTSTRAP_CONCURRENT" }
  }
  try {
    const existing = await readTaskContext(root)
    if (existing?.metadata?.message_id === messageId && existing?.metadata?.session_id === sessionId) {
      await writeState(root, "TASK_READY", { task_id: existing.capsule.task_id, owner_intent_id: existing.intent.intent_id, message_id: messageId, session_id: sessionId })
      return { state: "TASK_READY", task_id: existing.capsule.task_id, idempotent: true }
    }
    const policy = loadPolicy(root)
    await writeState(root, "TASK_BOOTSTRAPPING", { session_id: sessionId, message_id: messageId })
    await appendEvent(root, "TASK_BOOTSTRAP_STARTED", { session_id: sessionId, message_id: messageId })
    const compiledIntentWithMetadata = compileOwnerIntent({ targetRoot: root, sessionId, messageId, userMessage })
    const compiledIntent = stripIntentMetadata(compiledIntentWithMetadata)
    await appendEvent(root, "OWNER_INTENT_COMPILED", { intent_id: compiledIntent.intent_id })
    validateOwnerIntent(compiledIntent)
    await appendEvent(root, "OWNER_INTENT_VALIDATED", { intent_id: compiledIntent.intent_id })
    const capsule = compileTaskCapsule({ targetRoot: root, sessionId, messageId, userMessage, intent: compiledIntent, policy })
    await appendEvent(root, "TASK_CAPSULE_COMPILED", { task_id: capsule.task_id })
    validateTaskCapsule(capsule, compiledIntent, policy)
    await appendEvent(root, "TASK_CAPSULE_VALIDATED", { task_id: capsule.task_id })
    const metadata = await persistContext({
      targetRoot: root,
      intent: compiledIntent,
      capsule,
      metadata: {
        session_id: sessionId,
        message_id: messageId,
        request_digest: `sha256:${hash(userMessage)}`,
        request_length: String(userMessage).length,
        bootstrap_ceiling_version: policy.version,
      },
    })
    await appendEvent(root, "TASK_CONTEXT_PERSISTED", { task_id: capsule.task_id, owner_intent_id: compiledIntent.intent_id })
    await writeState(root, "TASK_READY", { task_id: capsule.task_id, owner_intent_id: compiledIntent.intent_id, session_id: sessionId, message_id: messageId })
    await appendEvent(root, "TASK_READY", { task_id: capsule.task_id })
    return { state: "TASK_READY", task_id: capsule.task_id, owner_intent_id: compiledIntent.intent_id, metadata }
  } catch (error) {
    const code = safeErrorCode(error)
    await writeState(root, "TASK_BLOCKED", { reason_code: code, session_id: sessionId, message_id: messageId })
    await appendEvent(root, "TASK_BOOTSTRAP_BLOCKED", { reason_code: code, session_id: sessionId, message_id: messageId })
    return { state: "TASK_BLOCKED", code }
  } finally {
    release()
  }
}

export async function reconcileTaskScope({ targetRoot, additionalWriteScope = [] }) {
  const root = normalizeTargetRoot(targetRoot)
  const context = await readTaskContext(root)
  if (!context) return { state: "TASK_BLOCKED", code: "RED_BLOCK_TASK_CONTEXT_INVALID" }
  const policy = loadPolicy(root)
  if (!Array.isArray(additionalWriteScope) || additionalWriteScope.length === 0 || additionalWriteScope.some((entry) => typeof entry !== "string" || path.isAbsolute(entry) || entry.includes(".."))) {
    return { state: "TASK_BLOCKED", code: "RED_BLOCK_RECONCILIATION_SCOPE_INVALID" }
  }
  if (additionalWriteScope.some((entry) => matchesScope(entry, policy.bootstrap_ceiling.forbidden_scope) || matchesScope(entry, context.capsule.forbidden_scope))) {
    return { state: "TASK_BLOCKED", code: "RED_BLOCK_RECONCILIATION_FORBIDDEN_SCOPE" }
  }
  const capsule = { ...context.capsule, write_scope: [...new Set([...context.capsule.write_scope, ...additionalWriteScope])] }
  validateTaskCapsule(capsule, context.intent, policy)
  const metadata = await persistContext({ targetRoot: root, intent: context.intent, capsule, metadata: { ...context.metadata, reconciled_at: new Date().toISOString() } })
  await appendEvent(root, "TASK_CAPSULE_RECONCILED", { task_id: capsule.task_id, added_scope_count: additionalWriteScope.length })
  return { state: "TASK_READY", task_id: capsule.task_id, metadata }
}

export async function validateBootstrapRuntime({ targetRoot } = {}) {
  const root = normalizeTargetRoot(targetRoot)
  const policy = loadPolicy(root)
  for (const segments of [CONTEXT_FILES.intentSchema, CONTEXT_FILES.capsuleSchema, CONTEXT_FILES.policySchema, CONTEXT_FILES.runtime]) {
    const filePath = exactPath(root, segments)
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size === 0) throw new Error("RED_BLOCK_TASK_BOOTSTRAP_RUNTIME_MISSING")
  }
  const intentSchema = readJsonFile(root, CONTEXT_FILES.intentSchema)
  const capsuleSchema = readJsonFile(root, CONTEXT_FILES.capsuleSchema)
  const policySchema = readJsonFile(root, CONTEXT_FILES.policySchema)
  if (intentSchema.$id !== "https://opencode-agent-ecosystem.local/governance/owner-intent.schema.json" || capsuleSchema.$id !== "https://opencode-agent-ecosystem.local/governance/task-capsule.schema.json" || policySchema.$id !== "https://opencode-agent-ecosystem.local/governance/task-bootstrap-policy.schema.json") throw new Error("RED_BLOCK_BOOTSTRAP_SCHEMA_INVALID")
  return { task_bootstrap_runtime: "PRESENT", task_bootstrap_policy: "VALID", task_context_writer: "VALID", policy_version: policy.version }
}

export async function selfTestBootstrapRuntime({ targetRoot } = {}) {
  const result = await validateBootstrapRuntime({ targetRoot })
  const root = normalizeTargetRoot(targetRoot)
  const sampleIntent = compileOwnerIntent({ targetRoot: root, sessionId: "self-test", messageId: "self-test", userMessage: "self-test" })
  const intent = stripIntentMetadata(sampleIntent)
  validateOwnerIntent(intent)
  const capsule = compileTaskCapsule({ targetRoot: root, sessionId: "self-test", messageId: "self-test", userMessage: "self-test", intent, policy: loadPolicy(root) })
  validateTaskCapsule(capsule, intent, loadPolicy(root))
  return { ...result, bootstrap_self_test: "PASS" }
}

export function contextFilePaths(targetRoot) {
  const root = normalizeTargetRoot(targetRoot)
  return Object.fromEntries(Object.entries(CONTEXT_FILES).map(([key, segments]) => [key, exactPath(root, segments)]))
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : null }
  const targetRoot = arg("--target")
  if (!targetRoot) throw new Error("RED_BLOCK_TARGET_ROOT_UNCLEAR")
  if (argv.includes("--self-test")) {
    console.log(JSON.stringify(await selfTestBootstrapRuntime({ targetRoot })))
    return
  }
  const encoded = arg("--message-b64")
  const userMessage = encoded ? Buffer.from(encoded, "base64url").toString("utf8") : ""
  const result = await bootstrapTask({ targetRoot, sessionId: arg("--session-id") || "", messageId: arg("--message-id") || "", userMessage })
  console.log(JSON.stringify({ state: result.state, task_id: result.task_id || null, owner_intent_id: result.owner_intent_id || null, code: result.code || null, idempotent: result.idempotent || false }))
  process.exitCode = result.state === "TASK_READY" ? 0 : 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { console.error(safeErrorCode(error)); process.exitCode = 2 })

export { compileOwnerIntent, compileTaskCapsule, validateOwnerIntent, validateTaskCapsule, normalizeTargetRoot }
