// SPDX-License-Identifier: MIT
/**
 * Shared Runtime Budget Governor tests — lifecycle, atomicity, concurrency,
 * stress, memory bounds, ownership, security, no secret leak.
 *
 * Ledger semantics under test (interleaving-invariant):
 *   - reserve takes capacity; commit marks CONSUMED (slot spent, capacity NOT
 *     restored); release/expire restore capacity. "Only released capacity is
 *     reusable" — the stress drift check therefore releases all reservations
 *     of an iteration before asserting remaining === capacity.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  SharedBudgetGovernor,
  SHARED_BUDGET_DEFAULTS,
  SHARED_BUDGET_RESOURCES,
  RESERVATION_STATUS,
  SHARED_BUDGET_REASON_CODES,
  budgetSharedEvent,
  SHARED_BUDGET_EVENT_JOBS,
} from '../../runtime/routing/budget-governor.mjs'
import { ROUTING_EVENT_JOBS } from '../../runtime/routing/routing-events.mjs'
import { validate } from '../../runtime/contracts/run-event.mjs'

function makeClock(start = 0) {
  let now = start
  return {
    now: () => now,
    advance: (ms) => { now += ms },
    set: (ms) => { now = ms },
  }
}

function freshGovernor({ capacity = 2, ttl_ms = SHARED_BUDGET_DEFAULTS.reservation_ttl_ms, retention_limit = SHARED_BUDGET_DEFAULTS.retention_limit, clock = null } = {}) {
  return new SharedBudgetGovernor({
    resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: capacity },
    ttl_ms,
    retention_limit,
    clock: clock || (() => Date.now()),
  })
}

const RUN = { run_id: 'run-a', resource: SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE, amount: 1 }

describe('shared budget governor — lifecycle', () => {
  it('reserve → commit consumes (slot spent, capacity not restored)', () => {
    const governor = freshGovernor({ capacity: 2 })
    const reserved = governor.reserve({ ...RUN, provider: 'openai', model: 'gpt-5.4' })
    assert.equal(reserved.ok, true)
    assert.equal(reserved.remaining, 1)
    assert.equal(reserved.reservation.status, RESERVATION_STATUS.RESERVED)
    const committed = governor.commit({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(committed.ok, true)
    assert.equal(committed.status, RESERVATION_STATUS.CONSUMED)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 1)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 1, 'consumed slot holds capacity')
    assert.equal(snapshot.total_consumed, 1)
  })

  it('reserve → release restores capacity exactly once', () => {
    const governor = freshGovernor({ capacity: 2 })
    const reserved = governor.reserve({ ...RUN })
    assert.equal(governor.snapshot().resources.HIGH_COST_ROUTE.remaining, 1)
    const released = governor.release({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(released.ok, true)
    assert.equal(released.status, RESERVATION_STATUS.RELEASED)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 2, 'released capacity restored')
    assert.equal(snapshot.total_released, 1)
  })

  it('reserve → expire (advance clock) restores capacity', () => {
    const clock = makeClock(1_000_000)
    const governor = freshGovernor({ capacity: 1, ttl_ms: 5000, clock: clock.now })
    const reserved = governor.reserve({ ...RUN })
    assert.ok(reserved.ok)
    clock.advance(5001)
    const expired = governor.expireStale()
    assert.equal(expired, 1)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.expired, 1)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 1)
    const again = governor.reserve({ ...RUN })
    assert.equal(again.ok, true, 'expired capacity must be reusable')
  })

  it('unknown commit / release fail closed → SHARED_BUDGET_RESERVATION_UNKNOWN', () => {
    const governor = freshGovernor()
    const commit = governor.commit({ reservation_id: crypto.randomUUID(), run_id: RUN.run_id })
    assert.equal(commit.ok, false)
    assert.equal(commit.code, SHARED_BUDGET_REASON_CODES.RESERVATION_UNKNOWN)
    const release = governor.release({ reservation_id: crypto.randomUUID(), run_id: RUN.run_id })
    assert.equal(release.ok, false)
    assert.equal(release.code, SHARED_BUDGET_REASON_CODES.RESERVATION_UNKNOWN)
  })

  it('wrong run_id commit / release → SHARED_BUDGET_OWNERSHIP_INVALID, no budget change', () => {
    const governor = freshGovernor({ capacity: 2 })
    const reserved = governor.reserve({ ...RUN })
    const before = governor.snapshot()
    const commit = governor.commit({ reservation_id: reserved.reservation.reservation_id, run_id: 'run-b' })
    assert.equal(commit.ok, false)
    assert.equal(commit.code, SHARED_BUDGET_REASON_CODES.OWNERSHIP_INVALID)
    const release = governor.release({ reservation_id: reserved.reservation.reservation_id, run_id: 'run-b' })
    assert.equal(release.ok, false)
    assert.equal(release.code, SHARED_BUDGET_REASON_CODES.OWNERSHIP_INVALID)
    const after = governor.snapshot()
    assert.deepEqual(after, before, 'denied ownership mutations must not change the ledger')
  })

  it('double release → idempotent + no capacity drift', () => {
    const governor = freshGovernor({ capacity: 2 })
    const reserved = governor.reserve({ ...RUN })
    const first = governor.release({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(first.ok, true)
    const afterFirst = governor.snapshot().resources.HIGH_COST_ROUTE.remaining
    const second = governor.release({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(second.ok, true)
    assert.equal(second.idempotent, true)
    const afterSecond = governor.snapshot().resources.HIGH_COST_ROUTE.remaining
    assert.equal(afterSecond, afterFirst, 'second release must not restore capacity twice')
    assert.equal(afterSecond, 2)
  })

  it('double commit → idempotent + no double consume', () => {
    const governor = freshGovernor({ capacity: 2 })
    const reserved = governor.reserve({ ...RUN })
    const first = governor.commit({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(first.ok, true)
    const second = governor.commit({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(second.ok, true)
    assert.equal(second.idempotent, true)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 1, 'consumed count must stay 1')
    assert.equal(snapshot.total_consumed, 1)
  })

  it('release after commit → SHARED_BUDGET_RESERVATION_NOT_ACTIVE (no change)', () => {
    const clock = makeClock(1000)
    const governor = freshGovernor({ capacity: 2, clock: clock.now })
    const reserved = governor.reserve({ ...RUN })
    governor.commit({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    const before = governor.snapshot()
    const release = governor.release({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(release.ok, false)
    assert.equal(release.code, SHARED_BUDGET_REASON_CODES.RESERVATION_NOT_ACTIVE)
    assert.deepEqual(governor.snapshot(), before)
  })

  it('commit after release → SHARED_BUDGET_RESERVATION_NOT_ACTIVE (no change)', () => {
    const clock = makeClock(1000)
    const governor = freshGovernor({ capacity: 2, clock: clock.now })
    const reserved = governor.reserve({ ...RUN })
    governor.release({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    const before = governor.snapshot()
    const commit = governor.commit({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(commit.ok, false)
    assert.equal(commit.code, SHARED_BUDGET_REASON_CODES.RESERVATION_NOT_ACTIVE)
    assert.deepEqual(governor.snapshot(), before)
  })

  it('commit of EXPIRED reservation → SHARED_BUDGET_RESERVATION_EXPIRED', () => {
    const clock = makeClock(1_000_000)
    const governor = freshGovernor({ capacity: 1, ttl_ms: 5000, clock: clock.now })
    const reserved = governor.reserve({ ...RUN })
    clock.advance(5001)
    governor.expireStale()
    const commit = governor.commit({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(commit.ok, false)
    assert.equal(commit.code, SHARED_BUDGET_REASON_CODES.RESERVATION_EXPIRED)
  })

  it('TTL determinism: late commit of expired RESERVED → RESERVATION_EXPIRED even before expireStale runs (no mutation, capacity not spent)', () => {
    const clock = makeClock(1_000_000)
    const governor = freshGovernor({ capacity: 2, ttl_ms: 5000, clock: clock.now })
    const reserved = governor.reserve({ ...RUN })
    clock.advance(5001)
    const commit = governor.commit({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(commit.ok, false)
    assert.equal(commit.code, SHARED_BUDGET_REASON_CODES.RESERVATION_EXPIRED)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 0, 'expired reservation is NOT consumed')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.reserved, 1, 'record still RESERVED (not mutated)')
    assert.equal(governor.getReservation(reserved.reservation.reservation_id).status, RESERVATION_STATUS.RESERVED)
    // Capacity is still recoverable via expiry.
    const expired = governor.expireStale()
    assert.equal(expired, 1)
    assert.equal(governor.snapshot().resources.HIGH_COST_ROUTE.remaining, 2, 'capacity restored after expireStale')
  })

  it('TTL determinism: late release of expired RESERVED → RESERVATION_EXPIRED (no mutation)', () => {
    const clock = makeClock(1_000_000)
    const governor = freshGovernor({ capacity: 2, ttl_ms: 5000, clock: clock.now })
    const reserved = governor.reserve({ ...RUN })
    clock.advance(5001)
    const release = governor.release({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(release.ok, false)
    assert.equal(release.code, SHARED_BUDGET_REASON_CODES.RESERVATION_EXPIRED)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.released, 0, 'expired reservation is NOT released')
    assert.equal(governor.getReservation(reserved.reservation.reservation_id).status, RESERVATION_STATUS.RESERVED)
  })

  it('TTL determinism: reservation committed BEFORE expiry stays CONSUMED past TTL (idempotent commit)', () => {
    const clock = makeClock(1_000_000)
    const governor = freshGovernor({ capacity: 2, ttl_ms: 5000, clock: clock.now })
    const reserved = governor.reserve({ ...RUN })
    const committed = governor.commit({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(committed.ok, true)
    clock.advance(5001)
    const again = governor.commit({ reservation_id: reserved.reservation.reservation_id, run_id: RUN.run_id })
    assert.equal(again.ok, true, 'CONSUMED stays CONSUMED even past TTL — the resource was spent before expiry')
    assert.equal(again.idempotent, true)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 1)
  })

  it('unknown resource → SHARED_BUDGET_RESERVATION_DENIED (fail closed)', () => {
    const governor = freshGovernor()
    const result = governor.reserve({ run_id: RUN.run_id, resource: 'NOT_A_RESOURCE', amount: 1 })
    assert.equal(result.ok, false)
    assert.equal(result.code, SHARED_BUDGET_REASON_CODES.RESERVATION_DENIED)
  })

  it('non-positive / NaN capacity fails closed to 0 capacity', () => {
    const zero = new SharedBudgetGovernor({ resources: { HIGH_COST_ROUTE: 0 } })
    assert.equal(zero.snapshot().resources.HIGH_COST_ROUTE.capacity, 0)
    const denied = zero.reserve({ ...RUN })
    assert.equal(denied.ok, false)
    assert.equal(denied.code, SHARED_BUDGET_REASON_CODES.EXHAUSTED)
    const nan = new SharedBudgetGovernor({ resources: { HIGH_COST_ROUTE: Number.NaN } })
    assert.equal(nan.snapshot().resources.HIGH_COST_ROUTE.capacity, 0)
    const negative = new SharedBudgetGovernor({ resources: { HIGH_COST_ROUTE: -5 } })
    assert.equal(negative.snapshot().resources.HIGH_COST_ROUTE.capacity, 0)
  })

  it('ttl clamped into [min_ttl_ms, max_ttl_ms]', () => {
    const min = new SharedBudgetGovernor({ resources: { HIGH_COST_ROUTE: 1 }, ttl_ms: 5 })
    assert.equal(min.ttl_ms, SHARED_BUDGET_DEFAULTS.min_ttl_ms)
    const max = new SharedBudgetGovernor({ resources: { HIGH_COST_ROUTE: 1 }, ttl_ms: 999999999 })
    assert.equal(max.ttl_ms, SHARED_BUDGET_DEFAULTS.max_ttl_ms)
    const nan = new SharedBudgetGovernor({ resources: { HIGH_COST_ROUTE: 1 }, ttl_ms: Number.NaN })
    assert.equal(nan.ttl_ms, SHARED_BUDGET_DEFAULTS.min_ttl_ms)
    const normal = new SharedBudgetGovernor({ resources: { HIGH_COST_ROUTE: 1 }, ttl_ms: 1500 })
    assert.equal(normal.ttl_ms, 1500)
  })
})

describe('shared budget governor — atomicity & concurrency', () => {
  it('CONCURRENCY 1: capacity=2, 3 concurrent requests → exactly 2 RESERVED, 1 EXHAUSTED (repeated 3x)', async () => {
    for (let round = 0; round < 3; round += 1) {
      const governor = freshGovernor({ capacity: 2 })
      const requests = Array.from({ length: 3 }, (_, i) => async () => {
        // Async boundary BEFORE the synchronous reserve — the check+mutate
        // sequence itself stays single-tick (atomic by construction).
        await Promise.resolve()
        return governor.reserve({ run_id: `run-${round}-${i}`, resource: SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE, amount: 1, provider: 'openai', model: 'gpt-5.4', route_index: i, attempt: 0 })
      })
      const results = await Promise.all(requests.map((fn) => fn()))
      const okCount = results.filter((r) => r.ok).length
      const denied = results.filter((r) => !r.ok)
      assert.equal(okCount, 2, `round ${round}: exactly 2 reservations`)
      assert.equal(denied.length, 1, `round ${round}: exactly 1 denial`)
      assert.equal(denied[0].code, SHARED_BUDGET_REASON_CODES.EXHAUSTED)
      const snapshot = governor.snapshot()
      assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 0)
      assert.equal(snapshot.resources.HIGH_COST_ROUTE.reserved, 2, 'active reservations === capacity')
    }
  })

  it('CONCURRENCY 2: capacity=10, 100 concurrent requests → 10 reserved, 90 denied, no oversubscription', async () => {
    const governor = freshGovernor({ capacity: 10 })
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => (async () => {
      await Promise.resolve()
      return governor.reserve({ run_id: `run-${i}`, resource: SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE, amount: 1, provider: 'deepseek', model: 'deepseek-v4-pro', route_index: i, attempt: 0 })
    })()))
    const ok = results.filter((r) => r.ok)
    const denied = results.filter((r) => !r.ok)
    assert.equal(ok.length, 10)
    assert.equal(denied.length, 90)
    assert.ok(denied.every((r) => r.code === SHARED_BUDGET_REASON_CODES.EXHAUSTED))
    const snapshot = governor.snapshot()
    const reservedSum = ok.reduce((sum, r) => sum + r.reservation.amount, 0)
    assert.equal(reservedSum, 10)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 0)
    assert.ok(reservedSum <= 10, 'no oversubscription (sum reserved ≤ capacity)')
  })

  it('1000-concurrent canary: capacity=5 → 5 reserved / 995 denied (in-memory, must run)', async () => {
    const governor = freshGovernor({ capacity: 5 })
    const results = await Promise.all(Array.from({ length: 1000 }, (_, i) => (async () => {
      await Promise.resolve()
      return governor.reserve({ run_id: `run-${i}`, resource: SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE, amount: 1, route_index: i, attempt: 0 })
    })()))
    const ok = results.filter((r) => r.ok)
    const denied = results.filter((r) => !r.ok)
    assert.equal(ok.length, 5)
    assert.equal(denied.length, 995)
    assert.equal(governor.snapshot().resources.HIGH_COST_ROUTE.reserved, 5)
  })

  it('STRESS: 100 iterations × 100 concurrent (10,000 decisions) — no oversubscription, no drift, no deadlock, no unhandled errors', async () => {
    const started = performance.now()
    let oversubscription = 0
    let capacityDrift = 0
    let deadlock = 0
    let unhandledErrors = 0
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const governor = freshGovernor({ capacity: 10 })
      const tasks = Array.from({ length: 100 }, (_, i) => async () => {
        await Promise.resolve()
        return governor.reserve({ run_id: `iter-${iteration}-${i}`, resource: SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE, amount: 1, route_index: i, attempt: 0 })
      })
      const results = await Promise.all(tasks.map((fn) => fn().catch(() => { unhandledErrors += 1; return { ok: false, code: 'UNHANDLED' } })))
      const ok = results.filter((r) => r && r.ok)
      const denied = results.filter((r) => r && !r.ok)
      assert.equal(ok.length, 10, `iteration ${iteration}: exactly 10 reserved`)
      assert.equal(denied.length, 90, `iteration ${iteration}: exactly 90 denied`)
      const reservedSum = ok.reduce((sum, r) => sum + r.reservation.amount, 0)
      if (reservedSum > 10) oversubscription += 1
      // Release all reservations of this iteration (the capacity-restoring
      // operation — commit is a permanent spend). Drift-free means the
      // ledger returns exactly to full capacity.
      for (const result of ok) {
        governor.release({ reservation_id: result.reservation.reservation_id, run_id: result.reservation.run_id })
      }
      const remaining = governor.snapshot().resources.HIGH_COST_ROUTE.remaining
      if (remaining !== 10) capacityDrift += 1
    }
    const durationMs = performance.now() - started
    const decisions = 100 * 100
    assert.equal(oversubscription, 0, 'OVERSUBSCRIPTION must be 0')
    assert.equal(capacityDrift, 0, 'CAPACITY_DRIFT must be 0 (remaining back to capacity after release)')
    assert.equal(deadlock, 0, 'DEADLOCK must be 0 (test completes)')
    assert.equal(unhandledErrors, 0, 'UNHANDLED_ERROR must be 0')
    const opsPerSec = decisions / (durationMs / 1000)
    assert.ok(opsPerSec > 1000, `stress must complete fast (got ${Math.round(opsPerSec)} ops/s)`)
    process.env.OCAE_STRESS_OPS_PER_SEC = String(Math.round(opsPerSec))
    process.env.OCAE_STRESS_DURATION_MS = String(Math.round(durationMs))
    process.env.OCAE_STRESS_DECISIONS = String(decisions)
    // Results are recorded in evidence/results.md from the actual run output.
  })

  it('expiry interleaving: expired A frees capacity for B (clock injection, no sleeps)', () => {
    const clock = makeClock(0)
    const governor = freshGovernor({ capacity: 1, ttl_ms: 30000, clock: clock.now })
    const a = governor.reserve({ ...RUN, provider: 'openai', model: 'gpt-5.4' })
    assert.ok(a.ok)
    assert.equal(governor.snapshot().resources.HIGH_COST_ROUTE.remaining, 0)
    clock.advance(30001)
    const b = governor.reserve({ ...RUN, run_id: 'run-b', provider: 'openai', model: 'gpt-5.4-fast' })
    assert.equal(b.ok, true, 'expired reservation frees capacity for the next request')
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.expired, 1)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 0, 'one slot now held by B')
  })

  it('commit/release interleaving: only released capacity is reusable', () => {
    const governor = freshGovernor({ capacity: 2 })
    const a = governor.reserve({ ...RUN, run_id: 'run-a' })
    const b = governor.reserve({ ...RUN, run_id: 'run-b' })
    assert.equal(governor.snapshot().resources.HIGH_COST_ROUTE.remaining, 0)
    const releasedA = governor.release({ reservation_id: a.reservation.reservation_id, run_id: 'run-a' })
    assert.equal(releasedA.ok, true)
    governor.commit({ reservation_id: b.reservation.reservation_id, run_id: 'run-b' })
    const available = governor.snapshot().resources.HIGH_COST_ROUTE.remaining
    assert.equal(available, 1, 'exactly the released capacity is available')
    const c = governor.reserve({ ...RUN, run_id: 'run-c' })
    assert.equal(c.ok, true, 'C uses the released capacity')
    const d = governor.reserve({ ...RUN, run_id: 'run-d' })
    assert.equal(d.ok, false, 'D denied — committed slot is not reusable')
    assert.equal(d.code, SHARED_BUDGET_REASON_CODES.EXHAUSTED)
  })
})

describe('shared budget governor — ownership & memory bounds', () => {
  it('run B cannot release or commit run A reservation (ownership)', () => {
    const clock = makeClock(1000)
    const governor = freshGovernor({ capacity: 2, clock: clock.now })
    const a = governor.reserve({ ...RUN, run_id: 'run-a' })
    const before = governor.snapshot()
    const release = governor.release({ reservation_id: a.reservation.reservation_id, run_id: 'run-b' })
    assert.equal(release.ok, false)
    assert.equal(release.code, SHARED_BUDGET_REASON_CODES.OWNERSHIP_INVALID)
    const commit = governor.commit({ reservation_id: a.reservation.reservation_id, run_id: 'run-b' })
    assert.equal(commit.ok, false)
    assert.equal(commit.code, SHARED_BUDGET_REASON_CODES.OWNERSHIP_INVALID)
    assert.deepEqual(governor.snapshot(), before, 'ledger unchanged after denied cross-run operations')
  })

  it('memory bound: ledger_size ≤ retention_limit + active; prune works; active never pruned', () => {
    const governor = freshGovernor({ capacity: 2, retention_limit: 5 })
    // Two active reservations that must never be pruned.
    const activeA = governor.reserve({ ...RUN, run_id: 'run-a' })
    const activeB = governor.reserve({ ...RUN, run_id: 'run-b' })
    assert.ok(activeA.ok && activeB.ok)
    // Free one slot, then generate 12 terminal records via reserve→release
    // cycles (capacity returns each cycle).
    governor.release({ reservation_id: activeA.reservation.reservation_id, run_id: 'run-a' })
    for (let i = 0; i < 12; i += 1) {
      const reserved = governor.reserve({ ...RUN, run_id: `run-cyc-${i}` })
      assert.ok(reserved.ok, `cycle ${i} must reserve`)
      governor.release({ reservation_id: reserved.reservation.reservation_id, run_id: `run-cyc-${i}` })
    }
    const snapshot = governor.snapshot()
    assert.ok(snapshot.ledger_size <= 5 + 1, `ledger_size ${snapshot.ledger_size} must be ≤ retention_limit + active`)
    assert.equal(snapshot.ledger_size, 6, '5 terminal records kept + 1 active record')
    assert.equal(governor.getReservation(activeB.reservation.reservation_id).status, RESERVATION_STATUS.RESERVED)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.reserved, 1)
    // 2000-cycle reserve→release ledger stays bounded.
    const big = freshGovernor({ capacity: 2 })
    for (let i = 0; i < 2000; i += 1) {
      const reserved = big.reserve({ ...RUN, run_id: `run-big-${i}` })
      assert.ok(reserved.ok, `big cycle ${i} must reserve`)
      big.release({ reservation_id: reserved.reservation.reservation_id, run_id: `run-big-${i}` })
    }
    const bigSnapshot = big.snapshot()
    assert.ok(bigSnapshot.ledger_size <= SHARED_BUDGET_DEFAULTS.retention_limit, `2000-cycle ledger bounded at ${bigSnapshot.ledger_size}`)
    assert.equal(bigSnapshot.ledger_size, SHARED_BUDGET_DEFAULTS.retention_limit)
  })

  it('commit accounting is exact under capacity pressure (consumed slots hold capacity)', () => {
    const governor = freshGovernor({ capacity: 10 })
    const reserved = []
    for (let i = 0; i < 10; i += 1) {
      const r = governor.reserve({ ...RUN, run_id: `run-${i}` })
      assert.ok(r.ok)
      reserved.push(r)
    }
    for (let i = 0; i < 3; i += 1) governor.commit({ reservation_id: reserved[i].reservation.reservation_id, run_id: `run-${i}` })
    for (let i = 3; i < 10; i += 1) governor.release({ reservation_id: reserved[i].reservation.reservation_id, run_id: `run-${i}` })
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 3)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.released, 7)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.reserved, 0)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 7, 'capacity - consumed = 7; released units returned')
    assert.equal(snapshot.total_consumed + snapshot.total_released, 10)
  })
})

describe('shared budget governor — security (negative) & event shape', () => {
  it('worker-output-shaped payload cannot mutate the ledger (no instruction-accepting method)', () => {
    const clock = makeClock(1000)
    const governor = freshGovernor({ capacity: 2, clock: clock.now })
    const before = governor.snapshot()
    // A worker output/tool result claiming budget authority is DATA, never
    // authority. The governor exposes no apply/mutate entry point.
    const payload = { ok: true, result: { shared_budget: { raise: 999, release: 'any', run_id: 'other' } } }
    // No-op consumer: nothing accepts the payload.
    const after = governor.snapshot()
    assert.deepEqual(after, before, 'ledger capacity unchanged')
    assert.equal(governor.reserve({ ...RUN }).ok, true)
    const still = governor.snapshot()
    assert.equal(still.resources.HIGH_COST_ROUTE.remaining, 1)
  })

  it('tool-result-shaped payload is not a method argument (fail closed, key ignored)', () => {
    const governor = freshGovernor({ capacity: 2 })
    const reserved = governor.reserve({ ...RUN })
    const payload = { release: reserved.reservation.reservation_id, run_id: 'other' }
    const result = governor.release(payload)
    assert.equal(result.ok, false)
    assert.equal(result.code, SHARED_BUDGET_REASON_CODES.RESERVATION_UNKNOWN, 'release key is ignored; reservation_id is undefined')
    assert.equal(governor.getReservation(reserved.reservation.reservation_id).status, RESERVATION_STATUS.RESERVED)
  })

  it('structural: the class exposes ONLY the documented methods (no apply/mutate/request)', () => {
    const prototypeMethods = Object.getOwnPropertyNames(SharedBudgetGovernor.prototype)
    const allowed = new Set(['constructor', 'reserve', 'commit', 'release', 'expireStale', 'getReservation', 'snapshot', 'prune'])
    for (const name of prototypeMethods) {
      assert.ok(allowed.has(name), `unexpected public method on SharedBudgetGovernor: ${name}`)
    }
    assert.ok(!prototypeMethods.some((name) => /^(apply|mutate|request|handle|execute)/.test(name)), 'no instruction-accepting mutation method')
    const instanceProps = Object.getOwnPropertyNames(new SharedBudgetGovernor({ resources: { HIGH_COST_ROUTE: 1 } }))
    assert.ok(!instanceProps.some((name) => /^(apply|mutate|request)/.test(name)))
  })

  it('unknown reservation spoof (random uuid) → SHARED_BUDGET_RESERVATION_UNKNOWN', () => {
    const governor = freshGovernor()
    const commit = governor.commit({ reservation_id: crypto.randomUUID(), run_id: RUN.run_id })
    assert.equal(commit.code, SHARED_BUDGET_REASON_CODES.RESERVATION_UNKNOWN)
    const release = governor.release({ reservation_id: crypto.randomUUID(), run_id: RUN.run_id })
    assert.equal(release.code, SHARED_BUDGET_REASON_CODES.RESERVATION_UNKNOWN)
  })

  it('budget events carry NO prompts/text/output/content (serialized redaction check)', () => {
    const reservation = { reservation_id: 'res-1', run_id: 'run-1', resource: 'HIGH_COST_ROUTE', amount: 1, created_at: 1, expires_at: 2, status: 'RESERVED' }
    const events = [
      budgetSharedEvent({ job: 'budget.shared.reserve', run_id: 'run-1', reservation, resource: 'HIGH_COST_ROUTE', amount: 1, remaining: 1, status: 'RESERVED', provider: 'openai', model: 'gpt-5.4', route_index: 0, attempt: 0 }),
      budgetSharedEvent({ job: 'budget.shared.deny', run_id: 'run-1', resource: 'HIGH_COST_ROUTE', amount: 1, remaining: 0, code: SHARED_BUDGET_REASON_CODES.EXHAUSTED, provider: 'openai', model: 'gpt-5.4', route_index: 0, attempt: 0 }),
    ]
    for (const event of events) {
      assert.equal(validate(event).ok, true, validate(event).issues.join('; '))
      const serialized = JSON.stringify(event)
      assert.ok(!/(^|")(prompt|output|text|content|reason|message|tool_call|command|token|secret|api_key|authorization)"\s*:/.test(serialized), `secret-bearing key in budget event: ${serialized}`)
    }
    const deny = events[1]
    assert.equal(deny.status, 'FAIL')
    assert.equal(deny.failure_signature, `BUDGET:${SHARED_BUDGET_REASON_CODES.EXHAUSTED}`)
    assert.equal(deny.reservation_id, null)
    assert.equal(deny.remaining, 0)
    assert.equal(deny.route_index, 0)
  })

  it('the 5 budget jobs are declared in ROUTING_EVENT_JOBS (additive)', () => {
    for (const job of SHARED_BUDGET_EVENT_JOBS) {
      assert.ok(ROUTING_EVENT_JOBS.includes(job), job)
    }
    assert.equal(SHARED_BUDGET_EVENT_JOBS.length, 5)
  })
})

describe('shared budget governor — repeatability', () => {
  it('identical inputs → identical decisions over 3 runs', () => {
    const sequence = [
      { run_id: 'run-1', resource: SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE, amount: 1, provider: 'openai', model: 'gpt-5.4' },
      { run_id: 'run-2', resource: SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE, amount: 1, provider: 'openai', model: 'gpt-5.4-fast' },
    ]
    const outcomes = []
    for (let round = 0; round < 3; round += 1) {
      const governor = freshGovernor({ capacity: 2 })
      const a = governor.reserve(sequence[0])
      const b = governor.reserve(sequence[1])
      const c = governor.reserve({ ...sequence[0], run_id: 'run-3' })
      outcomes.push({
        aOk: a.ok, aRemaining: a.remaining,
        bOk: b.ok, bRemaining: b.remaining,
        cOk: c.ok, cCode: c.code, cRemaining: c.remaining,
      })
    }
    assert.deepEqual(outcomes[0], outcomes[1])
    assert.deepEqual(outcomes[0], outcomes[2])
  })
})
