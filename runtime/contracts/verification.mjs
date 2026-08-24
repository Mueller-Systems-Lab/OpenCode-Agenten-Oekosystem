// SPDX-License-Identifier: MIT
/**
 * ecosystem.verification.v1
 *
 * Real deterministic tool verification. An LLM claim such as "this looks
 * correct" is never verification evidence. Failures carry a normalized
 * failure_signature; retries additionally require a concrete strategy_delta.
 */
export const CONTRACT_ID = 'ecosystem.verification.v1'

export function create({ run_id, verification = {} } = {}) {
  return {
    contract: CONTRACT_ID,
    run_id,
    verification: {
      passed: verification.passed === true,
      failure_signature: verification.failure_signature ?? null,
      strategy_delta: verification.strategy_delta ?? null,
      checks: verification.checks || [],
    },
  }
}

export function validate(value) {
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['verification must be an object'] }
  }
  if (value.contract !== CONTRACT_ID) issues.push(`contract must be ${CONTRACT_ID}`)
  if (typeof value.run_id !== 'string' || value.run_id.trim().length === 0) issues.push('run_id must be a non-empty string')
  const verification = value.verification
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) {
    issues.push('verification must be an object')
    return { ok: false, issues }
  }
  if (typeof verification.passed !== 'boolean') issues.push('verification.passed must be a boolean')
  if (verification.failure_signature !== null && verification.failure_signature !== undefined && typeof verification.failure_signature !== 'string') issues.push('verification.failure_signature must be a string or null')
  if (verification.strategy_delta !== null && verification.strategy_delta !== undefined && typeof verification.strategy_delta !== 'string') issues.push('verification.strategy_delta must be a string or null')
  if (!Array.isArray(verification.checks)) issues.push('verification.checks must be an array')
  return { ok: issues.length === 0, issues }
}
