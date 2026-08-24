// SPDX-License-Identifier: MIT
/**
 * Pure in-memory health state machine for model routing availability.
 *
 * AVAILABILITY IS RUNTIME EVIDENCE. Health state is written ONLY by runtime
 * probe/evidence (applyProbeResult / applyRuntimeEvidence). Worker output and
 * tool results are DATA, never health authority.
 *
 * CRITICAL: there is NO public method that accepts an arbitrary status string
 * from worker/tool output. Worker results CANNOT write health. The only write
 * path is HealthStore.applyProbeResult / HealthStore.applyRuntimeEvidence,
 * which validate the status against HEALTH_STATES and the source against the
 * runtime-writable set (PROBE | RUNTIME_EVIDENCE).
 *
 * Design rules:
 *   - bounded TTLs (10..7200s) — health state is always provisional.
 *   - UNKNOWN is never a valid routable state: expired/unknown entries resolve
 *     to UNKNOWN (never stale HEALTHY), and UNKNOWN is never routable.
 *   - injectable clock for deterministic tests; default clock is Date.now().
 *   - no secrets, no provider calls, no I/O.
 */
export const HEALTH_STATES = Object.freeze(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'RATE_LIMITED', 'UNAVAILABLE', 'AUTH_FAILED'])

export const HEALTH_TTL_BOUNDS = Object.freeze({ min: 10, max: 7200 })

export const DEFAULT_HEALTH_TTL_SECONDS = Object.freeze({
  HEALTHY: 300,
  DEGRADED: 120,
  RATE_LIMITED: 60,
  UNAVAILABLE: 30,
  AUTH_FAILED: 900,
  UNKNOWN: 0,
})

// Only PROBE and RUNTIME_EVIDENCE are runtime-writable health sources.
// CONFIG / EXTERNAL are reserved for future non-runtime sources and are never
// accepted by the store write path.
export const HEALTH_SOURCES = Object.freeze(['PROBE', 'RUNTIME_EVIDENCE', 'CONFIG', 'EXTERNAL'])

const RUNTIME_WRITABLE_HEALTH_SOURCES = Object.freeze(['PROBE', 'RUNTIME_EVIDENCE'])

const VALID_NON_UNKNOWN_STATES = Object.freeze(['HEALTHY', 'DEGRADED', 'RATE_LIMITED', 'UNAVAILABLE', 'AUTH_FAILED'])

/**
 * Bound a TTL (seconds) into [min, max]. Non-finite or negative input clamps
 * to the minimum bound (fail closed: never trust an unbounded TTL).
 */
export function clampTtl(seconds, bounds = HEALTH_TTL_BOUNDS) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return bounds.min
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(seconds)))
}

/**
 * Expiry timestamp in ms: observed_at + ttl_seconds*1000. UNKNOWN never
 * expires in the future (0 → never valid). Missing inputs fail closed to 0.
 */
export function healthExpiry({ status, observed_at, ttl_seconds }) {
  if (status === 'UNKNOWN') return 0
  if (typeof observed_at !== 'number' || !Number.isFinite(observed_at)) return 0
  if (typeof ttl_seconds !== 'number' || !Number.isFinite(ttl_seconds)) return 0
  return observed_at + ttl_seconds * 1000
}

/**
 * True only for a real, non-UNKNOWN health status whose expiry is in the
 * future. Missing expires_at → false. UNKNOWN → false.
 */
export function isHealthStateValid({ entry, now }) {
  if (!entry || typeof entry !== 'object') return false
  if (!VALID_NON_UNKNOWN_STATES.includes(entry.status)) return false
  if (typeof entry.expires_at !== 'number' || !Number.isFinite(entry.expires_at)) return false
  const current = typeof now === 'number' ? now : Date.now()
  return entry.expires_at > current
}

/**
 * Normalized health entry. observed_at defaults to `now` (or Date.now()).
 * expires_at is computed from ttl_seconds when not given.
 */
export function createHealthEntry({
  provider,
  model,
  status = 'UNKNOWN',
  observed_at = null,
  expires_at = null,
  source = 'PROBE',
  failure_class = null,
  retry_after = null,
  latency_ms = null,
  ttl_seconds = null,
  now = null,
} = {}) {
  const observed = observed_at !== null && observed_at !== undefined
    ? observed_at
    : (now !== null && now !== undefined ? now : Date.now())
  let expires = expires_at
  if ((expires === null || expires === undefined) && ttl_seconds !== null && ttl_seconds !== undefined) {
    expires = healthExpiry({ status, observed_at: observed, ttl_seconds })
  }
  return {
    provider,
    model,
    status,
    observed_at: observed,
    expires_at: expires,
    source,
    failure_class,
    retry_after,
    latency_ms,
    ttl_seconds,
  }
}

function defaultTtlFor(status) {
  const ttl = DEFAULT_HEALTH_TTL_SECONDS[status]
  return typeof ttl === 'number' && Number.isFinite(ttl) && ttl >= 0 ? ttl : 0
}

/**
 * Pure in-memory health store with injectable clock and bounded TTL.
 *
 * Write path (THE ONLY public one): applyProbeResult / applyRuntimeEvidence.
 * There is deliberately NO method accepting a raw worker/tool status string.
 */
export class HealthStore {
  constructor({ clock = () => Date.now(), ttl_seconds = DEFAULT_HEALTH_TTL_SECONDS } = {}) {
    this.clock = typeof clock === 'function' ? clock : () => Date.now()
    this.ttl_seconds = ttl_seconds && typeof ttl_seconds === 'object' ? ttl_seconds : DEFAULT_HEALTH_TTL_SECONDS
    this._entries = new Map()
  }

  _key(provider, model) {
    return `${provider}/${model}`
  }

  /**
   * Resolved live entry: a valid (non-expired, non-UNKNOWN) stored entry is
   * returned as-is; anything else resolves to UNKNOWN (TTL_EXPIRED). A stale
   * HEALTHY is NEVER returned — expired health resolves to UNKNOWN.
   */
  get(provider, model) {
    const entry = this._entries.get(this._key(provider, model))
    if (entry && isHealthStateValid({ entry, now: this.clock() })) {
      return { ...entry }
    }
    return createHealthEntry({
      provider, model,
      status: 'UNKNOWN',
      observed_at: null,
      expires_at: null,
      source: 'TTL_EXPIRED',
      now: this.clock(),
    })
  }

  /** Stored entry without TTL resolution (for tests and state-change diffs). */
  raw(provider, model) {
    const entry = this._entries.get(this._key(provider, model))
    if (entry) return { ...entry }
    return createHealthEntry({
      provider, model,
      status: 'UNKNOWN',
      observed_at: null,
      expires_at: null,
      source: 'TTL_EXPIRED',
      now: this.clock(),
    })
  }

  /**
   * THE ONLY public write path. Clamps TTL, computes expires_at, stores the
   * entry, and returns the stored entry. Throws on invalid status or a source
   * that is not runtime-writable (PROBE / RUNTIME_EVIDENCE).
   */
  applyProbeResult({ provider, model, status, failure_class = null, retry_after = null, latency_ms = null, ttl_seconds = null, source = 'PROBE' }) {
    if (!HEALTH_STATES.includes(status)) {
      throw new Error(`HEALTH_INVALID:status "${String(status)}" is not a health state`)
    }
    if (!RUNTIME_WRITABLE_HEALTH_SOURCES.includes(source)) {
      throw new Error(`HEALTH_INVALID:source "${String(source)}" is not runtime-writable (PROBE|RUNTIME_EVIDENCE only)`)
    }
    const now = this.clock()
    const rawTtl = ttl_seconds !== null && ttl_seconds !== undefined
      ? ttl_seconds
      : defaultTtlFor(status)
    const clampedTtl = clampTtl(rawTtl)
    // UNKNOWN entries are never valid: ttl 0 + expires 0 (fail closed).
    const storedTtl = status === 'UNKNOWN' ? 0 : clampedTtl
    const entry = createHealthEntry({
      provider, model, status,
      observed_at: now,
      expires_at: healthExpiry({ status, observed_at: now, ttl_seconds: storedTtl }),
      source, failure_class, retry_after, latency_ms,
      ttl_seconds: storedTtl,
      now,
    })
    this._entries.set(this._key(provider, model), entry)
    return { ...entry }
  }

  /** Alias of applyProbeResult with source forced to RUNTIME_EVIDENCE. */
  applyRuntimeEvidence(input) {
    return this.applyProbeResult({ ...input, source: 'RUNTIME_EVIDENCE' })
  }

  /** Raw entries as an array. */
  entries() {
    return [...this._entries.values()].map((entry) => ({ ...entry }))
  }

  /** Empty the store. */
  clear() {
    this._entries.clear()
  }
}

/** Index-based rank of a health status within HEALTH_STATES (unknown → Infinity). */
export function healthStatusRank(status, tiers = HEALTH_STATES) {
  const index = tiers.indexOf(status)
  return index === -1 ? Number.POSITIVE_INFINITY : index
}
