// SPDX-License-Identifier: MIT
/**
 * ecosystem.plan.v1
 *
 * Structure produced by the native plan worker. The plan worker may analyse
 * and plan; it may not decide whether the plan is sufficient — that belongs
 * to the deterministic plan gate.
 */
export const CONTRACT_ID = 'ecosystem.plan.v1'

export function create({ run_id, plan = {} } = {}) {
  return {
    contract: CONTRACT_ID,
    run_id,
    plan: {
      targets: plan.targets || [],
      acceptance_criteria: plan.acceptance_criteria || [],
      required_tests: plan.required_tests || [],
      risks: plan.risks || [],
      build_scope: plan.build_scope || {},
    },
  }
}

export function validate(value) {
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['plan must be an object'] }
  }
  if (value.contract !== CONTRACT_ID) issues.push(`contract must be ${CONTRACT_ID}`)
  if (typeof value.run_id !== 'string' || value.run_id.trim().length === 0) issues.push('run_id must be a non-empty string')
  const plan = value.plan
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    issues.push('plan must be an object')
    return { ok: false, issues }
  }
  if (!Array.isArray(plan.targets)) issues.push('plan.targets must be an array')
  if (!Array.isArray(plan.acceptance_criteria)) issues.push('plan.acceptance_criteria must be an array')
  if (!Array.isArray(plan.required_tests)) issues.push('plan.required_tests must be an array')
  if (!Array.isArray(plan.risks)) issues.push('plan.risks must be an array')
  if (!plan.build_scope || typeof plan.build_scope !== 'object' || Array.isArray(plan.build_scope)) issues.push('plan.build_scope must be an object')
  return { ok: issues.length === 0, issues }
}
