// SPDX-License-Identifier: MIT
/**
 * ecosystem.visual-severity-calibration.v1 — Deterministic severity calibration
 *
 * Vision model DETECTS and DESCRIBES. Runtime NORMALIZES and SCORES.
 * Model severity MUST NOT be final. This is a rule-based deterministic policy,
 * NOT an AI agent. Separate model_severity (raw) from calibrated_severity (deterministic).
 * Gate uses calibrated_severity.
 *
 * Priority order is deterministic and documented in calibrateSeverity.
 */

import { severityRank } from '../controller/severity.mjs'

export const SEVERITY_CALIBRATION_VERSION = '1.0.0'
export const CALIBRATION_CONFIDENCE_FLOOR = 0.4
export const CALIBRATION_LOW_CONFIDENCE_FLOOR = 0.2

export const CATEGORY_BASE_SEVERITY = Object.freeze({
  LAYOUT_OVERLAP: 'HIGH',
  INVISIBLE_INTERACTIVE_ELEMENT: 'HIGH',
  MISSING_ELEMENT: 'HIGH',
  UNEXPECTED_MODAL_OR_OVERLAY: 'HIGH',
  RESPONSIVE_BREAKPOINT_FAILURE: 'HIGH',
  CLIPPING: 'MEDIUM',
  VISUAL_OVERFLOW: 'MEDIUM',
  TEXT_TRUNCATION: 'MEDIUM',
  BROKEN_ALIGNMENT: 'MEDIUM',
  OFFSCREEN_CONTENT: 'MEDIUM',
  CONTRAST_RISK: 'LOW',
  VISUAL_REGRESSION: 'MEDIUM',
  UNVERIFIED_VISUAL_BOUNDARY: 'MEDIUM',
})

const SEVERITY_ORDER = Object.freeze(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])

export function severityRankLocal(sev) {
  return severityRank(sev)
}

function maxSeverity(a, b) {
  return severityRank(a) >= severityRank(b) ? a : b
}

function raiseOneLevel(sev) {
  const idx = SEVERITY_ORDER.indexOf(sev)
  if (idx === -1) return sev
  if (idx >= SEVERITY_ORDER.length - 1) return sev
  return SEVERITY_ORDER[idx + 1]
}

const VALID_CONTENT_LOSS = Object.freeze(['NONE', 'PARTIAL', 'COMPLETE'])

export function calibrateSeverity({
  category,
  model_severity,
  interaction_blocked = false,
  content_loss = 'NONE',
  affected_viewport_count = 1,
  total_viewports = 1,
  critical_target = false,
  functional_accessibility = false,
  confidence = 1,
} = {}) {
  // 1. Validate category and content_loss; invalid category falls back to 'MEDIUM' base.
  const validCategory = typeof category === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_BASE_SEVERITY, category)
  const normalizedCategory = validCategory ? category : category
  const base = (typeof category === 'string' && CATEGORY_BASE_SEVERITY[category]) ? CATEGORY_BASE_SEVERITY[category] : 'MEDIUM'

  let normalizedContentLoss = content_loss
  if (!VALID_CONTENT_LOSS.includes(content_loss)) {
    normalizedContentLoss = 'NONE'
  }

  // Normalize numeric inputs
  let avc = Number(affected_viewport_count)
  if (!Number.isFinite(avc) || avc < 0) avc = 1
  else avc = Math.trunc(avc)

  let tv = Number(total_viewports)
  if (!Number.isFinite(tv) || tv < 1) tv = 1
  else tv = Math.trunc(tv)

  let conf = Number(confidence)
  if (!Number.isFinite(conf)) conf = 1

  const crit = critical_target === true
  const blocked = interaction_blocked === true
  const funcAccess = functional_accessibility === true

  let calibrated = base
  let rule = 'CATEGORY_BASE'

  // Track if critical_target already applied in step 3/4 to avoid double nudge
  let criticalAlreadyApplied = false

  // 3. interaction_blocked
  if (blocked === true) {
    if (crit === true) {
      calibrated = 'CRITICAL'
      rule = 'INTERACTION_BLOCKED_CRITICAL_TARGET'
      criticalAlreadyApplied = true
    } else {
      calibrated = maxSeverity(base, 'HIGH')
      rule = 'INTERACTION_BLOCKED'
    }
  } else if (normalizedContentLoss === 'COMPLETE') {
    // 4. content_loss COMPLETE
    if (crit === true) {
      calibrated = 'CRITICAL'
      rule = 'CONTENT_LOSS_COMPLETE_CRITICAL_TARGET'
      criticalAlreadyApplied = true
    } else {
      calibrated = maxSeverity(base, 'HIGH')
      rule = 'CONTENT_LOSS_COMPLETE'
    }
  } else if (normalizedContentLoss === 'PARTIAL') {
    // 5. content_loss PARTIAL
    calibrated = maxSeverity(base, 'MEDIUM')
    rule = 'CONTENT_LOSS_PARTIAL'
  } else {
    // 6. base
    calibrated = base
    rule = 'CATEGORY_BASE'
  }

  // 7. Responsive scope nudge: if defect affects ALL viewports when total>1, nudge up one level bounded
  if (avc === tv && tv > 1 && calibrated !== 'CRITICAL') {
    calibrated = raiseOneLevel(calibrated)
    rule = `${rule}+RESPONSIVE_FULL_MATRIX`
  }

  // 8. Critical target nudge (if not already applied in step 3/4 and critical_target)
  if (crit === true && !criticalAlreadyApplied) {
    if (calibrated !== 'CRITICAL') {
      calibrated = raiseOneLevel(calibrated)
      rule = `${rule}+CRITICAL_TARGET`
    }
  }

  // 9. Functional accessibility: if true and calibrated is LOW/MEDIUM → raise to at least MEDIUM/HIGH respectively
  if (funcAccess === true) {
    if (calibrated === 'LOW') {
      calibrated = 'MEDIUM'
      // no suffix per spec; keep rule as is, but we could optionally append
    } else if (calibrated === 'MEDIUM') {
      calibrated = 'HIGH'
    }
  }

  // 10. Confidence handling (never lowers calibrated_severity)
  const low_confidence = conf < CALIBRATION_CONFIDENCE_FLOOR
  const review_required = conf < CALIBRATION_LOW_CONFIDENCE_FLOOR && severityRank(calibrated) >= severityRank('HIGH')

  return {
    calibrated_severity: calibrated,
    model_severity: model_severity,
    calibration_rule: rule,
    calibration_inputs: {
      category,
      interaction_blocked: blocked,
      content_loss: normalizedContentLoss,
      affected_viewport_count: avc,
      total_viewports: tv,
      critical_target: crit,
      functional_accessibility: funcAccess,
      confidence: conf,
    },
    review_required,
    low_confidence,
  }
}
