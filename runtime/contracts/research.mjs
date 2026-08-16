// SPDX-License-Identifier: MIT
/**
 * ecosystem.research.v1
 *
 * Research perspectives are roles/jobs, not permanent agents: CODE, DOCS,
 * TESTS. Findings must be real; no fabricated ground truth.
 */
export const CONTRACT_ID = 'ecosystem.research.v1'
export const RESEARCH_FOCUSES = Object.freeze(['code', 'docs', 'tests'])

export function create({ run_id, research = null } = {}) {
  if (research) return { contract: CONTRACT_ID, run_id, research }
  return {
    contract: CONTRACT_ID,
    run_id,
    research: RESEARCH_FOCUSES.map((focus) => ({ focus, findings: [] })),
  }
}

export function validate(value) {
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['research must be an object'] }
  }
  if (value.contract !== CONTRACT_ID) issues.push(`contract must be ${CONTRACT_ID}`)
  if (typeof value.run_id !== 'string' || value.run_id.trim().length === 0) issues.push('run_id must be a non-empty string')
  if (!Array.isArray(value.research)) {
    issues.push('research must be an array')
  } else if (value.research.length === 0) {
    issues.push('research must contain at least one perspective')
  } else {
    for (const entry of value.research) {
      if (!entry || typeof entry !== 'object') issues.push('each research entry must be an object')
      else {
        if (!RESEARCH_FOCUSES.includes(entry.focus)) issues.push(`unknown focus: ${entry.focus}`)
        if (!Array.isArray(entry.findings)) issues.push(`findings must be an array for focus ${entry.focus}`)
      }
    }
  }
  return { ok: issues.length === 0, issues }
}
