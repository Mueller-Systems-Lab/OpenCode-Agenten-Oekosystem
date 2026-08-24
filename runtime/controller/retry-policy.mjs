// SPDX-License-Identifier: MIT
/**
 * Deterministic bounded retry policy.
 *
 * Retry is allowed only when ALL of these hold:
 *   - a normalized failure_signature exists
 *   - a concrete strategy_delta exists (a real strategy change)
 *   - attempt < max_attempts
 *   - the identical (signature, strategy) pair has not already been tried
 *
 * Denials are terminal for the run and route to SPLIT (or BLOCKED when the
 * denial is an external blocker).
 */
export const DEFAULT_MAX_ATTEMPTS = 2

export const RETRY_REASON_CODES = Object.freeze([
  'RETRY_ALLOWED_WITH_STRATEGY_DELTA',
  'RETRY_DENIED_NO_FAILURE_SIGNATURE',
  'RETRY_DENIED_NO_STRATEGY_DELTA',
  'RETRY_DENIED_ATTEMPT_LIMIT',
  'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE',
])

const INVALID_STRATEGY_DELTAS = new Set([
  'try again', 'retry', 'attempt another fix', 'will retry', 'retrying',
  'please retry', 'try again later', 'retry later', 'just retry',
])

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

export function isMeaningfulStrategyDelta(value) {
  const raw = String(value || '').trim()
  if (raw.length < 12) return false
  if (INVALID_STRATEGY_DELTAS.has(normalizeText(raw))) return false
  return true
}

export function isRepeat(previousFailures, failureSignature, strategyDelta) {
  const signature = normalizeText(failureSignature)
  const delta = normalizeText(strategyDelta)
  if (!signature) return false
  return (previousFailures || []).some((entry) => {
    const previousSignature = normalizeText(entry.failure_signature)
    const previousDelta = normalizeText(entry.strategy_delta)
    if (previousSignature !== signature) return false
    if (!delta || !previousDelta) return previousSignature === signature
    return previousDelta === delta
  })
}

export function evaluateRetry({
  failure_signature,
  strategy_delta,
  attempt,
  max_attempts = DEFAULT_MAX_ATTEMPTS,
  previous_failures = [],
} = {}) {
  const signature = String(failure_signature || '').trim()
  const delta = String(strategy_delta || '').trim()

  if (attempt >= max_attempts) {
    return { allowed: false, decision: 'SPLIT', reason_code: 'RETRY_DENIED_ATTEMPT_LIMIT', attempt, max_attempts }
  }
  if (!signature) {
    return { allowed: false, decision: 'SPLIT', reason_code: 'RETRY_DENIED_NO_FAILURE_SIGNATURE', attempt, max_attempts }
  }
  if (!isMeaningfulStrategyDelta(delta)) {
    return { allowed: false, decision: 'SPLIT', reason_code: 'RETRY_DENIED_NO_STRATEGY_DELTA', attempt, max_attempts }
  }
  if (isRepeat(previous_failures, signature, delta)) {
    return { allowed: false, decision: 'SPLIT', reason_code: 'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE', attempt, max_attempts }
  }
  return { allowed: true, decision: 'RETRY', reason_code: 'RETRY_ALLOWED_WITH_STRATEGY_DELTA', attempt, max_attempts }
}
