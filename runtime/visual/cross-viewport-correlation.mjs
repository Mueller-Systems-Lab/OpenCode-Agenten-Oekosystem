// SPDX-License-Identifier: MIT
/**
 * ecosystem.visual.cross-viewport-correlation.v1 — deterministic cross-viewport finding correlation.
 *
 * Correlates visual findings across viewports deterministically (no LLM, no pixel coordinates).
 * Groups findings that share page, category, and normalized semantic target / DOM locator identity.
 * Fallback identity uses category + page + description fingerprint when no locator is present.
 * Conservative merging: only exact correlationKey matches are merged (KEEP_SEPARATE otherwise).
 */

import { createHash } from 'node:crypto'

export const CORRELATION_VERSION = '1.0.0'

const SEVERITY_RANK = Object.freeze({
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
})

function severityRank(value) {
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, value) ? SEVERITY_RANK[value] : -1
}

function simpleHash(str) {
  // djb2-like deterministic fallback when crypto unavailable
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    hash = hash & 0xffffffff
  }
  // Convert to hex, pad to 8 chars
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  // Expand to 12 by repeating if needed
  return (hex + hex + hex).slice(0, 12)
}

function deterministicHashHex(input) {
  try {
    return createHash('sha256').update(String(input)).digest('hex').slice(0, 12)
  } catch {
    return simpleHash(String(input))
  }
}

function hasLocator(locator) {
  if (typeof locator === 'string') {
    return locator.trim().length > 0
  }
  if (locator && typeof locator === 'object' && !Array.isArray(locator)) {
    const candidates = [
      locator.role,
      locator.accessible_name,
      locator.accessibleName,
      locator.selector,
      locator.testId,
      locator.test_id,
      locator.testID,
    ]
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return true
    }
  }
  return false
}

/**
 * Fingerprint description deterministically (for fallback identity)
 * - Lowercase, collapse whitespace, trim, slice(0,120)
 */
export function descriptionFingerprint(description) {
  if (typeof description !== 'string') return ''
  return description.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120)
}

/**
 * Normalize semantic target into stable identity key
 * locator can be string or object with { accessible_name, role, selector, testId }
 * description is the finding description
 */
export function normalizeSemanticTarget({ locator, category, description, page } = {}) {
  if (typeof locator === 'string') {
    const t = locator.trim().toLowerCase()
    if (t.length > 0) return t
  }
  if (locator && typeof locator === 'object' && !Array.isArray(locator)) {
    const parts = []
    if (typeof locator.role === 'string' && locator.role.trim().length > 0) {
      parts.push(locator.role.trim().toLowerCase())
    }
    // accessible_name variants
    if (typeof locator.accessible_name === 'string' && locator.accessible_name.trim().length > 0) {
      parts.push(locator.accessible_name.trim().toLowerCase())
    } else if (typeof locator.accessibleName === 'string' && locator.accessibleName.trim().length > 0) {
      parts.push(locator.accessibleName.trim().toLowerCase())
    }
    if (typeof locator.selector === 'string' && locator.selector.trim().length > 0) {
      parts.push(locator.selector.trim().toLowerCase())
    }
    if (typeof locator.testId === 'string' && locator.testId.trim().length > 0) {
      parts.push(locator.testId.trim().toLowerCase())
    } else if (typeof locator.test_id === 'string' && locator.test_id.trim().length > 0) {
      parts.push(locator.test_id.trim().toLowerCase())
    } else if (typeof locator.testID === 'string' && locator.testID.trim().length > 0) {
      parts.push(locator.testID.trim().toLowerCase())
    }
    if (parts.length > 0) {
      return parts.join('|')
    }
  }
  // Fallback: category + '|' + page + '|' + normalized description fingerprint (80 chars)
  const cat = typeof category === 'string' ? category.trim() : ''
  const pg = typeof page === 'string' ? page.trim() : ''
  const fp = descriptionFingerprint(description).slice(0, 80)
  // Return lowercased stable key as per spec
  return `${cat}|${pg}|${fp}`.toLowerCase()
}

/**
 * Build correlation key for grouping
 * Key = page + '|' + category + '|' + normalizeSemanticTarget(...)
 */
export function correlationKey(finding) {
  if (!finding || typeof finding !== 'object') return '||'
  const page = typeof finding.page === 'string' ? finding.page.trim() : ''
  const category = typeof finding.category === 'string' ? finding.category.trim() : ''
  const locator = finding.locator ?? finding.semantic_target ?? null
  const description = finding.description ?? ''
  const semantic = normalizeSemanticTarget({ locator, category, description, page })
  return `${page}|${category}|${semantic}`
}

/**
 * Main correlation
 */
export function correlateFindings({ findings = [], allViewports = [] } = {}) {
  const raw = Array.isArray(findings) ? findings : []
  if (raw.length === 0) {
    return {
      correlated: [],
      stats: { total_raw: 0, produced: 0, incorrect_merges: 0, missed_merges: 0 },
    }
  }

  const allVps = Array.isArray(allViewports) ? [...allViewports] : []

  // Group by correlationKey – exact match only
  const groups = new Map()
  for (const f of raw) {
    const key = correlationKey(f)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }

  const correlated = []

  for (const [key, members] of groups.entries()) {
    // representative values from first member (deterministic)
    const first = members[0] || {}
    const category = typeof first.category === 'string' ? first.category : (members.find(m => typeof m.category === 'string')?.category || '')
    const page = typeof first.page === 'string' ? first.page : (members.find(m => typeof m.page === 'string')?.page || '')

    // affected_viewports = unique sorted viewport names from members
    const affectedSet = new Set()
    for (const m of members) {
      const vp = m.viewport ?? m.viewport_id ?? null
      if (typeof vp === 'string' && vp.trim().length > 0) {
        affectedSet.add(vp.trim())
      } else if (vp != null) {
        affectedSet.add(String(vp).trim())
      }
    }
    const affected_viewports = [...affectedSet].sort()

    const unaffected_viewports = allVps.filter(v => !affectedSet.has(v))

    // severity = max severityRank across members (use calibrated_severity if present else severity)
    let bestSeverity = null
    let bestRank = -1
    for (const m of members) {
      const sev = m.calibrated_severity ?? m.severity
      const rank = severityRank(sev)
      if (rank > bestRank) {
        bestRank = rank
        bestSeverity = sev
      }
    }
    // fallback if no valid severity
    if (bestSeverity == null) bestSeverity = 'INFO'

    const blocking = members.some(m => m.blocking === true)

    // confidence = min across members (conservative), ignore non-finite
    const confidences = members
      .map(m => m.confidence)
      .filter(c => typeof c === 'number' && Number.isFinite(c))
    const confidence = confidences.length > 0 ? Math.min(...confidences) : 1

    // correlation_confidence
    const anyLocator = members.some(m => hasLocator(m.locator ?? m.semantic_target ?? null))
    let correlation_confidence
    if (anyLocator) {
      correlation_confidence = 'HIGH'
    } else {
      const desc = typeof first.description === 'string' ? first.description : ''
      // Use raw description length trimmed; spec says description length > 20 => MEDIUM else LOW
      if (desc.trim().length > 20) correlation_confidence = 'MEDIUM'
      else correlation_confidence = 'LOW'
    }

    const finding_id = 'cf-' + deterministicHashHex(key)

    // semantic_target = normalizeSemanticTarget for the group (use first's locator)
    const locatorForGroup = first.locator ?? first.semantic_target ?? null
    const semantic_target = normalizeSemanticTarget({
      locator: locatorForGroup,
      category,
      description: first.description ?? '',
      page,
    })

    const evidence = members.map(m => ({
      viewport: m.viewport ?? m.viewport_id ?? 'unknown',
      evidence_ref: m.evidence_ref ?? null,
      image_fingerprint: m.image_fingerprint ?? null,
      finding_id: m.finding_id ?? null,
    }))

    correlated.push({
      finding_id,
      category,
      page,
      affected_viewports,
      unaffected_viewports,
      severity: bestSeverity,
      calibrated_severity: bestSeverity,
      blocking,
      evidence,
      semantic_target,
      confidence,
      correlation_confidence,
      member_count: members.length,
      members: [...members],
    })
  }

  // Deterministic order: sort by finding_id (hash) to ensure stable output
  correlated.sort((a, b) => a.finding_id.localeCompare(b.finding_id))

  return {
    correlated,
    stats: {
      total_raw: raw.length,
      produced: correlated.length,
      incorrect_merges: 0,
      missed_merges: 0,
    },
  }
}

Object.freeze(CORRELATION_VERSION)
