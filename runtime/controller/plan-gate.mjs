// SPDX-License-Identifier: MIT
/**
 * Deterministic Plan Gate.
 *
 * Pure, LLM-free gate over ecosystem.plan.v1. The plan worker cannot
 * override this gate. All reason codes are deterministic.
 */
export const PLAN_GATE_REASON_CODES = Object.freeze([
  'PLAN_MISSING',
  'ACCEPTANCE_CRITERIA_MISSING',
  'BUILD_SCOPE_MISSING',
  'REQUIRED_TESTS_INVALID',
  'TARGETS_INVALID',
])

function isStructurallyValidTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return false
  return targets.every((target) => {
    if (typeof target === 'string') return target.trim().length > 0
    return target && typeof target === 'object' && typeof target.path === 'string' && target.path.trim().length > 0
  })
}

export function evaluatePlanGate(planContract) {
  const checkedAt = new Date().toISOString()
  const errors = []
  if (!planContract || typeof planContract !== 'object' || Array.isArray(planContract)) {
    return { approved: false, errors: ['PLAN_MISSING'], checked_at: checkedAt }
  }
  const plan = planContract.plan || planContract
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { approved: false, errors: ['PLAN_MISSING'], checked_at: checkedAt }
  }
  const acceptanceCriteria = plan.acceptance_criteria
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0
    || acceptanceCriteria.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    errors.push('ACCEPTANCE_CRITERIA_MISSING')
  }
  const buildScope = plan.build_scope
  if (!buildScope || typeof buildScope !== 'object' || Array.isArray(buildScope)) {
    errors.push('BUILD_SCOPE_MISSING')
  }
  if (!Array.isArray(plan.required_tests)) {
    errors.push('REQUIRED_TESTS_INVALID')
  }
  if (!isStructurallyValidTargets(plan.targets)) {
    errors.push('TARGETS_INVALID')
  }
  return { approved: errors.length === 0, errors, checked_at: checkedAt }
}
