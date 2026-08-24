// SPDX-License-Identifier: MIT
/**
 * ecosystem.baseline.v1
 *
 * Result of the task-specific capability preflight. Only the capabilities
 * actually needed by this run are checked. Credential status is limited to
 * AVAILABLE | MISSING | DENIED and never carries secret content.
 */
export const CONTRACT_ID = 'ecosystem.baseline.v1'

export const CAPABILITY_STATUSES = Object.freeze([
  'PASS', 'FAIL', 'MISSING', 'DEGRADED', 'DENIED', 'AVAILABLE', 'UNAVAILABLE',
])

export function create({
  run_id,
  required_capabilities = {},
  required_mcp = {},
  required_skills = [],
  runtime = { status: 'PASS' },
  approved = false,
  errors = [],
  checked_at = new Date().toISOString(),
} = {}) {
  return {
    contract: CONTRACT_ID,
    run_id,
    required_capabilities,
    required_mcp,
    required_skills,
    runtime,
    approved,
    errors,
    checked_at,
  }
}

function isStatus(value) {
  return typeof value === 'string' && CAPABILITY_STATUSES.includes(value)
}

function isStatusMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every((status) => isStatus(status) || status === 'PASS')
}

export function validate(value) {
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['baseline must be an object'] }
  }
  if (value.contract !== CONTRACT_ID) issues.push(`contract must be ${CONTRACT_ID}`)
  if (typeof value.run_id !== 'string' || value.run_id.trim().length === 0) issues.push('run_id must be a non-empty string')
  if (!isStatusMap(value.required_capabilities)) issues.push('required_capabilities must be an object of capability statuses')
  if (!isStatusMap(value.required_mcp)) issues.push('required_mcp must be an object of statuses')
  if (!Array.isArray(value.required_skills)) issues.push('required_skills must be an array')
  if (!value.runtime || typeof value.runtime !== 'object' || !isStatus(value.runtime.status)) issues.push('runtime must be an object with a status')
  if (typeof value.approved !== 'boolean') issues.push('approved must be a boolean')
  if (!Array.isArray(value.errors)) issues.push('errors must be an array')
  if (typeof value.checked_at !== 'string' || Number.isNaN(Date.parse(value.checked_at))) issues.push('checked_at must be an ISO timestamp')
  return { ok: issues.length === 0, issues }
}
