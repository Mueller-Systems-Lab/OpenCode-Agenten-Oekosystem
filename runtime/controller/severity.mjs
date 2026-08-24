// SPDX-License-Identifier: MIT
/**
 * Ordinal severity ranking for the deterministic controller.
 * Severity is a rank, never a probability. Unknown severity fails closed
 * to the most severe rank (-1 → treated as absent by callers).
 */
export const SEVERITIES = Object.freeze(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
export const SEVERITY_RANK = Object.freeze({
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
})

export function severityRank(value) {
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, value) ? SEVERITY_RANK[value] : -1
}

export function isSeverity(value) {
  return SEVERITIES.includes(value)
}
