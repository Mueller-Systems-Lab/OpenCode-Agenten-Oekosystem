// SPDX-License-Identifier: MIT
/**
 * Deterministic FIRST_BAD_BOUNDARY.
 *
 * Computed from the ordered phase history of a run. Every boundary is
 * TASK → BASELINE → RESEARCH → PLAN → PLAN_GATE → BUILD → VERIFY → REVIEWS
 * → CONTROLLER. The first FAIL wins. Returns null when all boundaries pass.
 */
export const RUN_BOUNDARIES = Object.freeze(['TASK', 'BASELINE', 'RESEARCH', 'PLAN', 'PLAN_GATE', 'BUILD', 'VERIFY', 'REVIEWS', 'CONTROLLER'])

export function firstBadBoundary(boundaries = []) {
  if (!Array.isArray(boundaries)) return null
  for (const boundary of boundaries) {
    if (boundary && boundary.status === 'FAIL') {
      return boundary.name || boundary.phase || boundary.boundary || null
    }
  }
  return null
}
