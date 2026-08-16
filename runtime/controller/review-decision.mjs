// SPDX-License-Identifier: MIT
/**
 * Deterministic review aggregation.
 *
 * Decision priority (invariant):
 *   1. Security Hard Block (blocking + severity >= HIGH)   → BLOCKED
 *   2. any recommendation SPLIT                             → SPLIT
 *   3. any correctable non-blocking finding                 → FIX
 *   4. everything green                                     → DONE
 *
 * No majority vote, ever.
 */
import { severityRank } from './severity.mjs'

export const REVIEW_REASON_CODES = Object.freeze({
  BLOCKED: 'BLOCKING_HIGH_OR_CRITICAL_FINDING',
  SPLIT: 'REVIEW_REQUESTED_SPLIT',
  FIX: 'NON_BLOCKING_REVIEW_FINDINGS',
  DONE: 'ALL_HARD_GATES_GREEN',
})

export function securityHardBlock(reviews = []) {
  return reviews.find((entry) => {
    const review = entry?.review || entry
    return review?.blocking === true && severityRank(review?.severity) >= severityRank('HIGH')
  }) || null
}

export function hasCorrectableFinding(entry) {
  const review = entry?.review || entry
  if (!review) return false
  if (review.recommendation === 'FIX') return true
  if (review.blocking === true) return false
  if (Array.isArray(review.findings) && review.findings.length > 0) return true
  return false
}

export function evaluateReviews(reviews = []) {
  const hardBlock = securityHardBlock(reviews)
  if (hardBlock) {
    return { decision: 'BLOCKED', reason_code: REVIEW_REASON_CODES.BLOCKED, blocking_review: hardBlock }
  }
  if (reviews.some((entry) => (entry?.review || entry)?.recommendation === 'SPLIT')) {
    return { decision: 'SPLIT', reason_code: REVIEW_REASON_CODES.SPLIT }
  }
  if (reviews.some(hasCorrectableFinding)) {
    return { decision: 'FIX', reason_code: REVIEW_REASON_CODES.FIX }
  }
  return { decision: 'DONE', reason_code: REVIEW_REASON_CODES.DONE }
}
