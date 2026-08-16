// SPDX-License-Identifier: MIT
/**
 * ecosystem.build-input.v1 and ecosystem.build-result.v1
 *
 * The builder receives exactly the approved plan, approved build_scope,
 * the research contract and the task contract. The result contract carries
 * changed files, out-of-scope detection and errors.
 */
export const BUILD_INPUT_CONTRACT_ID = 'ecosystem.build-input.v1'
export const BUILD_RESULT_CONTRACT_ID = 'ecosystem.build-result.v1'
export const BUILD_STATUSES = Object.freeze(['SUCCESS', 'FAILURE'])

export function createBuildInput({ run_id, attempt = 0, approved_plan, approved_build_scope, research, task } = {}) {
  return {
    contract: BUILD_INPUT_CONTRACT_ID,
    run_id,
    attempt,
    approved_plan,
    approved_build_scope,
    research,
    task,
  }
}

export function validateBuildInput(value) {
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['build-input must be an object'] }
  }
  if (value.contract !== BUILD_INPUT_CONTRACT_ID) issues.push(`contract must be ${BUILD_INPUT_CONTRACT_ID}`)
  if (typeof value.run_id !== 'string' || value.run_id.trim().length === 0) issues.push('run_id must be a non-empty string')
  if (!Number.isInteger(value.attempt) || value.attempt < 0) issues.push('attempt must be a non-negative integer')
  if (!value.approved_plan || typeof value.approved_plan !== 'object') issues.push('approved_plan must be an object')
  if (!value.approved_build_scope || typeof value.approved_build_scope !== 'object') issues.push('approved_build_scope must be an object')
  if (!value.research || typeof value.research !== 'object') issues.push('research must be an object')
  if (!value.task || typeof value.task !== 'object') issues.push('task must be an object')
  return { ok: issues.length === 0, issues }
}

export function createBuildResult({ run_id, attempt = 0, status = 'FAILURE', changed_files = [], out_of_scope = [], errors = [], duration_ms = 0, finished_at = new Date().toISOString() } = {}) {
  return {
    contract: BUILD_RESULT_CONTRACT_ID,
    run_id,
    attempt,
    status,
    changed_files,
    out_of_scope,
    errors,
    duration_ms,
    finished_at,
  }
}

export function validateBuildResult(value) {
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['build-result must be an object'] }
  }
  if (value.contract !== BUILD_RESULT_CONTRACT_ID) issues.push(`contract must be ${BUILD_RESULT_CONTRACT_ID}`)
  if (typeof value.run_id !== 'string' || value.run_id.trim().length === 0) issues.push('run_id must be a non-empty string')
  if (!Number.isInteger(value.attempt) || value.attempt < 0) issues.push('attempt must be a non-negative integer')
  if (!BUILD_STATUSES.includes(value.status)) issues.push(`status must be one of ${BUILD_STATUSES.join(', ')}`)
  if (!Array.isArray(value.changed_files)) issues.push('changed_files must be an array')
  if (!Array.isArray(value.out_of_scope)) issues.push('out_of_scope must be an array')
  if (!Array.isArray(value.errors)) issues.push('errors must be an array')
  return { ok: issues.length === 0, issues }
}
