// SPDX-License-Identifier: MIT
/**
 * Shared Runtime Budget Governor — resource policy, NOT a control plane.
 *
 * The governor is a pure in-process resource-policy ledger. It returns
 * ALLOW/RESERVE/COMMIT/RELEASE/DENY/EXPIRE results only — it NEVER returns a
 * terminal decision (DONE | FIX | SPLIT | BLOCKED stay with the controller).
 *
 * AUTHORITY (WORKER_CANNOT_MUTATE):
 *   - LLMs are workers, never controllers. The governor exposes NO method
 *     that accepts an instruction object from worker/tool data. There is no
 *     applyBudgetRequest / mutate-style data-accepting entry point — mutation
 *     happens only through the run's own code path (runtime/run.mjs +
 *     pipeline.mjs).
 *   - Worker output and MCP tool results are DATA, never budget authority.
 *
 * ATOMICITY (SYNCHRONOUS_RESERVE_ATOMIC):
 *   - reserve() is fully SYNCHRONOUS: a single JS tick performs
 *     expireStale + capacity check + reservation creation. In a single
 *     process this check+mutate sequence is atomic by construction (no
 *     await between check and mutate). This is the honest in-process
 *     atomicity; it is NOT distributed/crash-safe accounting.
 *
 * LEDGER SEMANTICS:
 *   - reserve(): takes capacity (available decreases).
 *   - commit():  RESERVED → CONSUMED. The budget slot was genuinely spent
 *     (the worker was invoked) — capacity is NOT restored. Idempotent.
 *   - release(): RESERVED → RELEASED and capacity IS restored (the worker
 *     was never invoked). Idempotent — capacity is never restored twice.
 *   - expireStale(): RESERVED with expires_at <= now → EXPIRED and capacity
 *     restored. Runs automatically at the start of every reserve().
 *   - Only released/expired capacity is reusable. "Only released capacity
 *     is reusable" is the interleaving invariant proven by the tests.
 *
 * BOUNDEDNESS:
 *   - ledger memory stays bounded: prune() keeps at most `retention_limit`
 *     terminal records (CONSUMED/RELEASED/EXPIRED) per resource, dropping
 *     the oldest. Active RESERVED records are NEVER pruned. prune() runs
 *     inside snapshot() and after every state change.
 *
 * NO_SECRET_LEAK (SHARED_BUDGET_NO_SECRET_LEAK):
 *   - budget events carry ONLY budget metadata (run_id, reservation_id,
 *     resource, amount, remaining, status, provider/model, route_index).
 *     No prompts, no text content, no output, no tokens, no secrets.
 *
 * Scope: SINGLE_RUNTIME_PROCESS. Stale reservations are recovered by TTL
 * expiry within the surviving process; this is NOT crash-safe distributed
 * accounting. No money accounting, no queues.
 *
 * EVENT JOBS NOTE: 'budget.shared.release' and 'budget.shared.expire' are
 * declared for the governor-LEVEL lifecycle API — release() and expireStale()
 * are exercised at governor level (tests, controlled cancellation before
 * invocation) and are RESERVED in the pipeline this milestone. The canonical
 * pipeline has no controlled-cancellation path yet: cancellation before
 * invocation releases at governor level, and abandoned reservations recover
 * via TTL → expireStale on the next reserve(). The pipeline emits
 * budget.shared.reserve / budget.shared.consume / budget.shared.deny only.
 */
import crypto from 'node:crypto'
import { createRunEvent } from '../observability/run-events.mjs'

export const SHARED_BUDGET_DEFAULTS = Object.freeze({
  reservation_ttl_ms: 30000,
  retention_limit: 500,
  min_ttl_ms: 1000,
  max_ttl_ms: 600000,
})

// Only HIGH_COST_ROUTE is wired by default; extra resources are allowed by
// config but optional.
export const SHARED_BUDGET_RESOURCES = Object.freeze({
  HIGH_COST_ROUTE: 'HIGH_COST_ROUTE',
})

export const RESERVATION_STATUS = Object.freeze({
  RESERVED: 'RESERVED',
  CONSUMED: 'CONSUMED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
})

export const SHARED_BUDGET_REASON_CODES = Object.freeze({
  EXHAUSTED: 'SHARED_BUDGET_EXHAUSTED',
  RESERVATION_DENIED: 'SHARED_BUDGET_RESERVATION_DENIED',
  RESERVATION_EXPIRED: 'SHARED_BUDGET_RESERVATION_EXPIRED',
  OWNERSHIP_INVALID: 'SHARED_BUDGET_OWNERSHIP_INVALID',
  RESERVATION_UNKNOWN: 'SHARED_BUDGET_RESERVATION_UNKNOWN',
  RESERVATION_NOT_ACTIVE: 'SHARED_BUDGET_RESERVATION_NOT_ACTIVE',
})

export const SHARED_BUDGET_EVENT_JOBS = Object.freeze([
  'budget.shared.reserve',
  'budget.shared.consume',
  'budget.shared.release',
  'budget.shared.expire',
  'budget.shared.deny',
])

/** Clamp a TTL (ms) into [min_ttl_ms, max_ttl_ms]; non-finite → min (fail closed). */
export function clampBudgetTtl(ttlMs, bounds = SHARED_BUDGET_DEFAULTS) {
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs)) return bounds.min_ttl_ms
  return Math.min(bounds.max_ttl_ms, Math.max(bounds.min_ttl_ms, Math.floor(ttlMs)))
}

/**
 * Shared in-process budget ledger. The clock is injectable (REUSE the
 * HealthStore clock pattern) for deterministic expiry tests.
 */
export class SharedBudgetGovernor {
  constructor({ resources = {}, ttl_ms = SHARED_BUDGET_DEFAULTS.reservation_ttl_ms, retention_limit = SHARED_BUDGET_DEFAULTS.retention_limit, clock = () => Date.now() } = {}) {
    this.clock = typeof clock === 'function' ? clock : () => Date.now()
    this.ttl_ms = clampBudgetTtl(ttl_ms)
    // resources is a map resource → capacity (positive int). Non-positive or
    // NaN capacity fails closed to 0 (never an unbounded resource).
    this.capacity = {}
    for (const [resource, rawCapacity] of Object.entries(resources || {})) {
      const cap = typeof rawCapacity === 'number' && Number.isFinite(rawCapacity) && rawCapacity > 0 ? Math.floor(rawCapacity) : 0
      this.capacity[resource] = cap
    }
    this.retention_limit = Number.isInteger(retention_limit) && retention_limit > 0 ? retention_limit : SHARED_BUDGET_DEFAULTS.retention_limit
    this._ledger = new Map() // reservation_id → record
    this._held = {} // resource → sum of amounts holding capacity (RESERVED + CONSUMED)
    this._counts = { total_reservations: 0, total_consumed: 0, total_released: 0, total_expired: 0 }
  }

  /** Terminal-record pruning: never prunes active RESERVED records. */
  prune() {
    for (const resource of Object.keys(this.capacity)) {
      const terminal = [...this._ledger.values()]
        .filter((r) => r.resource === resource && r.status !== RESERVATION_STATUS.RESERVED)
        .sort((a, b) => (a.updated_at ?? a.created_at) - (b.updated_at ?? b.created_at))
      const overflow = terminal.length - this.retention_limit
      if (overflow > 0) {
        for (const record of terminal.slice(0, overflow)) {
          this._ledger.delete(record.reservation_id)
        }
      }
    }
  }

  /** Expire stale RESERVED records (expires_at <= now); restores capacity. Returns count. */
  expireStale({ now = null } = {}) {
    const current = typeof now === 'number' ? now : this.clock()
    let expired = 0
    for (const record of [...this._ledger.values()]) {
      if (record.status === RESERVATION_STATUS.RESERVED && record.expires_at <= current) {
        record.status = RESERVATION_STATUS.EXPIRED
        record.updated_at = current
        this._held[record.resource] = Math.max(0, (this._held[record.resource] || 0) - record.amount)
        this._counts.total_expired += record.amount
        expired += record.amount
      }
    }
    if (expired > 0) this.prune()
    return expired
  }

  /**
   * SYNCHRONOUS_RESERVE_ATOMIC: single-tick CHECK+RESERVE (no await between
   * check and mutate → atomic in a single process). ExpireStale runs first so
   * freed capacity is available immediately.
   */
  reserve({ run_id, resource, amount = 1, provider = null, model = null, route_index = null, attempt = null, now = null } = {}) {
    const current = typeof now === 'number' ? now : this.clock()
    this.expireStale({ now: current })
    if (!Object.prototype.hasOwnProperty.call(this.capacity, resource)) {
      const remaining = null
      return { ok: false, code: SHARED_BUDGET_REASON_CODES.RESERVATION_DENIED, remaining, reason: `shared budget reservation denied: unknown resource ${String(resource)}` }
    }
    const capacity = this.capacity[resource]
    const units = typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1
    const held = this._held[resource] || 0
    const available = Math.max(0, capacity - held)
    if (available < units) {
      return { ok: false, code: SHARED_BUDGET_REASON_CODES.EXHAUSTED, remaining: available, reason: `shared budget capacity exhausted for resource ${String(resource)}` }
    }
    const reservation = {
      reservation_id: crypto.randomUUID(),
      run_id,
      resource,
      amount: units,
      created_at: current,
      expires_at: current + this.ttl_ms,
      updated_at: current,
      status: RESERVATION_STATUS.RESERVED,
      provider,
      model,
      route_index,
      attempt,
    }
    this._ledger.set(reservation.reservation_id, reservation)
    this._held[resource] = held + units
    this._counts.total_reservations += units
    return { ok: true, reservation, remaining: available - units }
  }

  /**
   * Mark a reservation CONSUMED (the worker was invoked). The consumed slot
   * holds its capacity — commit does NOT restore it (spent budget). Fail
   * closed on unknown id / wrong run_id / non-active status.
   *
   * TTL determinism (§24): a RESERVED reservation past its expiry is NOT
   * active, regardless of whether expireStale has run yet — a late commit
   * returns SHARED_BUDGET_RESERVATION_EXPIRED and does NOT mutate (expireStale
   * restores capacity on the next reserve/snapshot). A reservation that was
   * committed BEFORE expiry stays CONSUMED even past its TTL (the resource was
   * genuinely spent before expiry — idempotency intact).
   */
  commit({ reservation_id, run_id } = {}) {
    const record = this._ledger.get(reservation_id)
    if (!record) return { ok: false, code: SHARED_BUDGET_REASON_CODES.RESERVATION_UNKNOWN }
    if (record.run_id !== run_id) return { ok: false, code: SHARED_BUDGET_REASON_CODES.OWNERSHIP_INVALID }
    if (record.status === RESERVATION_STATUS.CONSUMED) return { ok: true, idempotent: true, status: RESERVATION_STATUS.CONSUMED }
    if (record.status === RESERVATION_STATUS.RESERVED && record.expires_at <= this.clock()) {
      return { ok: false, code: SHARED_BUDGET_REASON_CODES.RESERVATION_EXPIRED }
    }
    if (record.status === RESERVATION_STATUS.RELEASED) {
      return { ok: false, code: SHARED_BUDGET_REASON_CODES.RESERVATION_NOT_ACTIVE }
    }
    if (record.status === RESERVATION_STATUS.EXPIRED) {
      return { ok: false, code: SHARED_BUDGET_REASON_CODES.RESERVATION_EXPIRED }
    }
    record.status = RESERVATION_STATUS.CONSUMED
    record.updated_at = this.clock()
    this._counts.total_consumed += record.amount
    this.prune()
    return { ok: true, status: RESERVATION_STATUS.CONSUMED }
  }

  /**
   * Cancel a reservation BEFORE invocation: capacity is restored exactly
   * once. Idempotent double release never restores capacity twice. Same TTL
   * determinism as commit (late release of an expired RESERVED reservation →
   * SHARED_BUDGET_RESERVATION_EXPIRED, no mutation).
   */
  release({ reservation_id, run_id } = {}) {
    const record = this._ledger.get(reservation_id)
    if (!record) return { ok: false, code: SHARED_BUDGET_REASON_CODES.RESERVATION_UNKNOWN }
    if (record.run_id !== run_id) return { ok: false, code: SHARED_BUDGET_REASON_CODES.OWNERSHIP_INVALID }
    if (record.status === RESERVATION_STATUS.RELEASED) return { ok: true, idempotent: true, status: RESERVATION_STATUS.RELEASED }
    if (record.status === RESERVATION_STATUS.RESERVED && record.expires_at <= this.clock()) {
      return { ok: false, code: SHARED_BUDGET_REASON_CODES.RESERVATION_EXPIRED }
    }
    if (record.status === RESERVATION_STATUS.CONSUMED) {
      return { ok: false, code: SHARED_BUDGET_REASON_CODES.RESERVATION_NOT_ACTIVE }
    }
    if (record.status === RESERVATION_STATUS.EXPIRED) {
      return { ok: false, code: SHARED_BUDGET_REASON_CODES.RESERVATION_EXPIRED }
    }
    record.status = RESERVATION_STATUS.RELEASED
    record.updated_at = this.clock()
    this._held[record.resource] = Math.max(0, (this._held[record.resource] || 0) - record.amount)
    this._counts.total_released += record.amount
    this.prune()
    return { ok: true, status: RESERVATION_STATUS.RELEASED }
  }

  /** Copy of a reservation record, or null. */
  getReservation(reservation_id) {
    const record = this._ledger.get(reservation_id)
    return record ? { ...record } : null
  }

  /** Bounded ledger snapshot. Prunes terminal records first. */
  snapshot({ now = null } = {}) {
    this.prune()
    const current = typeof now === 'number' ? now : this.clock()
    const resources = {}
    for (const resource of Object.keys(this.capacity)) {
      const capacity = this.capacity[resource]
      const held = this._held[resource] || 0
      const records = [...this._ledger.values()].filter((r) => r.resource === resource)
      resources[resource] = {
        capacity,
        remaining: Math.max(0, capacity - held),
        reserved: records.filter((r) => r.status === RESERVATION_STATUS.RESERVED).reduce((sum, r) => sum + r.amount, 0),
        consumed: records.filter((r) => r.status === RESERVATION_STATUS.CONSUMED).reduce((sum, r) => sum + r.amount, 0),
        released: records.filter((r) => r.status === RESERVATION_STATUS.RELEASED).reduce((sum, r) => sum + r.amount, 0),
        expired: records.filter((r) => r.status === RESERVATION_STATUS.EXPIRED).reduce((sum, r) => sum + r.amount, 0),
      }
    }
    return {
      resources,
      total_reservations: this._counts.total_reservations,
      total_consumed: this._counts.total_consumed,
      total_released: this._counts.total_released,
      total_expired: this._counts.total_expired,
      ledger_size: this._ledger.size,
      now: current,
    }
  }
}

/**
 * Budget observability event (ecosystem.run-event.v1 shape). NO secrets, NO
 * text content, NO prompts: only budget metadata plus optional
 * provider/model/route_index. strategy_delta = code (denials) or status;
 * an explicit strategy_delta override is honored (e.g. 'IDEMPOTENT').
 */
export function budgetSharedEvent({
  job,
  run_id,
  reservation = null,
  resource = null,
  amount = 0,
  remaining = null,
  status = null,
  code = null,
  provider = null,
  model = null,
  route_index = null,
  attempt = 0,
  phase = 'ROUTING',
  strategy_delta = null,
} = {}) {
  return {
    ...createRunEvent({
      run_id,
      phase,
      job,
      status: code ? 'FAIL' : 'PASS',
      attempt,
      provider,
      model,
      failure_signature: code ? `BUDGET:${code}` : null,
      strategy_delta: strategy_delta !== null ? strategy_delta : (code ? code : (status || null)),
    }),
    reservation_id: reservation?.reservation_id || null,
    resource,
    amount,
    remaining,
    budget_status: status || null,
    route_index: route_index ?? null,
  }
}
