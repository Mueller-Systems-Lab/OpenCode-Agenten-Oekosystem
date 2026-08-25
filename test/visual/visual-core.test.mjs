// SPDX-License-Identifier: MIT
/**
 * Visual QA deterministic core tests — catalog vision attribute, routing
 * needs_vision requirement, visual finding contract, and visual gate.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MODEL_CATALOG,
  CATALOG_VERSION,
  getCatalogEntry,
} from '../../runtime/routing/model-catalog.mjs'
import { modelMeetsRequirements, selectRoute } from '../../runtime/routing/routing-policy.mjs'
import {
  VISUAL_FINDING_CONTRACT_ID,
  VISUAL_FINDING_CATEGORIES,
  createVisualFinding,
  validateVisualFinding,
} from '../../runtime/visual/visual-finding.mjs'
import { evaluateVisualGate, VISUAL_GATE_OUTCOMES } from '../../runtime/visual/visual-gate.mjs'
import * as reviewContract from '../../runtime/contracts/review.mjs'

const VISION_MODEL = { provider: 'openai', model: 'gpt-5.4-mini' }

describe('visual core — model catalog vision attribute', () => {
  it('gpt-5.4-mini is the only vision_support entry (real probe evidence)', () => {
    const visionEntry = getCatalogEntry(DEFAULT_MODEL_CATALOG, VISION_MODEL.provider, VISION_MODEL.model)
    assert.ok(visionEntry, 'gpt-5.4-mini must exist in the canonical catalog')
    assert.equal(visionEntry.vision_support, true)
    const others = DEFAULT_MODEL_CATALOG.filter((entry) => !(entry.provider === VISION_MODEL.provider && entry.model === VISION_MODEL.model))
    for (const entry of others) {
      assert.equal(entry.vision_support, false, `${entry.provider}/${entry.model} must not claim unproven vision capability`)
    }
    assert.equal(DEFAULT_MODEL_CATALOG.length, others.length + 1, 'exactly one entry may be vision-capable')
  })

  it('every catalog entry carries an explicit boolean vision_support (no undefined)', () => {
    for (const entry of DEFAULT_MODEL_CATALOG) {
      assert.equal(typeof entry.vision_support, 'boolean', `${entry.provider}/${entry.model} vision_support must be explicit`)
    }
  })

  it('CATALOG_VERSION is bumped to 1.2.0 for the additive opencode inventory', () => {
    assert.equal(CATALOG_VERSION, '1.2.0')
  })
})

describe('visual core — routing needs_vision requirement', () => {
  it('rejects a reachable+enabled text-only model when needs_vision=true', () => {
    const entry = getCatalogEntry(DEFAULT_MODEL_CATALOG, 'deepseek', 'deepseek-v4-flash')
    assert.equal(entry.enabled, true)
    assert.equal(entry.availability, 'reachable')
    assert.equal(entry.vision_support, false)
    assert.equal(modelMeetsRequirements(entry, { needs_vision: true }), false)
  })

  it('accepts gpt-5.4-mini at availability reachable when needs_vision=true', () => {
    const promoted = { ...getCatalogEntry(DEFAULT_MODEL_CATALOG, VISION_MODEL.provider, VISION_MODEL.model), availability: 'reachable' }
    assert.equal(promoted.availability, 'reachable')
    assert.equal(modelMeetsRequirements(promoted, { needs_vision: true }), true)
  })

  it('§81 text-only catalog denies every route when needs_vision=true', () => {
    const textOnlyCatalog = DEFAULT_MODEL_CATALOG.map((entry) => ({
      ...entry,
      enabled: true,
      availability: 'reachable',
      vision_support: false,
    }))
    const result = selectRoute({ requirements: { needs_vision: true }, catalog: textOnlyCatalog })
    const unusable = result.ok === false || !result.route || !result.route.model
    assert.ok(unusable, `no usable route may be returned for a text-only catalog with needs_vision=true (got ${JSON.stringify(result)})`)
  })

  it('explicit text-only override fails ROUTING_CAPABILITY_INCOMPATIBLE when needs_vision=true', () => {
    const result = selectRoute({
      requirements: { needs_vision: true },
      explicit_override: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'ROUTING_CAPABILITY_INCOMPATIBLE')
  })
})

describe('visual core — visual finding contract', () => {
  const baseInput = {
    run_id: 'run-vf-1',
    category: 'LAYOUT_OVERLAP',
    severity: 'HIGH',
    blocking: true,
    page: 'https://example.test/dashboard',
    viewport: { width: 1280, height: 720 },
    evidence_ref: 'evidence/visual/run-vf-1/dashboard-1280.png',
    description: 'Submit button overlaps the status banner.',
    expected: 'Submit button sits below the status banner.',
    observed: 'Submit button intersects the status banner bounding box.',
    confidence: 0.92,
  }

  it('create + validate happy path is ok:true with full contract shape', () => {
    const finding = createVisualFinding(baseInput)
    assert.equal(finding.contract, VISUAL_FINDING_CONTRACT_ID)
    assert.match(finding.finding_id, /^vf-[0-9a-f-]{36}$/)
    assert.equal(finding.run_id, baseInput.run_id)
    assert.equal(finding.category, baseInput.category)
    assert.equal(finding.severity, baseInput.severity)
    assert.equal(finding.blocking, true)
    assert.equal(finding.page, baseInput.page)
    assert.deepEqual(finding.viewport, baseInput.viewport)
    assert.equal(finding.evidence_ref, baseInput.evidence_ref)
    assert.equal(finding.confidence, 0.92)
    assert.equal(finding.locator, null)
    assert.equal(finding.bounding_region, null)
    const validation = validateVisualFinding(finding)
    assert.deepEqual(validation, { ok: true, issues: [] })
  })

  it('rejects an unknown category', () => {
    const finding = createVisualFinding(baseInput)
    const bad = { ...finding, category: 'NOT_A_REAL_CATEGORY' }
    const validation = validateVisualFinding(bad)
    assert.equal(validation.ok, false)
    assert.ok(validation.issues.some((issue) => issue.includes('category must be one of')))
    assert.ok(VISUAL_FINDING_CATEGORIES.includes('UNVERIFIED_VISUAL_BOUNDARY'))
  })

  it('rejects confidence outside [0, 1] (1.5)', () => {
    const finding = createVisualFinding(baseInput)
    const validation = validateVisualFinding({ ...finding, confidence: 1.5 })
    assert.equal(validation.ok, false)
    assert.ok(validation.issues.some((issue) => issue.includes('confidence')))
  })

  it('rejects a missing evidence_ref', () => {
    const finding = createVisualFinding(baseInput)
    const validation = validateVisualFinding({ ...finding, evidence_ref: '' })
    assert.equal(validation.ok, false)
    assert.ok(validation.issues.some((issue) => issue.includes('evidence_ref')))
  })
})

describe('visual core — visual gate', () => {
  const gateFinding = (overrides = {}) => createVisualFinding({
    run_id: 'run-gate-1',
    category: 'CLIPPING',
    severity: 'LOW',
    blocking: false,
    page: 'https://example.test/page',
    viewport: { width: 1280, height: 720 },
    evidence_ref: 'evidence/visual/run-gate-1/page.png',
    description: 'Clipped label on the right edge.',
    expected: 'Label fully visible.',
    observed: 'Label clipped by 4px.',
    confidence: 0.8,
    ...overrides,
  })

  it('empty findings PASS the gate', () => {
    const result = evaluateVisualGate({ findings: [] })
    assert.equal(result.outcome, 'PASS')
    assert.equal(result.gate_passed, true)
    assert.deepEqual(result.blocking_findings, [])
    assert.equal(result.highest_severity, 'INFO')
    assert.equal(result.reason_code, 'VISUAL_QA_CLEAN')
  })

  it('one blocking HIGH finding → FINDINGS_BLOCKING', () => {
    const blockingHigh = gateFinding({ severity: 'HIGH', blocking: true })
    const lowNoise = gateFinding({ category: 'CONTRAST_RISK', severity: 'LOW', blocking: false })
    const result = evaluateVisualGate({ findings: [lowNoise, blockingHigh] })
    assert.equal(result.outcome, 'FINDINGS_BLOCKING')
    assert.equal(result.gate_passed, false)
    assert.equal(result.blocking_findings.length, 1)
    assert.equal(result.blocking_findings[0].finding_id, blockingHigh.finding_id)
    assert.equal(result.highest_severity, 'HIGH')
    assert.equal(result.reason_code, 'BLOCKING_VISUAL_FINDING')
  })

  it('LOW non-blocking findings → FINDINGS_NON_BLOCKING', () => {
    const result = evaluateVisualGate({ findings: [gateFinding()] })
    assert.equal(result.outcome, 'FINDINGS_NON_BLOCKING')
    assert.equal(result.gate_passed, false)
    assert.deepEqual(result.blocking_findings, [])
    assert.equal(result.highest_severity, 'LOW')
    assert.equal(result.reason_code, 'NON_BLOCKING_VISUAL_FINDINGS')
  })

  it('unverified_reason → UNVERIFIED (never a PASS)', () => {
    const result = evaluateVisualGate({ findings: [], unverified_reason: 'browser capture unavailable in this environment' })
    assert.equal(result.outcome, 'UNVERIFIED')
    assert.equal(result.gate_passed, false)
    assert.deepEqual(result.blocking_findings, [])
    assert.equal(result.highest_severity, 'MEDIUM')
    assert.equal(result.reason_code, 'UNVERIFIED_VISUAL_BOUNDARY')
  })

  it('§43 confidence invariance: confidence never changes outcome or highest_severity', () => {
    const highConfidence = gateFinding({ confidence: 0.99 })
    const lowConfidence = gateFinding({ confidence: 0.1 })
    const a = evaluateVisualGate({ findings: [highConfidence] })
    const b = evaluateVisualGate({ findings: [lowConfidence] })
    assert.deepEqual(
      { outcome: a.outcome, gate_passed: a.gate_passed, highest_severity: a.highest_severity, reason_code: a.reason_code },
      { outcome: b.outcome, gate_passed: b.gate_passed, highest_severity: b.highest_severity, reason_code: b.reason_code },
    )
    // Same invariance for a blocking HIGH finding.
    const c = evaluateVisualGate({ findings: [gateFinding({ severity: 'HIGH', blocking: true, confidence: 0.99 })] })
    const d = evaluateVisualGate({ findings: [gateFinding({ severity: 'HIGH', blocking: true, confidence: 0.1 })] })
    assert.equal(c.outcome, d.outcome)
    assert.equal(c.highest_severity, d.highest_severity)
  })

  it('gate outcomes are the closed frozen set', () => {
    assert.deepEqual([...VISUAL_GATE_OUTCOMES], ['PASS', 'FINDINGS_BLOCKING', 'FINDINGS_NON_BLOCKING', 'UNVERIFIED'])
  })
})

describe('visual core — review contract visual type', () => {
  it('review_type visual is accepted by ecosystem.review.v1', () => {
    assert.ok(reviewContract.REVIEW_TYPES.includes('visual'))
    const review = reviewContract.create({ run_id: 'run-review-1', review_type: 'visual' })
    const validation = reviewContract.validate(review)
    assert.deepEqual(validation, { ok: true, issues: [] })
    assert.equal(review.review_type, 'visual')
  })
})
