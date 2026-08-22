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
} = {}) {
  return {
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
  return { ok: issues.length === 0, issues }
}
