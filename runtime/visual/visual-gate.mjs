// SPDX-License-Identifier: MIT
/**
 * Deterministic Visual Gate — pure evaluation over visual findings.
 *
 * Vision model DETECTS and DESCRIBES. Runtime NORMALIZES and SCORES.
 * calibrated_severity (deterministic) is authoritative for gate decisions;
 * model severity is NOT final. Confidence never lowers severity (§38);
 * confidence influences UNVERIFIED/review-required state, not severity (§38-39).
 *
 * Severity is ordinal (severityRank); the gate fails closed:
 *   - an unverified visual boundary is never a PASS (UNVERIFIED_VISUAL_BOUNDARY)
 *   - low-confidence high-impact findings → UNVERIFIED (VISUAL_FINDING_REVIEW_REQUIRED)
 *   - any blocking finding at rank >= HIGH blocks the gate (effectiveSeverity)
 *   - non-blocking findings still fail the gate (visible, not blocking-severe)
 */
import { severityRank } from '../controller/severity.mjs'

export const VISUAL_GATE_OUTCOMES = Object.freeze([
  'PASS',
  'FINDINGS_BLOCKING',
  'FINDINGS_NON_BLOCKING',
  'UNVERIFIED',
])

function effectiveSeverity(finding) {
  if (finding && typeof finding.calibrated_severity === 'string' && finding.calibrated_severity.trim().length > 0) {
    return finding.calibrated_severity
  }
  return finding?.severity
}

function highestSeverityOf(findings) {
  let best = 'INFO'
  for (const finding of findings) {
    const sev = effectiveSeverity(finding)
    if (severityRank(sev) > severityRank(best)) best = sev
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
  // Low-confidence review-required handling: confidence influences UNVERIFIED, not severity (§38-39)
  const needsReview = list.some((finding) => finding && finding.review_required === true && severityRank(effectiveSeverity(finding)) >= severityRank('HIGH'))
  if (needsReview) {
    return {
      outcome: 'UNVERIFIED',
      gate_passed: false,
      blocking_findings: [],
      highest_severity: highestSeverityOf(list),
      reason_code: 'VISUAL_FINDING_REVIEW_REQUIRED',
    }
  }
  // blockingHigh: explicitly blocking AND at least HIGH effectiveSeverity.
  const blockingHigh = list.filter((finding) => finding && finding.blocking === true && severityRank(effectiveSeverity(finding)) >= severityRank('HIGH'))
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
