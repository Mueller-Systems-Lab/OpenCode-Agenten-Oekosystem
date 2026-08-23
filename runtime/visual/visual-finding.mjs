// SPDX-License-Identifier: MIT
/**
 * ecosystem.visual-finding.v1 — Playwright Visual QA finding data contract.
 *
 * Pure deterministic data contract: creation + validation only. Browser
 * capture and vision-model calls live outside this module (later capsule).
 *
 * Reality contract:
 *   - categories are a closed set; unknown categories fail validation.
 *   - severity uses the canonical ordinal SEVERITIES from ecosystem.review.v1.
 *   - confidence is a probability in [0, 1] and NEVER influences severity or
 *     any downstream gate decision (§43).
 */
import { randomUUID } from 'node:crypto'
import { SEVERITIES } from '../contracts/review.mjs'

export const VISUAL_FINDING_CONTRACT_ID = 'ecosystem.visual-finding.v1'

export const VISUAL_FINDING_CATEGORIES = Object.freeze([
  'LAYOUT_OVERLAP',
  'CLIPPING',
  'OFFSCREEN_CONTENT',
  'BROKEN_ALIGNMENT',
  'MISSING_ELEMENT',
  'VISUAL_OVERFLOW',
  'RESPONSIVE_BREAKPOINT_FAILURE',
  'TEXT_TRUNCATION',
  'INVISIBLE_INTERACTIVE_ELEMENT',
  'CONTRAST_RISK',
  'UNEXPECTED_MODAL_OR_OVERLAY',
  'VISUAL_REGRESSION',
  'UNVERIFIED_VISUAL_BOUNDARY',
])

export const VISUAL_FINDING_EXTENDED_FIELDS = Object.freeze([
  'model_severity',
  'calibrated_severity',
  'affected_viewports',
  'unaffected_viewports',
  'correlated_finding_id',
  'semantic_target',
  'interaction_blocked',
  'content_loss',
  'critical_target',
  'review_required',
  'low_confidence',
  'correlation_confidence',
])

export function createVisualFinding({
  run_id,
  category,
  severity,
  blocking,
  page,
  viewport,
  evidence_ref,
  description,
  expected,
  observed,
  confidence,
  locator = null,
  bounding_region = null,
  // Optional extended calibration/correlation fields (backward compatible)
  model_severity,
  calibrated_severity,
  affected_viewports,
  unaffected_viewports,
  correlated_finding_id,
  semantic_target,
  interaction_blocked,
  content_loss,
  critical_target,
  review_required,
  low_confidence,
  correlation_confidence,
} = {}) {
  const base = {
    contract: VISUAL_FINDING_CONTRACT_ID,
    finding_id: `vf-${randomUUID()}`,
    run_id,
    category,
    severity,
    blocking: Boolean(blocking),
    page,
    viewport,
    evidence_ref,
    description,
    expected,
    observed,
    confidence: Number(confidence),
    locator,
    bounding_region,
  }
  if (model_severity !== undefined) base.model_severity = model_severity
  if (calibrated_severity !== undefined) base.calibrated_severity = calibrated_severity
  if (affected_viewports !== undefined) base.affected_viewports = affected_viewports
  if (unaffected_viewports !== undefined) base.unaffected_viewports = unaffected_viewports
  if (correlated_finding_id !== undefined) base.correlated_finding_id = correlated_finding_id
  if (semantic_target !== undefined) base.semantic_target = semantic_target
  if (interaction_blocked !== undefined) base.interaction_blocked = interaction_blocked
  if (content_loss !== undefined) base.content_loss = content_loss
  if (critical_target !== undefined) base.critical_target = critical_target
  if (review_required !== undefined) base.review_required = review_required
  if (low_confidence !== undefined) base.low_confidence = low_confidence
  if (correlation_confidence !== undefined) base.correlation_confidence = correlation_confidence
  return base
}

export function validateVisualFinding(value) {
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['visual finding must be an object'] }
  }
  if (value.contract !== VISUAL_FINDING_CONTRACT_ID) issues.push(`contract must be ${VISUAL_FINDING_CONTRACT_ID}`)
  for (const field of ['finding_id', 'run_id', 'category', 'page', 'evidence_ref', 'description', 'expected', 'observed']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) issues.push(`${field} must be a non-empty string`)
  }
  if (!VISUAL_FINDING_CATEGORIES.includes(value.category)) issues.push(`category must be one of ${VISUAL_FINDING_CATEGORIES.join(', ')}`)
  if (!SEVERITIES.includes(value.severity)) issues.push(`severity must be one of ${SEVERITIES.join(', ')}`)
  if (typeof value.blocking !== 'boolean') issues.push('blocking must be a boolean')
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    issues.push('confidence must be a number in [0, 1]')
  }
  // Extended optional fields — validate only if present (backward compatible)
  if (value.model_severity !== undefined && !SEVERITIES.includes(value.model_severity)) {
    issues.push(`model_severity must be one of ${SEVERITIES.join(', ')} if present`)
  }
  if (value.calibrated_severity !== undefined && !SEVERITIES.includes(value.calibrated_severity)) {
    issues.push(`calibrated_severity must be one of ${SEVERITIES.join(', ')} if present`)
  }
  if (value.affected_viewports !== undefined) {
    if (!Array.isArray(value.affected_viewports) || !value.affected_viewports.every((v) => typeof v === 'string')) {
      issues.push('affected_viewports must be an array of strings if present')
    }
  }
  if (value.unaffected_viewports !== undefined) {
    if (!Array.isArray(value.unaffected_viewports) || !value.unaffected_viewports.every((v) => typeof v === 'string')) {
      issues.push('unaffected_viewports must be an array of strings if present')
    }
  }
  if (value.correlated_finding_id !== undefined && (typeof value.correlated_finding_id !== 'string' || value.correlated_finding_id.trim().length === 0)) {
    issues.push('correlated_finding_id must be a non-empty string if present')
  }
  if (value.semantic_target !== undefined && typeof value.semantic_target !== 'string') {
    issues.push('semantic_target must be a string if present')
  }
  if (value.interaction_blocked !== undefined && typeof value.interaction_blocked !== 'boolean') {
    issues.push('interaction_blocked must be a boolean if present')
  }
  if (value.content_loss !== undefined && !['NONE', 'PARTIAL', 'COMPLETE'].includes(value.content_loss)) {
    issues.push('content_loss must be one of NONE, PARTIAL, COMPLETE if present')
  }
  if (value.critical_target !== undefined && typeof value.critical_target !== 'boolean') {
    issues.push('critical_target must be a boolean if present')
  }
  if (value.review_required !== undefined && typeof value.review_required !== 'boolean') {
    issues.push('review_required must be a boolean if present')
  }
  if (value.low_confidence !== undefined && typeof value.low_confidence !== 'boolean') {
    issues.push('low_confidence must be a boolean if present')
  }
  if (value.correlation_confidence !== undefined) {
    const cc = value.correlation_confidence
    const isValidString = typeof cc === 'string' && cc.trim().length > 0
    const isValidNumber = typeof cc === 'number' && Number.isFinite(cc) && cc >= 0 && cc <= 1
    if (!isValidString && !isValidNumber) {
      issues.push('correlation_confidence must be a string or a number in [0, 1] if present')
    }
  }
  return { ok: issues.length === 0, issues }
}
