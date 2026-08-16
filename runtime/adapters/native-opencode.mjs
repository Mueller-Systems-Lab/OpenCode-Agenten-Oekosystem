// SPDX-License-Identifier: MIT
/**
 * Native OpenCode adapter seam.
 *
 * Maps the native OpenCode plan-mode output into ecosystem.plan.v1 and wraps
 * native build execution into ecosystem.build-result.v1. This is a seam, not
 * a competing planner/builder: the deterministic plan gate and the controller
 * consume only the contracts. Native OpenCode plan/build behaviour itself
 * stays in OpenCode.
 */
import { create as createPlan, validate as validatePlan } from '../contracts/plan.mjs'
import { createBuildInput, createBuildResult, validateBuildInput, validateBuildResult } from '../contracts/build.mjs'

export function parsePlanText(planText = '') {
  const sections = {}
  let current = null
  for (const rawLine of String(planText).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^#{2,3}\s+/.test(line)) {
      current = line.replace(/^#{2,3}\s+/, '').toLowerCase()
      sections[current] = []
      continue
    }
    if (current) sections[current].push(line)
  }
  const lines = (name) => (sections[name] || [])
    .filter((line) => line.startsWith('- ') || line.startsWith('* '))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)

  const buildScopeLines = lines('build scope')
  const files = []
  for (const line of buildScopeLines) {
    const match = line.match(/files?:\s*(.+)/i)
    if (match) files.push(...match[1].split(',').map((value) => value.trim()).filter(Boolean))
    else files.push(line)
  }

  return {
    targets: lines('targets').map((line) => {
      const [first, ...rest] = line.split(/[\s—–-]{1,2}/).filter(Boolean)
      return { path: first, description: rest.join(' ') || first }
    }),
    acceptance_criteria: lines('acceptance criteria'),
    required_tests: lines('required tests'),
    risks: lines('risks'),
    build_scope: files.length > 0 ? { files } : {},
  }
}

export function fromNativePlan({ run_id, planText = null, planData = null } = {}) {
  const plan = planData || (planText ? parsePlanText(planText) : {})
  return createPlan({ run_id, plan })
}

export function toNativePlan(planContract) {
  const plan = planContract?.plan || {}
  const bullets = (values) => (values || []).map((value) => {
    if (typeof value === 'string') return `- ${value}`
    return `- ${value.path} — ${value.description || value.path}`
  }).join('\n')
  const scopeFiles = (plan.build_scope?.files || []).join(', ')
  return [
    '# Plan',
    '',
    '## Targets',
    bullets(plan.targets),
    '',
    '## Acceptance Criteria',
    bullets(plan.acceptance_criteria),
    '',
    '## Required Tests',
    bullets(plan.required_tests),
    '',
    '## Risks',
    bullets(plan.risks),
    '',
    `## Build Scope\nfiles: ${scopeFiles}`,
  ].join('\n')
}

export async function runNativeBuild({ buildInput, execute } = {}) {
  const startedAt = Date.now()
  const inputValidation = validateBuildInput(buildInput)
  if (!inputValidation.ok) {
    const build_result = createBuildResult({ run_id: buildInput?.run_id, attempt: buildInput?.attempt, status: 'FAILURE', errors: inputValidation.issues })
    return { build_result, outcome: null }
  }
  try {
    const outcome = await execute(buildInput)
    const build_result = createBuildResult({
      run_id: buildInput.run_id,
      attempt: buildInput.attempt,
      status: 'SUCCESS',
      changed_files: outcome?.changed_files || [],
      out_of_scope: outcome?.out_of_scope || [],
      errors: outcome?.errors || [],
      duration_ms: Date.now() - startedAt,
      finished_at: new Date().toISOString(),
    })
    return { build_result, outcome }
  } catch (error) {
    const build_result = createBuildResult({
      run_id: buildInput.run_id,
      attempt: buildInput.attempt,
      status: 'FAILURE',
      changed_files: [],
      errors: [error?.message || String(error)],
      duration_ms: Date.now() - startedAt,
      finished_at: new Date().toISOString(),
    })
    return { build_result, outcome: null }
  }
}

export function validateNativePlanContract(planContract) {
  return validatePlan(planContract)
}

export function validateNativeBuildResultContract(buildResult) {
  return validateBuildResult(buildResult)
}

export { createBuildInput }
