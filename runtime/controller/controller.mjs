// SPDX-License-Identifier: MIT
/**
 * Deterministic Controller.
 *
 * The terminal decision for a run is produced exclusively here. No LLM,
 * no worker, no majority vote. DONE can only emerge when every hard gate is
 * green AND reviews pass.
 *
 * Terminal states: DONE | FIX | SPLIT | BLOCKED (RETRY is a transition).
 */
import { evaluatePlanGate } from './plan-gate.mjs'
import { evaluateRetry } from './retry-policy.mjs'
import { evaluateReviews } from './review-decision.mjs'
import { firstBadBoundary } from './first-bad-boundary.mjs'
import { nextPathFor } from '../contracts/decision.mjs'

export function decide(input = {}) {
  const {
    baseline = {},
    plan,
    planGate,
    verification,
    reviews = [],
    attempt = 0,
    max_attempts = 2,
    previous_failures = [],
    boundaries = null,
    build_status = null,
  } = input

  const gate = planGate || (plan ? evaluatePlanGate(plan) : { approved: false, errors: ['PLAN_MISSING'] })

  if (!baseline.approved) {
    return terminal('BLOCKED', 'BLOCKED_MISSING_REQUIRED_CAPABILITY', boundaries, 'BASELINE')
  }
  if (!gate.approved) {
    return terminal('BLOCKED', gate.errors?.[0] || 'PLAN_MISSING', boundaries, 'PLAN_GATE')
  }
  if (!verification?.verification?.passed) {
    const retry = evaluateRetry({
      failure_signature: verification?.verification?.failure_signature,
      strategy_delta: verification?.verification?.strategy_delta,
      attempt,
      max_attempts,
      previous_failures,
    })
    if (retry.allowed) {
      return terminal('RETRY', retry.reason_code, boundaries, build_status === 'FAIL' ? 'BUILD' : 'VERIFY')
    }
    return terminal('SPLIT', retry.reason_code, boundaries, build_status === 'FAIL' ? 'BUILD' : 'VERIFY')
  }

  if (!Array.isArray(reviews) || reviews.length === 0) {
    return terminal('BLOCKED', 'REVIEWS_NOT_PERFORMED', boundaries, 'REVIEWS')
  }

  const reviewDecision = evaluateReviews(reviews)
  if (reviewDecision.decision !== 'DONE') {
    return terminal(reviewDecision.decision, reviewDecision.reason_code, boundaries, 'REVIEWS')
  }
  return terminal('DONE', 'ALL_HARD_GATES_GREEN', boundaries, null)
}

function terminal(decision, reasonCode, boundaries, derivedBoundary) {
  const firstBad = Array.isArray(boundaries) && boundaries.length > 0
    ? firstBadBoundary(boundaries)
    : derivedBoundary
  return {
    decision,
    reason_code: reasonCode,
    next_path: decision === 'RETRY' ? 'REBUILD' : nextPathFor(decision),
    first_bad_boundary: firstBad,
  }
}
