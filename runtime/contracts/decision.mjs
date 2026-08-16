// SPDX-License-Identifier: MIT
/**
 * ecosystem.decision.v1
 *
 * Terminal decision produced only by the deterministic controller.
 * DONE emerges exclusively here — never from a worker claim.
 */
export const CONTRACT_ID = 'ecosystem.decision.v1'
export const TERMINAL_STATES = Object.freeze(['DONE', 'FIX', 'SPLIT', 'BLOCKED'])
export const NEXT_PATHS = Object.freeze({
  DONE: 'FINALIZE',
  FIX: 'TARGETED_FIX',
  SPLIT: 'DECOMPOSE_INTO_SUBTASKS',
  BLOCKED: 'HUMAN_OR_POLICY_INTERVENTION',
})

export function nextPathFor(decision) {
  return NEXT_PATHS[decision] || null
}

export function create({
  run_id,
  decision = 'BLOCKED',
  reason_code,
  next_path = null,
  first_bad_boundary = null,
  phase_history = [],
  decided_at = new Date().toISOString(),
} = {}) {
  return {
    contract: CONTRACT_ID,
    run_id,
    decision,
    reason_code,
    next_path: next_path || nextPathFor(decision),
    first_bad_boundary,
    phase_history,
    decided_at,
  }
}

export function validate(value) {
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['decision must be an object'] }
  }
  if (value.contract !== CONTRACT_ID) issues.push(`contract must be ${CONTRACT_ID}`)
  if (typeof value.run_id !== 'string' || value.run_id.trim().length === 0) issues.push('run_id must be a non-empty string')
  if (!TERMINAL_STATES.includes(value.decision)) issues.push(`decision must be one of ${TERMINAL_STATES.join(', ')}`)
  if (typeof value.reason_code !== 'string' || value.reason_code.trim().length === 0) issues.push('reason_code must be a non-empty string')
  if (value.next_path !== NEXT_PATHS[value.decision]) issues.push(`next_path must be ${NEXT_PATHS[value.decision]}`)
  if (value.first_bad_boundary !== null && value.first_bad_boundary !== undefined && typeof value.first_bad_boundary !== 'string') issues.push('first_bad_boundary must be a string or null')
  if (!Array.isArray(value.phase_history)) issues.push('phase_history must be an array')
  if (typeof value.decided_at !== 'string' || Number.isNaN(Date.parse(value.decided_at))) issues.push('decided_at must be an ISO timestamp')
  return { ok: issues.length === 0, issues }
}
