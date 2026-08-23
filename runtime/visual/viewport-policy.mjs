// SPDX-License-Identifier: MIT
/**
 * Canonical viewport matrix — bounded, deterministic.
 * Single source of truth for viewport dimensions.
 */

export const CANONICAL_VIEWPORTS = Object.freeze({
  'mobile-small': Object.freeze({ width: 360, height: 800 }),
  'mobile': Object.freeze({ width: 390, height: 844 }),
  'tablet': Object.freeze({ width: 768, height: 1024 }),
  'desktop': Object.freeze({ width: 1280, height: 800 }),
  'wide-desktop': Object.freeze({ width: 1440, height: 900 }),
})

export const CANONICAL_VIEWPORT_IDS = Object.freeze([...Object.keys(CANONICAL_VIEWPORTS)])

export const VIEWPORT_PROFILES = Object.freeze({
  desktop_only: Object.freeze(['desktop']),
  mobile_only: Object.freeze(['mobile']),
  responsive_core: Object.freeze(['mobile-small', 'mobile', 'tablet', 'desktop', 'wide-desktop']),
  custom: Object.freeze([]),
})

export const MAX_CUSTOM_VIEWPORTS = 8

export const DEFAULT_VIEWPORT_PROFILE = 'responsive_core'

export const VIEWPORT_MATRIX_BOUNDS = Object.freeze({
  max_canonical: 5,
  max_custom: 8,
  max_total_per_run: 8,
})

export function getCanonicalViewport(name) {
  if (typeof name !== 'string') return null
  const entry = CANONICAL_VIEWPORTS[name]
  if (!entry) return null
  return { width: entry.width, height: entry.height }
}

export function isCanonicalViewport(name) {
  if (typeof name !== 'string') return false
  return Object.prototype.hasOwnProperty.call(CANONICAL_VIEWPORTS, name)
}

export function isValidCustomViewport(vp) {
  if (!vp || typeof vp !== 'object' || Array.isArray(vp)) return false
  const id = vp.name ?? vp.viewport_id ?? vp.viewportId
  if (typeof id !== 'string' || id.trim().length === 0) return false
  const width = vp.width
  const height = vp.height
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 200 || width > 3840) return false
  if (typeof height !== 'number' || !Number.isFinite(height) || height < 200 || height > 2160) return false
  // ensure integer-like? allow any number within range but must be finite
  return true
}

function normalizeCustomEntry(vp) {
  const id = vp.name ?? vp.viewport_id ?? vp.viewportId
  const viewport_id = String(id).trim()
  return { viewport_id, width: vp.width, height: vp.height }
}

function buildCanonicalViewports(ids) {
  return ids.map((id) => {
    const def = CANONICAL_VIEWPORTS[id]
    return { viewport_id: id, width: def.width, height: def.height }
  })
}

export function resolveViewportProfile({ profile, customViewports, maxCustom } = {}) {
  const effectiveMax = typeof maxCustom === 'number' && Number.isFinite(maxCustom) && maxCustom > 0 ? Math.floor(maxCustom) : MAX_CUSTOM_VIEWPORTS
  const resolvedProfile = profile == null ? DEFAULT_VIEWPORT_PROFILE : profile

  if (typeof resolvedProfile !== 'string' || !Object.prototype.hasOwnProperty.call(VIEWPORT_PROFILES, resolvedProfile)) {
    return {
      ok: false,
      viewports: [],
      profile: resolvedProfile,
      clamped: false,
      code: 'VIEWPORT_PROFILE_UNKNOWN',
      reason: `unknown viewport profile: ${String(resolvedProfile)}`,
    }
  }

  if (resolvedProfile === 'custom') {
    if (!Array.isArray(customViewports)) {
      return {
        ok: false,
        viewports: [],
        profile: resolvedProfile,
        clamped: false,
        code: 'VIEWPORT_CUSTOM_INVALID',
        reason: 'customViewports must be an array',
      }
    }

    // Unbounded fanout guard — deny before attempting to process
    if (customViewports.length > 1000 || customViewports.length > effectiveMax * 10) {
      return {
        ok: false,
        viewports: [],
        profile: resolvedProfile,
        clamped: false,
        code: 'VIEWPORT_MATRIX_UNBOUNDED_DENIED',
        reason: `customViewports length ${customViewports.length} exceeds bounded limit (max_custom=${effectiveMax}, max_total_per_run=${VIEWPORT_MATRIX_BOUNDS.max_total_per_run}); unbounded matrix denied`,
      }
    }

    // Validate each entry
    for (let i = 0; i < customViewports.length; i++) {
      const vp = customViewports[i]
      if (!isValidCustomViewport(vp)) {
        return {
          ok: false,
          viewports: [],
          profile: resolvedProfile,
          clamped: false,
          code: 'VIEWPORT_CUSTOM_INVALID',
          reason: `invalid custom viewport at index ${i}`,
        }
      }
    }

    const clamped = customViewports.length > effectiveMax
    const slice = clamped ? customViewports.slice(0, effectiveMax) : customViewports
    const viewports = slice.map(normalizeCustomEntry).map((v) => Object.freeze(v))
    const result = {
      ok: true,
      viewports: Object.freeze([...viewports]),
      profile: resolvedProfile,
      clamped,
    }
    if (clamped) {
      result.reason = `clamped from ${customViewports.length} to ${effectiveMax}: max_custom_viewports=${effectiveMax}`
    }
    return Object.freeze(result)
  }

  // Non-custom profiles: resolve from canonical matrix
  const ids = VIEWPORT_PROFILES[resolvedProfile]
  const viewports = buildCanonicalViewports([...ids]).map((v) => Object.freeze(v))
  return Object.freeze({
    ok: true,
    viewports: Object.freeze([...viewports]),
    profile: resolvedProfile,
    clamped: false,
  })
}

export function resolveViewportsForRun({ viewport_profile, custom_viewports, pages } = {}) {
  // pages carry per-page viewports: those take precedence per-page,
  // this function resolves the profile-level viewports for gate-level use.
  // Support both snake_case and camelCase for robustness.
  const profile = viewport_profile
  const customViewports = custom_viewports
  // pages param is acknowledged but does not influence gate-level viewport resolution
  // (per-page viewports are handled by the caller). Keep signature for compatibility.
  void pages
  return resolveViewportProfile({ profile, customViewports })
}
