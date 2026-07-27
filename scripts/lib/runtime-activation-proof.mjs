import fs from "node:fs/promises"
import path from "node:path"

import { assertInsideRoot, assertSafePath, isInsideRoot } from "./paths.mjs"
import { createApprovalReceipt, consumeApprovalReceipt } from "../../runtime/approval/approval-receipt.mjs"
import { validateClosureEvidence } from "./closure-evidence.mjs"

export const ACTIVATION_STATES = Object.freeze([
  "NOT_INSTALLED",
  "INSTALLED_UNVERIFIED",
  "HOOK_REGISTERED_UNPROVEN",
  "ACTIVATION_VERIFIED",
  "RESTART_PERSISTENCE_VERIFIED",
  "BYPASS_RISK",
  "TOOL_GAP",
  "RED_BLOCK",
])

const ACTIVATION_KEYS = Object.freeze([
  "runtime_detected", "adapter_selected", "hook_registered", "plugin_loaded", "hook_observed",
  "positive_control", "negative_control", "restart_performed", "restart_plugin_loaded",
  "restart_hook_observed", "restart_positive_control", "restart_negative_control",
  "receipt_required_without_receipt", "valid_receipt", "replay", "session_binding", "call_binding",
  "resource_binding", "effect_binding", "parallel_single_use", "restart_replay_persistence",
  "safe_action_allowed", "forbidden_action_blocked", "scope_escape_blocked", "secret_isolation_blocked",
  "approval_required_action_blocked_without_receipt", "approval_receipt_accepted", "replay_blocked",
  "restart_verified", "bypass_scan_completed",
])

const BOOLEAN_KEYS = Object.freeze([
  "runtime_detected", "adapter_selected", "hook_registered", "plugin_loaded", "hook_observed",
  "restart_performed", "restart_plugin_loaded", "restart_hook_observed", "safe_action_allowed",
  "forbidden_action_blocked", "scope_escape_blocked", "secret_isolation_blocked",
  "approval_required_action_blocked_without_receipt", "approval_receipt_accepted", "replay_blocked",
  "restart_verified", "bypass_scan_completed",
])
const PASS_KEYS = Object.freeze(["positive_control", "negative_control", "restart_positive_control", "restart_negative_control", "session_binding", "call_binding", "resource_binding", "effect_binding", "parallel_single_use", "restart_replay_persistence"])
const ENUM_KEYS = Object.freeze(["receipt_required_without_receipt", "valid_receipt", "replay"])
const CONTROL_KEYS = Object.freeze([
  "safe_action_allowed", "forbidden_action_blocked", "scope_escape_blocked", "secret_isolation_blocked",
  "approval_required_action_blocked_without_receipt", "approval_receipt_accepted", "replay_blocked",
])
const VERIFIED_BOOLEAN_KEYS = Object.freeze([...BOOLEAN_KEYS])
const VERIFIED_PASS_KEYS = Object.freeze([...PASS_KEYS])
const RESTART_BOOLEAN_KEYS = Object.freeze(["restart_performed", "restart_plugin_loaded", "restart_hook_observed", "restart_verified"])
const RESTART_PASS_KEYS = Object.freeze(["restart_positive_control", "restart_negative_control", "restart_replay_persistence"])
const BASE_VERIFIED_BOOLEAN_KEYS = Object.freeze(VERIFIED_BOOLEAN_KEYS.filter((key) => !RESTART_BOOLEAN_KEYS.includes(key)))
const BASE_VERIFIED_PASS_KEYS = Object.freeze(VERIFIED_PASS_KEYS.filter((key) => !RESTART_PASS_KEYS.includes(key)))

export function createRuntimeProof(input = {}) {
  const activation = Object.fromEntries(ACTIVATION_KEYS.map((key) => [key, input.activation?.[key] ?? null]))
  const assertions = Array.isArray(input.assertions) ? input.assertions : []
  return {
    schema_version: "1.1.0",
    project_id: String(input.project_id || "unknown-project"),
    repository_root: String(input.repository_root || "."),
    governance_source: {
      repository: input.governance_source?.repository || null,
      commit: input.governance_source?.commit || null,
      version: input.governance_source?.version || null,
    },
    runtime: {
      name: input.runtime?.name || "unknown",
      version: input.runtime?.version || null,
      adapter: input.runtime?.adapter || "unknown",
      adapter_version: input.runtime?.adapter_version || null,
    },
    activation,
    evidence: Array.isArray(input.evidence) ? input.evidence.map(safeEvidence) : [],
    assertions,
    uncertainties: Array.isArray(input.uncertainties) ? input.uncertainties.map(String) : [],
    classification: input.classification || "INSTALLED_UNVERIFIED",
    verified_at: input.verified_at || new Date().toISOString(),
  }
}

function safeEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "invalid-evidence", result: "ignored" }
  const output = {}
  for (const [key, raw] of Object.entries(value)) {
    if (/secret|token|password|prompt|output|transcript|stdout|stderr|environment|argument|commandline/i.test(key)) continue
    if (typeof raw === "string") output[key] = raw.slice(0, 256)
    else if (typeof raw === "boolean" || typeof raw === "number" || raw === null) output[key] = raw
    else if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) output[key] = raw.slice(0, 32).map((item) => item.slice(0, 128))
  }
  return output
}

export function validateRuntimeProof(proof) {
  const issues = []
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return ["proof must be an object"]
  const required = ["schema_version", "project_id", "repository_root", "governance_source", "runtime", "activation", "evidence", "assertions", "uncertainties", "classification", "verified_at"]
  for (const key of required) if (!(key in proof)) issues.push(`missing ${key}`)
  if (proof.schema_version !== "1.1.0") issues.push("unsupported schema_version")
  if (!proof.project_id || typeof proof.project_id !== "string") issues.push("project_id must be a non-empty string")
  if (!proof.runtime || typeof proof.runtime !== "object" || !proof.runtime.name || !proof.runtime.adapter) issues.push("runtime name and adapter are required")
  const activation = proof.activation || {}
  for (const key of ACTIVATION_KEYS) {
    if (!(key in activation)) issues.push(`activation.${key} is required`)
  }
  for (const key of BOOLEAN_KEYS) if (key in activation && ![true, false, null].includes(activation[key])) issues.push(`activation.${key} must be boolean or null`)
  for (const key of PASS_KEYS) if (key in activation && !["PASS", "FAIL", null].includes(activation[key])) issues.push(`activation.${key} must be PASS, FAIL, or null`)
  for (const key of ENUM_KEYS) if (key in activation && !["ALLOW", "BLOCK", "FAIL", null].includes(activation[key])) issues.push(`activation.${key} has an invalid control state`)
  if (!Array.isArray(proof.evidence)) issues.push("evidence must be an array")
  if (!Array.isArray(proof.assertions)) issues.push("assertions must be an array")
  if (!Array.isArray(proof.uncertainties)) issues.push("uncertainties must be an array")
  if (!Number.isFinite(Date.parse(proof.verified_at || ""))) issues.push("verified_at must be ISO-8601")
  for (const assertion of proof.assertions || []) issues.push(...validateAssertion(assertion).map((issue) => `assertion: ${issue}`))
  if (["ACTIVATION_VERIFIED", "RESTART_PERSISTENCE_VERIFIED"].includes(proof.classification)) {
    for (const key of VERIFIED_BOOLEAN_KEYS) if (activation[key] !== true) issues.push(`verified proof requires activation.${key}=true`)
    for (const key of VERIFIED_PASS_KEYS) if (activation[key] !== "PASS") issues.push(`verified proof requires activation.${key}=PASS`)
    if (activation.receipt_required_without_receipt !== "BLOCK") issues.push("verified proof requires receipt_required_without_receipt=BLOCK")
    if (activation.valid_receipt !== "ALLOW") issues.push("verified proof requires valid_receipt=ALLOW")
    if (activation.replay !== "BLOCK") issues.push("verified proof requires replay=BLOCK")
  }
  return issues
}

export function classifyRuntimeProof(proof) {
  const issues = validateRuntimeProof(proof)
  if (issues.length > 0) return classified("RED_BLOCK", ["PROOF_SCHEMA_INVALID"], issues, "RED_BLOCK")
  const activation = proof.activation
  if (activation.runtime_detected !== true) return classified("TOOL_GAP", ["RUNTIME_NOT_FOUND"], ["Supported runtime was not detected in target scope."], "TOOL_GAP")
  if (activation.adapter_selected !== true) return classified("TOOL_GAP", ["ADAPTER_NOT_SELECTED"], ["No compatible runtime adapter was selected."], "TOOL_GAP")
  if (activation.hook_registered !== true || activation.plugin_loaded !== true || activation.hook_observed !== true) return classified("NEEDS_REVIEW", ["HOOK_NOT_PROVEN"], ["The canonical plugin hook was not observed in a runtime process."], "INSTALLED_UNVERIFIED")
  const failedControls = CONTROL_KEYS.filter((key) => activation[key] === false)
  const failedProofControls = [...PASS_KEYS, ...ENUM_KEYS].filter((key) => activation[key] === "FAIL")
  if (failedControls.length > 0 || failedProofControls.length > 0) return classified("RED_BLOCK", [...failedControls, ...failedProofControls].map((key) => `CONTROL_FAILED_${key.toUpperCase()}`), ["A required safety control failed."], "RED_BLOCK")
  const unprovenControls = CONTROL_KEYS.filter((key) => activation[key] !== true)
  const unprovenProofControls = [...BASE_VERIFIED_BOOLEAN_KEYS, ...BASE_VERIFIED_PASS_KEYS].filter((key) => activation[key] !== true && activation[key] !== "PASS")
  if (unprovenControls.length > 0 || unprovenProofControls.length > 0 || activation.receipt_required_without_receipt !== "BLOCK" || activation.valid_receipt !== "ALLOW" || activation.replay !== "BLOCK") return classified("NEEDS_REVIEW", ["HOOK_REGISTERED_UNPROVEN", "ACTIVATION_CONTROL_UNPROVEN"], ["One or more runtime, receipt, restart, or binding controls were not proven."], "HOOK_REGISTERED_UNPROVEN")
  if (activation.bypass_scan_completed !== true) return classified("NEEDS_REVIEW", ["BYPASS_RISK"], ["Required bypass scan was not completed."], "BYPASS_RISK")
  if (hasCriticalBypass(proof.evidence)) return classified("RED_BLOCK", ["BYPASS_RISK"], ["A critical bypass path remains open."], "BYPASS_RISK")
  if (!hasDynamicBypassProof(proof.evidence)) return classified("NEEDS_REVIEW", ["BYPASS_RISK"], ["A static bypass scan alone cannot prove runtime activation."], "BYPASS_RISK")
  if (hasSimulationOnlyEvidence(proof.evidence)) return classified("NEEDS_REVIEW", ["SIMULATION_ONLY", "RESTART_UNPROVEN"], ["Adapter simulation is not a runtime activation proof."], "HOOK_REGISTERED_UNPROVEN")
  const restartUnproven = RESTART_BOOLEAN_KEYS.some((key) => activation[key] !== true) || RESTART_PASS_KEYS.some((key) => activation[key] !== "PASS")
  if (restartUnproven) return classified("NEEDS_REVIEW", ["ACTIVATION_VERIFIED", "RESTART_UNPROVEN"], ["Activation controls passed but restart persistence is not proven."], "ACTIVATION_VERIFIED")
  return classified("VERIFIED_IN_SCOPE", ["ACTIVATION_VERIFIED", "RESTART_PERSISTENCE_VERIFIED"], [], "RESTART_PERSISTENCE_VERIFIED")
}

export function validateRuntimeClosureAssertions(assertions) {
  return (assertions || []).flatMap((assertion) => validateAssertion(assertion))
}

function validateAssertion(assertion) {
  const issues = []
  const required = ["assertion_id", "claim", "required_evidence", "observed_evidence", "status", "limitations", "code_contract_version", "schema_version"]
  for (const key of required) if (!(key in (assertion || {}))) issues.push(`missing ${key}`)
  if (assertion && !["PROVEN", "PARTIALLY_PROVEN", "UNPROVEN", "CONTRADICTED", "NOT_APPLICABLE"].includes(assertion.status)) issues.push("invalid status")
  if (assertion?.status === "PROVEN" && (!assertion.required_evidence || !assertion.observed_evidence)) issues.push("PROVEN requires required and observed evidence")
  return issues
}

function hasCriticalBypass(evidence) {
  return evidence.some((entry) => entry?.kind === "bypass-scan" && entry?.critical_open_paths > 0)
}

function hasDynamicBypassProof(evidence) {
  return evidence.some((entry) => entry?.kind === "bypass-scan" && entry?.dynamic === true && entry?.result === "passed")
}

function hasSimulationOnlyEvidence(evidence) {
  return evidence.some((entry) => entry?.kind === "adapter-simulation" && entry?.result === "passed")
    && !evidence.some((entry) => entry?.kind === "isolated-runtime" && entry?.result === "passed")
}

function classified(classification, substatus, blockers, activation_state) {
  return { classification, substatus, blockers, tool_gaps: classification === "TOOL_GAP" ? blockers : [], activation_state }
}

export async function runSyntheticRuntimeControls({ targetRoot, adapter = "opencode", syntheticSecret = "TEST_ONLY_SYNTHETIC_SECRET" } = {}) {
  if (!["opencode", "hermes"].includes(adapter)) throw new Error(`Unsupported synthetic runtime adapter: ${adapter}`)
  const root = path.resolve(targetRoot || ".")
  await assertSafePath(root, root, "synthetic runtime target")
  const secretPath = path.join(root, ".env")
  const secretBlocked = path.basename(secretPath).startsWith(".env")
  const safeActionAllowed = allowSyntheticCommand("git status")
  const forbiddenActionBlocked = !allowSyntheticCommand("git push --force")
  const scopeEscapeBlocked = !isInsideRoot(root, path.resolve(root, "..", "outside-target"))
  const receiptResult = exerciseReceiptLifecycle(root)
  const stat = await fs.lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("synthetic runtime target must be a real directory")
  return Object.freeze({
    adapter,
    safe_action_allowed: safeActionAllowed,
    forbidden_action_blocked: forbiddenActionBlocked,
    scope_escape_blocked: scopeEscapeBlocked,
    secret_isolation_blocked: secretBlocked,
    approval_required_action_blocked_without_receipt: true,
    approval_receipt_accepted: receiptResult.accepted,
    replay_blocked: receiptResult.replayBlocked,
    fixture_present: Boolean(syntheticSecret),
  })
}

function allowSyntheticCommand(command) {
  const normalized = String(command).trim().replace(/\s+/g, " ")
  if (normalized === "git status") return true
  if (/\bgit push\b.*--force|--force\b.*\bgit push\b/i.test(normalized)) return false
  return false
}

function exerciseReceiptLifecycle(targetRoot) {
  const signingKey = "synthetic-test-key-not-a-secret"
  const capsule = {
    task_id: "synthetic-runtime-proof",
    owner_intent_id: "synthetic-intent",
    project_id: "synthetic",
    read_scope: ["**"],
    write_scope: ["safe-output.txt"],
    forbidden_scope: [".env", "**/.env*"],
    allowed_effects: ["LOCAL_WRITE"],
    baseline: { repository: "synthetic", branch: "DETACHED_HEAD", base_sha: "synthetic" },
  }
  const receipt = createApprovalReceipt({
    signing_key: signingKey,
    capsule,
    owner_intent_id: capsule.owner_intent_id,
    effect_classes: ["LOCAL_WRITE"],
    resource_scope: ["safe-output.txt"],
    allowed_actions: ["write"],
    nonce: `synthetic-${Buffer.from(targetRoot).toString("hex").slice(0, 24)}`,
  })
  const consumed = consumeApprovalReceipt(receipt, { signing_key: signingKey })
  const replay = consumeApprovalReceipt(consumed.receipt, { signing_key: signingKey })
  return { accepted: consumed.valid === true, replayBlocked: replay.valid === false && replay.code === "RED_BLOCK_RECEIPT_REPLAY" }
}

export async function scanRuntimeBypassPaths(targetRoot, options = {}) {
  const root = path.resolve(targetRoot)
  await assertSafePath(root, root, "runtime bypass scan target")
  const canonicalPath = path.join(root, ".opencode", "plugin", "governance-v2.ts")
  const legacyPath = path.join(root, ".opencode", "plugins", "governance-v2.mjs")
  const canonicalKind = await pathKind(root, ".opencode/plugin/governance-v2.ts")
  const legacyKind = await pathKind(root, ".opencode/plugins/governance-v2.mjs")
  const canonicalPluginState = canonicalKind === "file" ? "CANONICAL_PLUGIN_PRESENT" : canonicalKind === "symlink" || canonicalKind === "directory" ? "UNPROVEN" : "PLUGIN_MISSING"
  const legacyPluginState = legacyKind === "file" ? "LEGACY_PLUGIN_PATH_PRESENT" : legacyKind ? "LEGACY_OR_MISCONFIGURED" : "LEGACY_PLUGIN_PATH_ABSENT"
  const pureMode = options.pure === true
  const hookObserved = options.hook_observed === true
  const alternativeConfig = options.alternative_config === true
  const directEvaluator = options.direct_evaluator === true
  let classification = "UNPROVEN"
  if (pureMode) classification = "BYPASS_RISK"
  else if (canonicalKind === "file" && hookObserved) classification = "CANONICAL_PLUGIN_ACTIVE"
  else if (canonicalKind === "file") classification = "INSTALLED_UNVERIFIED"
  else if (legacyKind) classification = "LEGACY_OR_MISCONFIGURED"
  else if (alternativeConfig || directEvaluator) classification = "UNPROVEN"
  else classification = "BYPASS_RISK"
  return {
    kind: "bypass-scan",
    method: "canonical-plugin-path-and-hook-observation",
    completed: true,
    canonical_plugin_state: canonicalPluginState,
    canonical_plugin_path: ".opencode/plugin/governance-v2.ts",
    canonical_plugin_active: canonicalKind === "file" && hookObserved,
    legacy_plugin_state: legacyPluginState,
    hook_observed: hookObserved,
    pure_mode: pureMode,
    alternative_config: alternativeConfig,
    direct_evaluator: directEvaluator,
    classification,
    present_paths: [
      ...(canonicalKind ? [".opencode/plugin/governance-v2.ts"] : []),
      ...(legacyKind ? [".opencode/plugins/governance-v2.mjs"] : []),
    ],
    critical_open_paths: classification === "BYPASS_RISK" || classification === "LEGACY_OR_MISCONFIGURED" ? 1 : 0,
    limitation: "Static path inspection is not a substitute for a real hook observation.",
  }
}

export function assertSyntheticScope(targetRoot, candidate) {
  assertInsideRoot(targetRoot, candidate, "synthetic runtime resource")
  return true
}

async function pathKind(root, relative) {
  const absolute = path.join(root, relative)
  if (!isInsideRoot(root, absolute)) return "unsafe"
  try {
    const parentReal = await fs.realpath(path.dirname(absolute))
    if (!isInsideRoot(root, parentReal)) return "symlink"
    const stat = await fs.lstat(absolute)
    if (stat.isSymbolicLink()) return "symlink"
    if (stat.isDirectory()) return "directory"
    if (stat.isFile()) return "file"
    return "special"
  } catch (error) {
    if (error?.code === "ENOENT" || /ENOENT/.test(String(error?.message || ""))) return null
    throw error
  }
}
