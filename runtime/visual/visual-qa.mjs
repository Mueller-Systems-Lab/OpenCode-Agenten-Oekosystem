// SPDX-License-Identifier: MIT
/**
 * Visual QA orchestration — browser evidence + vision review + gate → review contract.
 *
 * Seams: browserExecutor + reviewFn are injectable for deterministic tests (NO real browser/model).
 * Shared budget mirrors pipeline lifecycle (reserve before review, commit/release after).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { selectRoute, DEFAULT_ROUTING_POLICY, costGateAllows } from '../routing/routing-policy.mjs'
import { DEFAULT_MODEL_CATALOG, getCatalogEntry } from '../routing/model-catalog.mjs'
import { evaluateVisualGate } from './visual-gate.mjs'
import { create as createReview } from '../contracts/review.mjs'
import { createRunEvent, appendRunEvent } from '../observability/run-events.mjs'
import { budgetSharedEvent } from '../routing/budget-governor.mjs'
import { VIEWPORTS, capturePageEvidence } from './browser-evidence.mjs'
import { reviewScreenshot } from './vision-reviewer.mjs'
import { VISUAL_FINDING_CATEGORIES } from './visual-finding.mjs'
import { SEVERITIES } from '../controller/severity.mjs'
import { CANONICAL_VIEWPORTS, resolveViewportProfile, DEFAULT_VIEWPORT_PROFILE, MAX_CUSTOM_VIEWPORTS } from './viewport-policy.mjs'
import { calibrateSeverity } from './severity-calibration.mjs'
import { correlateFindings } from './cross-viewport-correlation.mjs'

const MAX_FINDINGS_PER_RUN = 100

function buildUnverifiedReview({ run_id, reason_code, message }) {
  const findings = [{
    category: 'UNVERIFIED_VISUAL_BOUNDARY',
    severity: 'MEDIUM',
    blocking: false,
    description: message,
    confidence: 1,
    finding_id: `vf-${randomUUID()}`,
    run_id,
    page: 'unknown',
    viewport: 'unknown',
    evidence_ref: 'unverified',
    expected: 'no visual defect',
    observed: message,
    code: reason_code,
    message,
  }]
  const review = createReview({
    run_id,
    review_type: 'visual',
    review: {
      status: 'FAIL',
      severity: 'MEDIUM',
      blocking: false,
      recommendation: 'FIX',
      findings,
    },
  })
  return { review, findings }
}

export async function runVisualQa({
  run_id,
  pages = [],
  evidence_dir,
  mcp,
  grant,
  reviewer,
  requirements = { needs_vision: true },
  cost_policy = null,
  sharedBudget = null,
  healthStore = null,
  opencode_bin = null,
  browserExecutor = null,
  reviewFn = null,
  emit = null,
  viewport_profile = null,
  custom_viewports = null,
  enable_calibration = true,
  enable_correlation = true,
} = {}) {
  const start = Date.now()
  if (!run_id || typeof run_id !== 'string' || run_id.trim().length === 0) {
    throw new Error('runVisualQa: run_id required')
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('runVisualQa: pages non-empty required')
  }

  const events = []
  const emitEvent = async (input) => {
    let event
    if (input.job && input.job.startsWith('budget.shared')) {
      event = budgetSharedEvent({ run_id, ...input })
    } else {
      // Ensure phase defaults to VISUAL_QA if not provided
      const phase = input.phase || 'VISUAL_QA'
      event = createRunEvent({ run_id, phase, job: input.job || 'visual.qa', status: input.status || 'PASS', attempt: 0, duration_ms: input.duration_ms || 0, ...input })
    }
    events.push(event)
    if (emit) {
      try { await emit(event) } catch {}
    }
    return event
  }

  await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.start', status: 'PASS', pages: pages.length })

  // --- Viewport resolution (before any browser work) ---
  let viewport_resolved = null
  let viewport_profile_resolved = null
  let allViewportsForCorrelation = []
  let viewportResolveResult = null
  const isProfileMode = viewport_profile !== null && viewport_profile !== undefined

  if (isProfileMode) {
    viewportResolveResult = resolveViewportProfile({ profile: viewport_profile, customViewports: custom_viewports })
    if (!viewportResolveResult.ok) {
      const reason = viewportResolveResult.code || 'VIEWPORT_MATRIX_UNBOUNDED_DENIED'
      await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.failure', status: 'FAIL', failure_signature: reason, strategy_delta: viewportResolveResult.reason || reason, code: reason })
      const { review, findings } = buildUnverifiedReview({ run_id, reason_code: reason, message: viewportResolveResult.reason || reason })
      const gate = evaluateVisualGate({ findings: [], unverified_reason: reason })
      return {
        status: 'UNVERIFIED',
        review,
        findings,
        evidence: [],
        reason_code: gate.reason_code,
        image_fingerprints: [],
        events,
        visualGate: gate,
        correlated_findings: [],
        calibration_applied: false,
        correlation_applied: false,
        viewport_profile: viewport_profile,
        viewport_matrix: [],
        viewport_resolved: [],
      }
    } else {
      viewport_resolved = viewportResolveResult.viewports
      viewport_profile_resolved = viewportResolveResult.profile
      allViewportsForCorrelation = viewport_resolved.map((v) => v.viewport_id)
    }
  } else {
    // legacy: collect unique viewport names from pages (preserve backward compat)
    const set = new Set()
    for (const p of pages) {
      const vps = Array.isArray(p.viewports) && p.viewports.length > 0 ? p.viewports : ['desktop']
      for (const v of vps) {
        if (typeof v === 'string' && v.trim().length > 0) set.add(v.trim())
        else if (v != null) set.add(String(v).trim())
      }
    }
    allViewportsForCorrelation = [...set]
    viewport_resolved = null
    viewport_profile_resolved = null
  }

  // Resolve vision route
  const catalog = reviewer?.catalog || DEFAULT_MODEL_CATALOG
  const policy = reviewer?.policy || DEFAULT_ROUTING_POLICY
  // Build health map if store available
  let healthMap = null
  if (healthStore && typeof healthStore.entries === 'function') {
    healthMap = {}
    for (const e of healthStore.entries()) {
      if (e && e.provider && e.model) healthMap[`${e.provider}/${e.model}`] = { status: e.status }
    }
  }
  // For selectRoute we need to pass health as map if available, cost_policy etc.
  const selection = selectRoute({
    requirements: { needs_vision: true },
    catalog,
    policy,
    health: healthMap,
    cost_policy: cost_policy || reviewer?.cost_policy || null,
    high_cost_routes_used: 0,
  })

  if (!selection.ok) {
    const reason_code = selection.code || 'VISUAL_MODEL_REQUIRED_CAPABILITY_UNAVAILABLE'
    await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.failure', status: 'FAIL', failure_signature: reason_code, strategy_delta: selection.reason || reason_code, code: reason_code })
    const { review, findings } = buildUnverifiedReview({ run_id, reason_code: 'VISUAL_MODEL_REQUIRED_CAPABILITY_UNAVAILABLE', message: 'no vision-capable model' })
    // For gate UNVERIFIED
    const gate = evaluateVisualGate({ findings: [], unverified_reason: reason_code })
    return {
      status: 'UNVERIFIED',
      review,
      findings,
      evidence: [],
      reason_code: gate.reason_code,
      image_fingerprints: [],
      events,
      visualGate: gate,
      correlated_findings: [],
      calibration_applied: false,
      correlation_applied: false,
      viewport_profile: viewport_profile_resolved,
      viewport_matrix: allViewportsForCorrelation,
      viewport_resolved: viewport_resolved ? [...viewport_resolved] : [],
    }
  }

  const selectedRoute = selection.route

  // Cost gate check (selectRoute already gated, but explicit check for spec)
  if (cost_policy) {
    const entry = getCatalogEntry(catalog, selectedRoute.provider, selectedRoute.model)
    if (entry && !costGateAllows({ entry, current_tier: null, cost_policy, high_cost_routes_used: 0 })) {
      const reason_code = 'COST_GATE_DENIED'
      await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.failure', status: 'FAIL', failure_signature: reason_code, code: reason_code })
      const { review, findings } = buildUnverifiedReview({ run_id, reason_code, message: 'cost gate denied vision model' })
      const gate = evaluateVisualGate({ findings: [], unverified_reason: reason_code })
      return {
        status: 'UNVERIFIED',
        review,
        findings,
        evidence: [],
        reason_code: gate.reason_code,
        image_fingerprints: [],
        events,
        visualGate: gate,
        correlated_findings: [],
        calibration_applied: false,
        correlation_applied: false,
        viewport_profile: viewport_profile_resolved,
        viewport_matrix: allViewportsForCorrelation,
        viewport_resolved: viewport_resolved ? [...viewport_resolved] : [],
      }
    }
  }

  // Shared budget: reserve before reviewer calls (one reservation per visual QA run)
  let budgetReservation = null
  if (sharedBudget?.governor && selectedRoute.cost_tier === 'HIGH') {
    const reserved = sharedBudget.governor.reserve({
      run_id,
      resource: sharedBudget.resource || 'HIGH_COST_ROUTE',
      amount: 1,
      provider: selectedRoute.provider,
      model: selectedRoute.model,
      route_index: selectedRoute.route_index || 0,
      attempt: 0,
    })
    if (!reserved.ok) {
      const code = reserved.code || 'SHARED_BUDGET_EXHAUSTED'
      await emitEvent({ job: 'budget.shared.deny', resource: sharedBudget.resource || 'HIGH_COST_ROUTE', amount: 1, remaining: reserved.remaining, code, phase: 'VISUAL_QA', provider: selectedRoute.provider, model: selectedRoute.model })
      await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.failure', status: 'FAIL', failure_signature: 'VISUAL_QA_BUDGET_DENIED', code: 'VISUAL_QA_BUDGET_DENIED', reason: code })
      const { review, findings } = buildUnverifiedReview({ run_id, reason_code: 'VISUAL_QA_BUDGET_DENIED', message: 'shared budget denied for visual QA' })
      const gate = evaluateVisualGate({ findings: [], unverified_reason: 'VISUAL_QA_BUDGET_DENIED' })
      return {
        status: 'UNVERIFIED',
        review,
        findings,
        evidence: [],
        reason_code: gate.reason_code,
        image_fingerprints: [],
        events,
        visualGate: gate,
        correlated_findings: [],
        calibration_applied: false,
        correlation_applied: false,
        viewport_profile: viewport_profile_resolved,
        viewport_matrix: allViewportsForCorrelation,
        viewport_resolved: viewport_resolved ? [...viewport_resolved] : [],
      }
    }
    budgetReservation = reserved.reservation
    await emitEvent({ job: 'budget.shared.reserve', reservation: budgetReservation, resource: sharedBudget.resource || 'HIGH_COST_ROUTE', amount: 1, remaining: reserved.remaining, status: 'RESERVED', provider: selectedRoute.provider, model: selectedRoute.model, route_index: selectedRoute.route_index || 0, phase: 'VISUAL_QA' })
  }

  // Ensure evidence dir
  const evDir = evidence_dir || path.join(process.cwd(), '.agent-governance', 'evidence', 'visual', run_id)
  await fs.mkdir(evDir, { recursive: true, mode: 0o700 })

  const allFindings = []
  const evidence = []
  const image_fingerprints = []
  let unverified_reason = null
  let browserFailureCode = null
  let reviewFailureCode = null

  // Per page × viewport — profile mode uses resolved matrix, legacy uses per-page viewports
  for (const page of pages) {
    let viewportsToIterate
    let isProfileIter = false
    if (isProfileMode && viewport_resolved) {
      viewportsToIterate = viewport_resolved
      isProfileIter = true
    } else {
      const raw = Array.isArray(page.viewports) && page.viewports.length > 0 ? page.viewports : ['desktop']
      viewportsToIterate = raw
      isProfileIter = false
    }

    for (const vpEntry of viewportsToIterate) {
      let vpName
      let viewport
      if (isProfileIter) {
        // vpEntry is { viewport_id, width, height }
        vpName = vpEntry.viewport_id
        viewport = { name: vpName, width: vpEntry.width, height: vpEntry.height }
      } else {
        vpName = String(vpEntry)
        const vpDef = VIEWPORTS[vpName] || VIEWPORTS.desktop
        viewport = { name: vpName, width: vpDef.width, height: vpDef.height }
      }

      await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.browser.ready', status: 'PASS', page: page.name, viewport: vpName })

      // Browser capture
      let capture
      if (browserExecutor) {
        try {
          capture = await browserExecutor({ run_id, page, viewport, grant, evidence_dir: evDir, server: mcp?.server, mcpCommand: mcp?.command, mcpArgs: mcp?.args })
        } catch (e) {
          capture = { ok: false, failure_class: 'BROWSER_MCP_UNAVAILABLE', reason: e.message }
        }
      } else {
        // Normalize page url: pages carry `path` (absolute file path) in the runner; browser-evidence needs `url` (file://)
        const pageForCapture = page?.url ? page : (page?.path ? { ...page, url: 'file://' + String(page.path) } : page)
        capture = await capturePageEvidence({
          run_id,
          page: pageForCapture,
          viewport,
          grant,
          server: mcp?.server || 'playwright',
          mcpCommand: mcp?.command,
          mcpArgs: mcp?.args || [],
          evidence_dir: evDir,
          timeout_ms: reviewer?.timeout_ms || 15000,
        })
      }

      if (!capture || capture.ok !== true) {
        const code = capture?.failure_class || 'BROWSER_MCP_UNAVAILABLE'
        browserFailureCode = code
        unverified_reason = code
        evidence.push({ page: page.name, viewport: vpName, viewport_id: vpName, width: viewport.width, height: viewport.height, ok: false, failure_class: code, reason: capture?.reason || code })
        await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.failure', status: 'FAIL', failure_signature: code, page: page.name, viewport: vpName, code })
        continue
      }

      evidence.push({ page: page.name, viewport: vpName, viewport_id: vpName, width: viewport.width, height: viewport.height, ok: true, screenshot_path: capture.screenshot_path, image_fingerprint: capture.image_fingerprint, snapshot_chars: capture.snapshot_text ? capture.snapshot_text.length : 0, duration_ms: capture.duration_ms })
      image_fingerprints.push(capture.image_fingerprint)
      await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.screenshot', status: 'PASS', page: page.name, viewport: vpName, image_fingerprint: capture.image_fingerprint, duration_ms: capture.duration_ms })

      // Review screenshot
      let reviewResult
      if (reviewFn) {
        try {
          reviewResult = await reviewFn({ run_id, page: page.name, viewport: vpName, screenshot_path: capture.screenshot_path, image_fingerprint: capture.image_fingerprint, categories: VISUAL_FINDING_CATEGORIES, workdir: reviewer?.workdir, model: { provider: selectedRoute.provider, model: selectedRoute.model } })
        } catch (e) {
          reviewResult = { ok: false, failure_class: 'VISION_MODEL_UNAVAILABLE', reason: e.message }
        }
      } else {
        reviewResult = await reviewScreenshot({
          run_id,
          page: page.name,
          viewport: vpName,
          screenshot_path: capture.screenshot_path,
          image_fingerprint: capture.image_fingerprint,
          categories: [...VISUAL_FINDING_CATEGORIES],
          workdir: reviewer?.workdir,
          model: { provider: selectedRoute.provider, model: selectedRoute.model },
          opencode_bin,
          timeout_ms: reviewer?.timeout_ms || 90000,
        })
      }

      if (!reviewResult || reviewResult.ok !== true) {
        const code = reviewResult?.failure_class || 'VISION_REVIEW_INVALID'
        reviewFailureCode = code
        if (!unverified_reason) unverified_reason = code
        // Emit review failure but keep as UNVERIFIED
        await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.review.result', status: 'FAIL', page: page.name, viewport: vpName, failure_signature: code, image_fingerprint: capture.image_fingerprint, review_provider: selectedRoute.provider, review_model: selectedRoute.model, duration_ms: reviewResult?.duration_ms || 0 })
        continue
      }

      // Cap findings per run
      for (const f of reviewResult.findings || []) {
        if (allFindings.length >= MAX_FINDINGS_PER_RUN) break
        // Enrich finding_id and run_id if missing, and ensure page/viewport identity
        const enriched = { ...f }
        if (!enriched.finding_id) enriched.finding_id = `vf-${randomUUID()}`
        if (!enriched.run_id) enriched.run_id = run_id
        if (!enriched.page) enriched.page = page.name
        if (!enriched.viewport) enriched.viewport = vpName
        // ensure viewport_id also present for correlation fallback (correlate looks at viewport || viewport_id)
        if (!enriched.viewport_id) enriched.viewport_id = vpName
        // Ensure confidence within [0,1] already validated; finding shape already enriched
        allFindings.push(enriched)
      }
      const highest = reviewResult.findings.reduce((max, cur) => {
        const rank = SEVERITIES.indexOf(cur.severity)
        const maxRank = SEVERITIES.indexOf(max)
        return rank > maxRank ? cur.severity : max
      }, 'INFO')
      await emitEvent({
        phase: 'VISUAL_QA',
        job: 'visual.qa.review.result',
        status: 'PASS',
        page: page.name,
        viewport: vpName,
        finding_count: reviewResult.findings.length,
        highest_severity: reviewResult.findings.length > 0 ? highest : 'INFO',
        image_fingerprint: capture.image_fingerprint,
        review_provider: selectedRoute.provider,
        review_model: selectedRoute.model,
        duration_ms: reviewResult.duration_ms || 0,
      })
    }
  }

  // Shared budget commit/release after review loop
  if (budgetReservation) {
    const snapshotBefore = sharedBudget.governor.snapshot()
    const remainingBefore = snapshotBefore.resources[sharedBudget.resource || 'HIGH_COST_ROUTE']?.remaining ?? null
    // If we had a browser/review failure before invocation? We already invoked browser+review, so commit (resource consumed) unless we never attempted? For simplicity commit on any path where we attempted work.
    // If unverified due to browser unavailable before any review, we still consumed reservation? Pipeline mirrors: pre-invocation failure → release, productive invocation → commit. Here productive = we attempted browser capture. So commit.
    const committed = sharedBudget.governor.commit({ reservation_id: budgetReservation.reservation_id, run_id })
    if (committed.ok) {
      const snapshot = sharedBudget.governor.snapshot()
      const remaining = snapshot.resources[sharedBudget.resource || 'HIGH_COST_ROUTE']?.remaining ?? null
      await emitEvent({ job: 'budget.shared.consume', reservation: budgetReservation, resource: sharedBudget.resource || 'HIGH_COST_ROUTE', amount: budgetReservation.amount, remaining, status: 'CONSUMED', provider: selectedRoute.provider, model: selectedRoute.model, route_index: selectedRoute.route_index || 0, phase: 'VISUAL_QA' })
    } else {
      await emitEvent({ job: 'budget.shared.deny', resource: sharedBudget.resource || 'HIGH_COST_ROUTE', amount: budgetReservation.amount, remaining: remainingBefore, code: committed.code, provider: selectedRoute.provider, model: selectedRoute.model, route_index: selectedRoute.route_index || 0, phase: 'VISUAL_QA' })
    }
  }

  // --- Calibration pass (if enable_calibration) ---
  let calibrationApplied = false
  if (enable_calibration) {
    calibrationApplied = true
    for (const finding of allFindings) {
      const originalSeverity = finding.severity
      // Derive deterministic signals (best-effort, no LLM) — page text never authority (§63)
      const category = finding.category
      const model_severity = originalSeverity
      const interaction_blocked = finding.interaction_blocked ?? finding.blocking ?? false
      let content_loss = finding.content_loss
      if (content_loss == null) {
        if (finding.category === 'MISSING_ELEMENT') content_loss = 'COMPLETE'
        else if (finding.category === 'CLIPPING') content_loss = 'PARTIAL'
        else content_loss = 'NONE'
      }
      const affected_viewport_count = 1
      const total_viewports = allViewportsForCorrelation.length || 1
      let critical_target
      if (typeof finding.critical_target === 'boolean') {
        critical_target = finding.critical_target
      } else {
        let isCritical = false
        if (finding.locator != null) {
          const locStr = String(finding.locator).toLowerCase()
          if (locStr.includes('submit')) isCritical = true
          else {
            // handle object locator via JSON stringify
            if (typeof finding.locator === 'object') {
              try {
                const json = JSON.stringify(finding.locator).toLowerCase()
                if (json.includes('submit')) isCritical = true
              } catch {}
            }
          }
        }
        const descLower = String(finding.description || '').toLowerCase()
        if (descLower.includes('submit') || descLower.includes('primary')) isCritical = true
        critical_target = isCritical
      }
      const functional_accessibility = finding.functional_accessibility ?? false
      const confidence = finding.confidence

      const calibrated = calibrateSeverity({
        category,
        model_severity,
        interaction_blocked,
        content_loss,
        affected_viewport_count,
        total_viewports,
        critical_target,
        functional_accessibility,
        confidence,
      })

      // Enrich finding: keep raw vs calibrated separated, gate uses calibrated
      finding.model_severity = originalSeverity
      finding.calibrated_severity = calibrated.calibrated_severity
      finding.calibration_rule = calibrated.calibration_rule
      finding.calibration_inputs = calibrated.calibration_inputs
      finding.review_required = calibrated.review_required
      finding.low_confidence = calibrated.low_confidence
      // Set severity to calibrated for backward compat (old gate); new gate uses calibrated_severity
      finding.severity = calibrated.calibrated_severity
      // Also ensure interaction_blocked / content_loss / critical_target fields are persisted for audit
      if (finding.interaction_blocked == null) finding.interaction_blocked = interaction_blocked
      if (finding.content_loss == null) finding.content_loss = content_loss
      if (finding.critical_target == null) finding.critical_target = critical_target
      if (finding.functional_accessibility == null) finding.functional_accessibility = functional_accessibility
    }
  }

  // --- Correlation pass (if enable_correlation and findings exist) ---
  let correlatedFindings = []
  let correlationApplied = false
  if (enable_correlation && allFindings.length > 0) {
    correlationApplied = true
    try {
      const result = correlateFindings({ findings: allFindings, allViewports: allViewportsForCorrelation })
      correlatedFindings = result.correlated || []
    } catch (e) {
      correlatedFindings = []
      // correlation failure should not block gate; log as event?
      await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.correlation.failure', status: 'FAIL', failure_signature: e.message || 'CORRELATION_FAILURE', code: 'CORRELATION_FAILURE' })
    }
  } else if (enable_correlation) {
    // enabled but no findings -> still considered applied but empty
    correlationApplied = true
    correlatedFindings = []
  }

  // Aggregate gate - uses flat calibrated findings
  const gate = evaluateVisualGate({ findings: allFindings, unverified_reason })
  let finalFindings = allFindings
  let gateOutcome = gate.outcome
  let reason_code = gate.reason_code

  if (unverified_reason) {
    // Ensure UNVERIFIED findings shape
    const unverifiedFinding = {
      category: 'UNVERIFIED_VISUAL_BOUNDARY',
      severity: 'MEDIUM',
      blocking: false,
      description: unverified_reason,
      confidence: 1,
      finding_id: `vf-${randomUUID()}`,
      run_id,
      page: evidence[0]?.page || 'unknown',
      viewport: evidence[0]?.viewport || 'unknown',
      evidence_ref: evidence.find((e) => e.screenshot_path)?.screenshot_path || 'unverified',
      expected: 'no visual defect',
      observed: unverified_reason,
      code: unverified_reason,
      message: unverified_reason,
    }
    finalFindings = [unverifiedFinding]
    gateOutcome = 'UNVERIFIED'
    reason_code = 'UNVERIFIED_VISUAL_BOUNDARY'
  }

  // Build visual review contract
  // For FINDINGS_BLOCKING we set review.blocking=true so controller's securityHardBlock triggers BLOCKED
  const isBlocking = gateOutcome === 'FINDINGS_BLOCKING'
  const reviewStatus = gate.gate_passed ? 'PASS' : 'FAIL'
  const reviewSeverity = gate.highest_severity || 'INFO'
  const recommendation = gate.gate_passed ? 'PASS' : 'FIX'

  // Map findings to review findings shape (ensure required fields)
  const reviewFindings = finalFindings.map((f) => ({
    ...f,
    finding_id: f.finding_id || `vf-${randomUUID()}`,
    run_id,
  }))

  const review = createReview({
    run_id,
    review_type: 'visual',
    review: {
      status: reviewStatus,
      severity: reviewSeverity,
      blocking: isBlocking,
      recommendation,
      findings: reviewFindings,
    },
  })

  await emitEvent({ phase: 'VISUAL_QA', job: 'visual.qa.gate', status: gate.gate_passed ? 'PASS' : 'FAIL', outcome: gateOutcome, highest_severity: reviewSeverity, finding_count: finalFindings.length, reason_code })

  return {
    status: gateOutcome,
    review,
    findings: finalFindings,
    evidence,
    reason_code,
    image_fingerprints,
    events,
    visualGate: gate,
    correlated_findings: correlatedFindings,
    calibration_applied: calibrationApplied,
    correlation_applied: correlationApplied,
    viewport_profile: viewport_profile_resolved,
    viewport_matrix: allViewportsForCorrelation,
    viewport_resolved: viewport_resolved ? [...viewport_resolved] : [],
  }
}
