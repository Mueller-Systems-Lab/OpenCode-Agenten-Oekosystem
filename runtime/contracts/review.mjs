// SPDX-License-Identifier: MIT
/**
 * ecosystem.review.v1
 *
 * Independent review output (correctness / security / quality). Severity is
 * ordinal, never a probability. The deterministic controller aggregates these.
 */
export const CONTRACT_ID = 'ecosystem.review.v1'
export const REVIEW_TYPES = Object.freeze(['correctness', 'security', 'quality', 'visual'])
export const SEVERITIES = Object.freeze(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
export const RECOMMENDATIONS = Object.freeze(['PASS', 'SPLIT', 'FIX', 'BLOCK'])

export function create({ run_id, review_type = 'correctness', review = {} } = {}) {
  return {
    contract: CONTRACT_ID,
    run_id,
    review_type,
    review: {
      status: review.status || 'PASS',
      severity: review.severity || 'INFO',
      blocking: review.blocking === true,
      recommendation: review.recommendation || 'PASS',
      findings: review.findings || [],
    },
  }
}

export function validate(value) {
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['review must be an object'] }
  }
  if (value.contract !== CONTRACT_ID) issues.push(`contract must be ${CONTRACT_ID}`)
  if (typeof value.run_id !== 'string' || value.run_id.trim().length === 0) issues.push('run_id must be a non-empty string')
  if (!REVIEW_TYPES.includes(value.review_type)) issues.push(`review_type must be one of ${REVIEW_TYPES.join(', ')}`)
  const review = value.review
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    issues.push('review must be an object')
    return { ok: false, issues }
  }
  if (!['PASS', 'FAIL'].includes(review.status)) issues.push('review.status must be PASS or FAIL')
  if (!SEVERITIES.includes(review.severity)) issues.push(`review.severity must be one of ${SEVERITIES.join(', ')}`)
  if (typeof review.blocking !== 'boolean') issues.push('review.blocking must be a boolean')
  if (!RECOMMENDATIONS.includes(review.recommendation)) issues.push(`review.recommendation must be one of ${RECOMMENDATIONS.join(', ')}`)
  if (!Array.isArray(review.findings)) issues.push('review.findings must be an array')
  return { ok: issues.length === 0, issues }
}
