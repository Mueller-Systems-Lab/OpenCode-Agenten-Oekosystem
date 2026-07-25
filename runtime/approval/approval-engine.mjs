// SPDX-License-Identifier: MIT
/**
 * Governance V2 approval compression kernel.
 *
 * This module classifies concrete effects. Workflow phases, tool names, and
 * untrusted text are deliberately not authorization sources.
 */
import fs from 'node:fs'
import path from 'node:path'

export const DECISION_CLASSES = Object.freeze({
  A_AUTONOMOUS: 'A_AUTONOMOUS',
  B_LEASE_OR_RECEIPT: 'B_LEASE_OR_RECEIPT',
  C_BUNDLED_OWNER_DECISION: 'C_BUNDLED_OWNER_DECISION',
  D_TECHNICAL_BLOCK: 'D_TECHNICAL_BLOCK',
})

export const EFFECTS = Object.freeze({
  LOCAL_READ: 'LOCAL_READ',
  LOCAL_WRITE: 'LOCAL_WRITE',
  LOCAL_DELETE: 'LOCAL_DELETE',
  LOCAL_EXECUTE: 'LOCAL_EXECUTE',
  TEST_EXECUTION: 'TEST_EXECUTION',
  LOCAL_COMMIT: 'LOCAL_COMMIT',
  NETWORK: 'NETWORK',
  EXTERNAL_COMMUNICATION: 'EXTERNAL_COMMUNICATION',
  PUSH: 'PUSH',
  DRAFT_PR_UPDATE: 'DRAFT_PR_UPDATE',
  MERGE: 'MERGE',
  PRODUCTION_DEPLOY: 'PRODUCTION_DEPLOY',
  SECRET_ACCESS: 'SECRET_ACCESS',
  IRREVERSIBLE_DELETE: 'IRREVERSIBLE_DELETE',
  DELEGATE: 'DELEGATE',
  APPROVAL_ENGINE_MUTATION: 'APPROVAL_ENGINE_MUTATION',
  CAPABILITY_REGISTRY_MUTATION: 'CAPABILITY_REGISTRY_MUTATION',
})

export const REVERSIBILITY = Object.freeze({
  FULLY_REVERSIBLE: 'FULLY_REVERSIBLE',
  REVERSIBLE_WITH_BACKUP: 'REVERSIBLE_WITH_BACKUP',
  PARTIALLY_REVERSIBLE: 'PARTIALLY_REVERSIBLE',
  IRREVERSIBLE: 'IRREVERSIBLE',
  UNKNOWN_REVERSIBILITY: 'UNKNOWN_REVERSIBILITY',
})

const KNOWN_EFFECTS = new Set(Object.values(EFFECTS))
const TECHNICAL_BLOCK_EFFECTS = new Set([
  EFFECTS.SECRET_ACCESS,
  EFFECTS.APPROVAL_ENGINE_MUTATION,
  EFFECTS.CAPABILITY_REGISTRY_MUTATION,
])
const OWNER_EFFECTS = new Set([
  EFFECTS.EXTERNAL_COMMUNICATION,
  EFFECTS.PUSH,
  EFFECTS.MERGE,
  EFFECTS.PRODUCTION_DEPLOY,
  EFFECTS.IRREVERSIBLE_DELETE,
])
const RISK_ORDER = Object.freeze({ LOW_LOCAL: 1, MEDIUM_REVIEW: 2, HIGH_HUMAN_GATE: 3, CRITICAL_BLOCK: 4 })

function cleanPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '')
}

function globToRegExp(pattern) {
  const value = cleanPath(pattern)
  let source = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '*' && value[index + 1] === '*') {
      source += '.*'
      index += 1
    } else if (value[index] === '*') {
      source += '[^/]*'
    } else {
      source += escapeRegex(value[index])
    }
  }
  return new RegExp(`^${source}$`)
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

export function matchesScope(resource, patterns = []) {
  const value = cleanPath(resource)
  return Array.isArray(patterns) && patterns.some((pattern) => {
    const normalized = cleanPath(pattern)
    if (normalized.endsWith('/**')) {
      const base = normalized.slice(0, -3).replace(/\/$/, '')
      if (value === base || value.startsWith(`${base}/`)) return true
    }
    return globToRegExp(normalized).test(value)
  })
}

function effectAllowed(capsule, effect) {
  return Array.isArray(capsule?.allowed_effects) && capsule.allowed_effects.includes(effect)
}

function authorizationMatches(auth, { effect, resource }) {
  if (!auth || auth.revocation_status === 'REVOKED' || auth.status === 'REVOKED') return false
  if (auth.expires_at && Date.parse(auth.expires_at) <= Date.now()) return false
  const effects = auth.allowed_effects || auth.effect_classes || []
  const paths = auth.allowed_paths || auth.resource_scope || []
  const actions = auth.allowed_actions || []
  const denied = auth.denied_effects || auth.denied_actions || []
  return effects.includes(effect) && !denied.includes(effect) && !denied.includes(effect.toLowerCase()) && (paths.length === 0 || matchesScope(resource, paths)) && (actions.length === 0 || actions.includes(effect.toLowerCase()))
}

function normalizeExperiment(reversibility, experiment) {
  if (reversibility !== REVERSIBILITY.UNKNOWN_REVERSIBILITY) return reversibility
  if (experiment?.safe && Object.values(REVERSIBILITY).includes(experiment.resulting_reversibility)) return experiment.resulting_reversibility
  return reversibility
}

function inCapsuleScope(capsule, effect, resource) {
  if (effect === EFFECTS.LOCAL_READ) return matchesScope(resource, capsule?.read_scope || [])
  if (effect === EFFECTS.LOCAL_COMMIT) return true
  if ([EFFECTS.NETWORK, EFFECTS.DELEGATE].includes(effect)) return matchesScope(resource, capsule?.external_effect_scope || [])
  return matchesScope(resource, capsule?.write_scope || [])
}

/**
 * Classify one concrete effect. The result is safe to serialize into an
 * audit record and contains the exact basis for the decision.
 */
export function evaluateEffect(input = {}) {
  const {
    intent = {},
    capsule = {},
    effect,
    resource = '',
    receipt = null,
    lease = null,
    authorization_source = null,
    tool_output = null,
    experiment = null,
    restore_available = false,
  } = input
  const reversibility = normalizeExperiment(input.reversibility || REVERSIBILITY.UNKNOWN_REVERSIBILITY, experiment)
  const forbidden = capsule.forbidden_scope || intent.forbidden_scope || []
  const inScope = inCapsuleScope(capsule, effect, resource)
  const receiptAccepted = authorizationMatches(receipt, { effect, resource })
  const leaseAccepted = authorizationMatches(lease, { effect, resource })
  // Tool output and prose are intentionally observed only as untrusted data.
  void tool_output

  if (!KNOWN_EFFECTS.has(effect)) {
    return result(DECISION_CLASSES.D_TECHNICAL_BLOCK, 'RED_BLOCK_UNKNOWN_EFFECT', reversibility, false, false, 'No capability registry entry exists for this effect.', { authorization_accepted: false })
  }
  if (TECHNICAL_BLOCK_EFFECTS.has(effect)) {
    return result(DECISION_CLASSES.D_TECHNICAL_BLOCK, `RED_BLOCK_${effect}`, reversibility, false, false, 'Immutable runtime boundary cannot be authorized by a receipt or lease.', { authorization_accepted: false })
  }
  if (matchesScope(resource, forbidden)) {
    return result(DECISION_CLASSES.D_TECHNICAL_BLOCK, 'RED_BLOCK_FORBIDDEN_SCOPE', reversibility, false, false, 'Resource is in forbidden scope.', { authorization_accepted: false })
  }
  if (authorization_source && authorization_source.source && !['OWNER_INTENT', 'TASK_CAPSULE', 'CHANGE_LEASE', 'APPROVAL_RECEIPT', 'SYSTEM_POLICY'].includes(authorization_source.source)) {
    return result(DECISION_CLASSES.D_TECHNICAL_BLOCK, 'RED_BLOCK_UNTRUSTED_AUTHORIZATION_SOURCE', reversibility, false, false, 'Prose, README files, and tool output cannot authorize effects.', { authorization_accepted: false })
  }
  if ((receiptAccepted || leaseAccepted) && (!effectAllowed(capsule, effect) || !inScope)) {
    return result(DECISION_CLASSES.D_TECHNICAL_BLOCK, 'RED_BLOCK_SCOPE_OR_EFFECT_NOT_ALLOWED', reversibility, false, false, 'Authorization cannot expand the task capsule effect or resource scope.', { authorization_accepted: false })
  }
  if (receiptAccepted || leaseAccepted) {
    return result(DECISION_CLASSES.B_LEASE_OR_RECEIPT, 'AUTHORIZED_BY_BOUND_RECEIPT_OR_LEASE', reversibility, false, true, receiptAccepted ? 'approval_receipt' : 'change_lease', { authorization_accepted: true })
  }
  if (OWNER_EFFECTS.has(effect)) {
    return result(DECISION_CLASSES.C_BUNDLED_OWNER_DECISION, 'OWNER_DECISION_REQUIRED', reversibility, true, false, 'Concrete external, publication, production, or irreversible effect is not pre-authorized.', { authorization_accepted: false })
  }
  if (reversibility === REVERSIBILITY.UNKNOWN_REVERSIBILITY) {
    return result(DECISION_CLASSES.D_TECHNICAL_BLOCK, 'RED_BLOCK_UNKNOWN_REVERSIBILITY', reversibility, false, false, 'Unknown tool effect reversibility is fail-closed; run a safe experiment first.', { authorization_accepted: false })
  }
  if (!effectAllowed(capsule, effect) || !inScope) {
    return result(DECISION_CLASSES.D_TECHNICAL_BLOCK, 'RED_BLOCK_SCOPE_OR_EFFECT_NOT_ALLOWED', reversibility, false, false, 'Effect or resource is outside the task capsule.', { authorization_accepted: false })
  }
  if ([REVERSIBILITY.FULLY_REVERSIBLE, REVERSIBILITY.REVERSIBLE_WITH_BACKUP].includes(reversibility)) {
    const basis = input.preference ? `default_decision_preferences:${input.preference}` : 'intent+task_capsule+reversible_in_scope'
    return result(DECISION_CLASSES.A_AUTONOMOUS, 'AUTONOMOUS_IN_SCOPE', reversibility, false, true, basis, { authorization_accepted: true, restore_available })
  }
  return result(DECISION_CLASSES.C_BUNDLED_OWNER_DECISION, 'OWNER_DECISION_REQUIRED_FOR_NON_REVERSIBLE_EFFECT', reversibility, true, false, 'Effect is not fully reversible.', { authorization_accepted: false })
}

function result(decision_class, code, reversibility, requires_owner, allowed, decision_basis, extra = {}) {
  return Object.freeze({ decision_class, code, reversibility, requires_owner, allowed, decision_basis, ...extra })
}

function normalizeQuestion(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').split(' ').filter((word) => !['the', 'a', 'an', 'please', 'should', 'could'].includes(word)).join(' ')
}

export function reviewApprovalMinimization(request = {}) {
  const routine = request.kind === 'technical-routine' && request.reversible === true && request.in_scope === true && !OWNER_EFFECTS.has(request.effect)
  if (routine) return { allowed: false, code: 'UNNECESSARY_ESCALATION', finding: 'UNNECESSARY_ESCALATION', message: 'Technical reversible in-scope decisions belong to the agent.' }
  return { allowed: true, finding: null }
}

export function createApprovalCoordinator({ budget = {}, now = () => Date.now(), stateFile = null } = {}) {
  const persisted = stateFile && fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : []
  const requests = new Map(persisted.map((entry) => [entry.key, Object.freeze(entry.request)]))
  const seen = new Set()
  let duplicateCount = 0
  let interruptionCount = 0
  let autonomousCount = 0
  let serialCount = 0
  let lastRequestAt = null
  const maximum = Number.isInteger(budget.maximum_owner_interruptions) ? budget.maximum_owner_interruptions : 1

  return {
    request(request = {}) {
      const key = `${request.effect}|${normalizeQuestion(request.resource)}|${normalizeQuestion(request.reason)}`
      if (requests.has(key)) {
        duplicateCount += 1
        return requests.get(key)
      }
      const entry = Object.freeze({ request_id: `approval-request-${requests.size + 1}`, ...request, deduplicated: false })
      requests.set(key, entry)
      if (stateFile) {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true })
        fs.writeFileSync(stateFile, JSON.stringify([...requests.entries()].map(([persistedKey, persistedRequest]) => ({ key: persistedKey, request: persistedRequest })), null, 2))
      }
      if (lastRequestAt !== null && now() >= lastRequestAt) serialCount += 1
      lastRequestAt = now()
      return entry
    },
    recordOwnerInterruption() { interruptionCount += 1 },
    recordAutonomousDecision() { autonomousCount += 1 },
    canRequest(request = {}) {
      if (interruptionCount < maximum) return true
      if (request.reason) return { allowed: true, reason: 'BUDGET_OVERRUN_DOCUMENTED', explanation: request.reason }
      return { allowed: false, reason: 'APPROVAL_BUDGET_EXCEEDED' }
    },
    metrics() {
      return {
        owner_interruption_count: interruptionCount,
        approval_request_count: requests.size,
        duplicate_approval_request_count: duplicateCount,
        serial_approval_count: serialCount,
        autonomous_decision_count: autonomousCount,
        unnecessary_escalation_count: 0,
        bundled_approval_ratio: 0,
      }
    },
  }
}

export function createTaskGraph(nodes = []) {
  return { nodes: nodes.map((node) => ({ ...node, status: 'READY_AUTONOMOUS' })) }
}

export function continueSafeWork({ graph, context, decisions = {} } = {}) {
  const nodes = graph.nodes.map((node) => ({ ...node }))
  for (const node of nodes) {
    const dependencyBlocked = (node.dependencies || []).some((dependency) => nodes.find((candidate) => candidate.id === dependency)?.status === 'BLOCKED_POLICY')
    if (dependencyBlocked) {
      node.status = 'BLOCKED_POLICY'
      continue
    }
    const decision = evaluateEffect({ ...context, effect: node.effect, resource: node.resource, reversibility: node.reversible })
    if (decisions[node.id] === 'REJECT') node.status = 'BLOCKED_POLICY'
    else if (decision.decision_class === DECISION_CLASSES.A_AUTONOMOUS || decision.decision_class === DECISION_CLASSES.B_LEASE_OR_RECEIPT) node.status = 'COMPLETED'
    else if (decision.decision_class === DECISION_CLASSES.C_BUNDLED_OWNER_DECISION) node.status = 'WAITING_FOR_APPROVAL'
    else node.status = 'BLOCKED_POLICY'
  }
  return { nodes }
}

export function riskWithin(parentRisk, childRisk) {
  return (RISK_ORDER[childRisk] || Number.MAX_SAFE_INTEGER) <= (RISK_ORDER[parentRisk] || 0)
}
