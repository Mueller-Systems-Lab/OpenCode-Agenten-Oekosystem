// SPDX-License-Identifier: MIT
/**
 * Deterministic Visual Gate — pure evaluation over visual findings.
 *
 * CONFIDENCE IS NEVER A SEVERITY INPUT (§43): confidence never influences
 * severity or the gate decision. Two findings identical except for confidence
 * produce identical outcomes and identical highest_severity.
 *
 * Severity is ordinal (severityRank); the gate fails closed:
 *   - an unverified visual boundary is never a PASS (UNVERIFIED_VISUAL_BOUNDARY)
 *   - any blocking finding at rank >= HIGH blocks the gate
 *   - non-blocking findings still fail the gate (visible, not blocking-severe)
 */
import { severityRank } from '../controller/severity.mjs'

export const VISUAL_GATE_OUTCOMES = Object.freeze([
  'PASS',
  'FINDINGS_BLOCKING',
  'FINDINGS_NON_BLOCKING',
  'UNVERIFIED',
])

function highestSeverityOf(findings) {
  let best = 'INFO'
  for (const finding of findings) {
    if (severityRank(finding.severity) > severityRank(best)) best = finding.severity
  }
  return best
}

export function evaluateVisualGate({ findings = [], unverified_reason = null } = {}) {
  if (typeof unverified_reason === 'string' && unverified_reason.trim().length > 0) {
    return {
      outcome: 'UNVERIFIED',
      gate_passed: false,
      blocking_findings: [],
      highest_severity: 'MEDIUM',
      reason_code: 'UNVERIFIED_VISUAL_BOUNDARY',
    }
  }
  const list = Array.isArray(findings) ? findings : []
  // blockingHigh: explicitly blocking AND at least HIGH severity. Confidence
  // is deliberately NOT consulted here (§43).
  const blockingHigh = list.filter((finding) => finding && finding.blocking === true && severityRank(finding.severity) >= severityRank('HIGH'))
  if (blockingHigh.length > 0) {
    return {
      outcome: 'FINDINGS_BLOCKING',
      gate_passed: false,
      blocking_findings: blockingHigh,
      highest_severity: highestSeverityOf(list),
      reason_code: 'BLOCKING_VISUAL_FINDING',
    }
  }
  if (list.length > 0) {
    return {
      outcome: 'FINDINGS_NON_BLOCKING',
      gate_passed: false,
      blocking_findings: [],
      highest_severity: highestSeverityOf(list),
      reason_code: 'NON_BLOCKING_VISUAL_FINDINGS',
    }
  }
  return {
    outcome: 'PASS',
    gate_passed: true,
    blocking_findings: [],
    highest_severity: 'INFO',
    reason_code: 'VISUAL_QA_CLEAN',
  }
}
