import {
  createUserActionHandoff,
  validateUserActionHandoff,
} from "./user-action-handoff.mjs"

const SCHEMA_VERSION = "ocae-closure-evidence.1"
const TYPES = new Set(["runtime-proof", "restart-proof", "receipt-proof", "parallelism-proof", "profile-incident-assessment", "test-summary", "final-status"])
const STATUSES = new Set(["PROVEN", "PARTIALLY_PROVEN", "UNPROVEN", "CONTRADICTED", "NOT_APPLICABLE"])
const COMMON = new Set(["schema_version", "evidence_type", "run_id", "timestamp", "repository_commit", "runtime_name", "runtime_version", "scope", "assertions", "limitations", "classification", "generated_by", "plugin_loaded", "hook_observed", "positive_control", "negative_control", "restart_performed", "receipt_binding", "parallel_single_use", "incident_status", "tests", "findings", "user_action_handoff"])

export function createClosureEvidence(input = {}) {
  const evidence = {
    schema_version: SCHEMA_VERSION,
    evidence_type: input.evidence_type,
    run_id: String(input.run_id || "unknown-run"),
    timestamp: input.timestamp || new Date().toISOString(),
    repository_commit: String(input.repository_commit || "unknown-commit"),
    runtime_name: String(input.runtime_name || "unknown"),
    runtime_version: input.runtime_version ?? null,
    scope: { kind: String(input.scope?.kind || "synthetic"), target: input.scope?.target ?? null },
    assertions: Array.isArray(input.assertions) ? input.assertions.map(normalizeAssertion) : [],
    limitations: Array.isArray(input.limitations) ? input.limitations.map((value) => String(value).slice(0, 512)) : [],
    classification: input.classification || "UNPROVEN",
    generated_by: String(input.generated_by || "ocae-security-closure"),
  }
  for (const key of ["plugin_loaded", "hook_observed", "positive_control", "negative_control", "restart_performed", "receipt_binding", "parallel_single_use", "incident_status", "tests", "findings"]) {
    if (key in input) evidence[key] = input[key]
  }
  if (input.evidence_type === "final-status") {
    if (Object.hasOwn(input, "user_action_handoff")) {
      const handoffIssues = validateUserActionHandoff(input.user_action_handoff)
      if (handoffIssues.length > 0) {
        throw new Error(`Invalid user_action_handoff: ${handoffIssues.map((entry) => entry.code).join(", ")}`)
      }
      evidence.user_action_handoff = createUserActionHandoff(input.user_action_handoff.actions)
    } else {
      evidence.user_action_handoff = createUserActionHandoff([])
    }
  }
  return evidence
}

export function validateClosureEvidence(evidence) {
  const issues = []
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return ["evidence must be an object"]
  for (const key of ["schema_version", "evidence_type", "run_id", "timestamp", "repository_commit", "runtime_name", "runtime_version", "scope", "assertions", "limitations", "classification", "generated_by"]) if (!(key in evidence)) issues.push(`missing ${key}`)
  for (const key of Object.keys(evidence)) if (!COMMON.has(key)) issues.push(`unknown field ${key}`)
  if (evidence.schema_version !== SCHEMA_VERSION) issues.push("unsupported schema_version")
  if (!TYPES.has(evidence.evidence_type)) issues.push("invalid evidence_type")
  if (!evidence.run_id || !evidence.runtime_name || !evidence.generated_by) issues.push("run_id, runtime_name, and generated_by are required")
  if (!Number.isFinite(Date.parse(evidence.timestamp || ""))) issues.push("timestamp must be ISO-8601")
  if (!evidence.scope || typeof evidence.scope !== "object" || Array.isArray(evidence.scope) || typeof evidence.scope.kind !== "string") issues.push("scope.kind is required")
  if (!Array.isArray(evidence.assertions)) issues.push("assertions must be an array")
  if (!Array.isArray(evidence.limitations)) issues.push("limitations must be an array")
  for (const assertion of evidence.assertions || []) issues.push(...validateAssertion(assertion).map((issue) => `assertion: ${issue}`))
  const typeRequirements = {
    "runtime-proof": ["plugin_loaded", "hook_observed", "positive_control", "negative_control"],
    "restart-proof": ["restart_performed"],
    "receipt-proof": ["receipt_binding"],
    "parallelism-proof": ["parallel_single_use"],
    "profile-incident-assessment": ["incident_status"],
    "test-summary": ["tests"],
    "final-status": ["findings", "user_action_handoff"],
  }
  for (const key of typeRequirements[evidence.evidence_type] || []) if (!(key in evidence)) issues.push(`${evidence.evidence_type} requires ${key}`)
  if (evidence.evidence_type === "final-status" && Object.hasOwn(evidence, "user_action_handoff")) {
    issues.push(...validateUserActionHandoff(evidence.user_action_handoff).map((entry) => `user_action_handoff: ${entry.code}`))
  }
  if (evidence.classification === "PROVEN" && !assertionsAreProven(evidence.assertions)) issues.push("PROVEN summary requires every assertion to be PROVEN")
  return issues
}

export function assertionsAreProven(assertions = []) {
  return assertions.length > 0 && assertions.every((assertion) => assertion.status === "PROVEN" && validateAssertion(assertion).length === 0)
}

function normalizeAssertion(assertion = {}) {
  return {
    assertion_id: String(assertion.assertion_id || "unknown-assertion"),
    claim: String(assertion.claim || ""),
    required_evidence: Array.isArray(assertion.required_evidence) ? assertion.required_evidence.map(String) : [],
    observed_evidence: Array.isArray(assertion.observed_evidence) ? assertion.observed_evidence.map(String) : [],
    status: assertion.status || "UNPROVEN",
    limitations: Array.isArray(assertion.limitations) ? assertion.limitations.map((value) => String(value).slice(0, 512)) : [],
    code_contract_version: String(assertion.code_contract_version || "unknown"),
    schema_version: String(assertion.schema_version || SCHEMA_VERSION),
  }
}

function validateAssertion(assertion) {
  const issues = []
  for (const key of ["assertion_id", "claim", "required_evidence", "observed_evidence", "status", "limitations", "code_contract_version", "schema_version"]) if (!(key in (assertion || {}))) issues.push(`missing ${key}`)
  if (assertion && !STATUSES.has(assertion.status)) issues.push("invalid status")
  if (assertion?.status === "PROVEN" && (!Array.isArray(assertion.required_evidence) || assertion.required_evidence.length === 0 || !Array.isArray(assertion.observed_evidence) || assertion.observed_evidence.length === 0)) issues.push("PROVEN requires required and observed evidence")
  return issues
}

export { SCHEMA_VERSION as CLOSURE_EVIDENCE_SCHEMA_VERSION }
