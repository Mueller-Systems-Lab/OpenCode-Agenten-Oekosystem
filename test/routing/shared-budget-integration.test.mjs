// SPDX-License-Identifier: MIT
/**
 * Shared runtime budget + degraded routing — canonical runtime integration.
 *
 * Real runTask through the deterministic pipeline (routeExecutor seam — no
 * real provider calls). Proves the shared budget lifecycle inside the runtime:
 *   reserve BEFORE invocation → worker → commit AFTER result → controller.
 * And degraded routing through the full run entry (fixture health store).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { runTask } from '../../runtime/run.mjs'
import { validate } from '../../runtime/contracts/run-event.mjs'
import {
  SharedBudgetGovernor,
  SHARED_BUDGET_RESOURCES,
  RESERVATION_STATUS,
} from '../../runtime/routing/budget-governor.mjs'
import { HealthStore } from '../../runtime/routing/health-state.mjs'
import { DEFAULT_MODEL_CATALOG, DEFAULT_ROUTING_POLICY } from '../../runtime/routing/index.mjs'

const PLAN = '# Plan\n## Targets\n- proof.json — write the proof file\n## Acceptance Criteria\n- proof.json exists\n## Required Tests\n- none\n## Build Scope\nfiles: proof.json'

const HIGH_OVERRIDE = { provider: 'openai', model: 'gpt-5.4' }
const COST_POLICY = {
  allow_high_cost_escalation: true,
  allow_cost_escalation: true,
  max_high_cost_routes: 2,
}
// The canonical catalog lists gpt-5.4 as 'configured' (not yet probed). For
// the fixture we promote it to 'reachable' so the HIGH-cost override is a
// valid route (no real provider call happens — routeExecutor is a seam).
const HIGH_CATALOG = DEFAULT_MODEL_CATALOG.map((entry) => (
  entry.provider === 'openai' && entry.model === 'gpt-5.4' ? { ...entry, availability: 'reachable' } : entry
))

async function fixtureRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-shared-budget-it-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

function routeExecutorFor(calls) {
  return (route, { attempt }) => async () => {
    calls.push({ provider: route.provider, model: route.model, attempt, cost_tier: route.cost_tier })
    return { status: 'SUCCESS', changed_files: [], errors: [], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }
  }
}

function countEvents(events, job) {
  return events.filter((e) => e.job === job).length
}

function deniedRunAssertions(result, { runId = null } = {}) {
  assert.equal(result.decision.decision, 'BLOCKED')
  assert.equal(result.decision.reason_code, 'SHARED_BUDGET_EXHAUSTED')
  if (runId) assert.equal(result.run_id, runId)
  assert.equal(countEvents(result.events, 'model.worker.start'), 0, 'denied run must have ZERO worker invocations')
  assert.equal(result.build_result, null, 'denied run must have build_result null')
  assert.ok(result.events.some((e) => e.job === 'budget.shared.deny'), 'denial must be observable')
}

describe('shared budget — canonical runtime integration', () => {
  it('CASE 1: single run reserve + consume → DONE, worker invoked exactly once', async (t) => {
    const root = await fixtureRoot(t)
    const calls = []
    const result = await runTask({
      taskInput: { task: 'single high-cost run', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: routeExecutorFor(calls),
      routing: {
        enabled: true,
        explicit_override: HIGH_OVERRIDE,
        catalog: HIGH_CATALOG,
        cost_policy: COST_POLICY,
        shared_budget: { enabled: true },
      },
    })
    assert.equal(result.phase, 'PIPELINE')
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.route.cost_tier, 'HIGH')
    assert.equal(calls.length, 1, 'worker invoked exactly once')
    assert.equal(countEvents(result.events, 'budget.shared.reserve'), 1)
    assert.equal(countEvents(result.events, 'budget.shared.consume'), 1)
    assert.equal(countEvents(result.events, 'model.worker.start'), 1)
    const consume = result.events.find((e) => e.job === 'budget.shared.consume')
    assert.equal(consume.status, 'PASS')
    assert.ok(consume.reservation_id, 'consume event carries the reservation_id')
    assert.equal(consume.resource, SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE)
    const reserve = result.events.find((e) => e.job === 'budget.shared.reserve')
    assert.equal(reserve.budget_status, RESERVATION_STATUS.RESERVED)
  })

  it('CASE 2: ONE shared governor (capacity 2) across THREE parallel runs → 2 DONE, 1 BLOCKED, denied has 0 worker calls', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 2 } })
    const calls = []
    const makeRun = () => runTask({
      taskInput: { task: 'concurrent high-cost run', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: routeExecutorFor(calls),
      routing: {
        enabled: true,
        explicit_override: HIGH_OVERRIDE,
        catalog: HIGH_CATALOG,
        cost_policy: COST_POLICY,
        shared_budget: { enabled: true, governor },
      },
    })
    const results = await Promise.all([makeRun(), makeRun(), makeRun()])
    const done = results.filter((r) => r.decision.decision === 'DONE')
    const blocked = results.filter((r) => r.decision.reason_code === 'SHARED_BUDGET_EXHAUSTED')
    assert.equal(done.length, 2, 'exactly 2 runs may invoke the worker')
    assert.equal(blocked.length, 1, 'exactly 1 run is denied')
    for (const run of done) {
      assert.equal(countEvents(run.events, 'model.worker.start'), 1)
    }
    deniedRunAssertions(blocked[0])
    assert.equal(calls.length, 2, 'productive high-cost calls = 2')
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 2, 'both invocations consumed their slots')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 0)
  })

  it('CASE 3: shared governor (capacity 1) across TWO parallel runs → 1 DONE, 1 BLOCKED', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 1 } })
    const calls = []
    const makeRun = () => runTask({
      taskInput: { task: 'exhausted capacity run', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: routeExecutorFor(calls),
      routing: {
        enabled: true,
        explicit_override: HIGH_OVERRIDE,
        catalog: HIGH_CATALOG,
        cost_policy: COST_POLICY,
        shared_budget: { enabled: true, governor },
      },
    })
    const results = await Promise.all([makeRun(), makeRun()])
    const done = results.filter((r) => r.decision.decision === 'DONE')
    const blocked = results.filter((r) => r.decision.reason_code === 'SHARED_BUDGET_EXHAUSTED')
    assert.equal(done.length, 1)
    assert.equal(blocked.length, 1)
    deniedRunAssertions(blocked[0])
    assert.equal(calls.length, 1, 'only one high-cost invocation')
  })

  it('CASE 4: released capacity is reusable at runtime (controlled cancellation before invocation)', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 2 } })
    const calls = []
    // Simulate a controlled cancellation BEFORE the worker invocation per the
    // canonical lifecycle: reserve → (cancel) → release.
    const reserved = governor.reserve({ run_id: 'cancelled-run', resource: SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE, amount: 1, provider: 'openai', model: 'gpt-5.4' })
    assert.equal(reserved.ok, true)
    assert.equal(governor.snapshot().resources.HIGH_COST_ROUTE.remaining, 1)
    const released = governor.release({ reservation_id: reserved.reservation.reservation_id, run_id: 'cancelled-run' })
    assert.equal(released.ok, true)
    assert.equal(governor.snapshot().resources.HIGH_COST_ROUTE.remaining, 2, 'released capacity restored')
    // A real run can now reserve and commit that capacity.
    const result = await runTask({
      taskInput: { task: 'reuse released capacity', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: routeExecutorFor(calls),
      routing: {
        enabled: true,
        explicit_override: HIGH_OVERRIDE,
        catalog: HIGH_CATALOG,
        cost_policy: COST_POLICY,
        shared_budget: { enabled: true, governor },
      },
    })
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(calls.length, 1)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 1)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 1)
  })

  it('CASE 5: expired reservation restores capacity (real short wait, TTL clamped to 1500ms)', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 1 }, ttl_ms: 1500 })
    assert.equal(governor.ttl_ms, 1500)
    const calls = []
    // Manual reservation that is never committed/released → abandoned. Only
    // TTL expiry can recover its capacity.
    const reserved = governor.reserve({ run_id: 'abandoned-run', resource: SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE, amount: 1, provider: 'openai', model: 'gpt-5.4' })
    assert.equal(reserved.ok, true)
    assert.equal(governor.snapshot().resources.HIGH_COST_ROUTE.remaining, 0)
    await new Promise((resolve) => setTimeout(resolve, 1600))
    // The run's reserve() calls expireStale first → abandoned slot recovered.
    const result = await runTask({
      taskInput: { task: 'reuse expired capacity', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: routeExecutorFor(calls),
      routing: {
        enabled: true,
        explicit_override: HIGH_OVERRIDE,
        catalog: HIGH_CATALOG,
        cost_policy: COST_POLICY,
        shared_budget: { enabled: true, governor },
      },
    })
    assert.equal(result.decision.decision, 'DONE', 'expired capacity must be reusable by the runtime')
    assert.equal(calls.length, 1)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.expired, 1, 'abandoned reservation expired')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 1)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 0)
  })
})

describe('shared budget — escalation to a HIGH route (review FIX 1)', () => {
  // onWorkerFailure seam that escalates to a HIGH-cost model (openai/gpt-5.4)
  // regardless of the classified failure — exercises the pipeline's
  // transition-target tier resolution + shared-budget reservation gate.
  const escalateToHigh = async () => ({
    action: 'ESCALATE',
    next_route: { provider: 'openai', model: 'gpt-5.4' },
    routing_reason: 'ESCALATION_TEST',
    reason_code: 'ESCALATION_ALLOWED',
    transition_reason: 'QUALITY_ESCALATION',
  })

  function failingThenHighExecutor(calls, root) {
    return (route, { attempt }) => async () => {
      calls.push({ provider: route.provider, model: route.model, attempt, cost_tier: route.cost_tier })
      if (route.provider === 'openai' && route.model === 'gpt-5.4') {
        await fs.writeFile(path.join(root, 'proof.json'), JSON.stringify({ ecosystem_proof: 'multi-model', value: 42 }))
        return { status: 'SUCCESS', changed_files: ['proof.json'], errors: [], usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } }
      }
      // A THROWN error → runNativeBuild produces a FAILURE build_result (a
      // returned object is always wrapped as SUCCESS), which drives the
      // verified-fail path into the onWorkerFailure escalation seam.
      throw new Error('MODEL_CAPABILITY_INSUFFICIENT: insufficient capability for the task')
    }
  }

  it('escalation to a HIGH route reserves shared capacity for the NEW route (reserve before escalated worker, commit after)', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 2 } })
    const calls = []
    const result = await runTask({
      taskInput: { task: 'escalate to high', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: failingThenHighExecutor(calls, root),
      onWorkerFailure: escalateToHigh,
      routing: {
        enabled: true,
        cost_policy: COST_POLICY,
        shared_budget: { enabled: true, governor },
      },
    })
    assert.equal(result.decision.decision, 'DONE')
    // The initial LOW route escalates to the HIGH model.
    assert.deepEqual(calls.map((c) => c.model), ['deepseek-v4-flash', 'gpt-5.4'])
    assert.equal(calls[1].cost_tier, 'HIGH', 'rebuilt routeState must carry the REAL tier of the transition target')
    // (a) reserve event for the HIGH route BEFORE the escalated invocation.
    const reserve = result.events.find((e) => e.job === 'budget.shared.reserve')
    assert.ok(reserve, 'a budget.shared.reserve event must exist for the escalated HIGH route')
    assert.equal(reserve.provider, 'openai')
    assert.equal(reserve.model, 'gpt-5.4')
    const escalatedStart = result.events.find((e) => e.job === 'model.worker.start' && e.provider === 'openai' && e.model === 'gpt-5.4')
    assert.ok(escalatedStart, 'escalated worker start must exist')
    assert.ok(result.events.indexOf(reserve) < result.events.indexOf(escalatedStart), 'reserve must precede the escalated worker invocation')
    // (b) the escalated invocation actually happened.
    assert.equal(calls.filter((c) => c.model === 'gpt-5.4').length, 1)
    // (c) commit after the escalated invocation.
    const consume = result.events.find((e) => e.job === 'budget.shared.consume' && e.provider === 'openai' && e.model === 'gpt-5.4')
    assert.ok(consume, 'a budget.shared.consume event must follow the escalated invocation')
    assert.equal(consume.status, 'PASS')
    assert.ok(result.events.indexOf(escalatedStart) < result.events.indexOf(consume))
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 1, 'escalated HIGH invocation consumed its shared slot')
  })

  it('escalation to a HIGH route with exhausted shared capacity → escalated worker NOT invoked, BLOCKED SHARED_BUDGET_EXHAUSTED', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 1 } })
    // Another run holds the only slot — capacity is exhausted at escalation time.
    const held = governor.reserve({ run_id: 'other-run', resource: SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE, amount: 1, provider: 'openai', model: 'gpt-5.4' })
    assert.equal(held.ok, true)
    const calls = []
    const result = await runTask({
      taskInput: { task: 'escalate into exhausted budget', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: failingThenHighExecutor(calls, root),
      onWorkerFailure: escalateToHigh,
      routing: {
        enabled: true,
        cost_policy: COST_POLICY,
        shared_budget: { enabled: true, governor },
      },
    })
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'SHARED_BUDGET_EXHAUSTED')
    // Only the initial LOW invocation happened; the escalated HIGH worker was NOT invoked.
    assert.deepEqual(calls.map((c) => c.model), ['deepseek-v4-flash'])
    assert.equal(calls.filter((c) => c.model === 'gpt-5.4').length, 0)
    assert.equal(countEvents(result.events, 'model.worker.start'), 1)
    const deny = result.events.find((e) => e.job === 'budget.shared.deny' && e.provider === 'openai' && e.model === 'gpt-5.4')
    assert.ok(deny, 'budget.shared.deny for the escalated HIGH route must be emitted')
    assert.equal(deny.status, 'FAIL')
    assert.equal(deny.failure_signature, 'BUDGET:SHARED_BUDGET_EXHAUSTED')
    assert.equal(result.build_result, null)
  })
})

describe('shared budget — configuration fails closed (review MINOR 1)', () => {
  it('non-HIGH_COST_ROUTE resource → deterministic CONFIG_INVALID throw', async (t) => {
    const root = await fixtureRoot(t)
    await assert.rejects(
      runTask({
        taskInput: { task: 'misconfigured budget resource', repository: root },
        repoRoot: root,
        routing: { shared_budget: { enabled: true, resource: 'SOME_OTHER_RESOURCE' } },
      }),
      /CONFIG_INVALID:shared_budget\.resource must be HIGH_COST_ROUTE/,
    )
  })
})

describe('degraded routing — canonical runtime integration', () => {  function healthStoreWith(entries) {
    const store = new HealthStore()
    for (const [provider, model, status] of entries) {
      store.applyProbeResult({ provider, model, status, ttl_seconds: 600 })
    }
    return store
  }

  it('CASE 6a: primary DEGRADED + allow_degraded=true → routed on the DEGRADED model (degraded:true)', async (t) => {
    const root = await fixtureRoot(t)
    const calls = []
    const result = await runTask({
      taskInput: { task: 'degraded primary routing', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: routeExecutorFor(calls),
      routing: {
        enabled: true,
        policy: { ...(await import('../../runtime/routing/index.mjs')).DEFAULT_ROUTING_POLICY, health_policy: { allow_degraded: true } },
        health: {
          enabled: true,
          store: healthStoreWith([['deepseek', 'deepseek-v4-flash', 'DEGRADED']]),
          probe_policy: { max_candidates_probed_per_route: 0 },
        },
      },
    })
    assert.equal(result.phase, 'PIPELINE')
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.route.model, 'deepseek-v4-flash')
    assert.equal(result.route.routing_reason, 'PRIMARY_ROUTE')
    assert.equal(result.route.health_status, 'DEGRADED')
    assert.equal(result.route.degraded, true)
    assert.deepEqual(calls, [{ provider: 'deepseek', model: 'deepseek-v4-flash', attempt: 0, cost_tier: 'LOW' }])
  })

  it('CASE 6b: only DEGRADED candidate + allow_degraded=false → ROUTING_BLOCKED, NO worker invocation', async (t) => {
    const root = await fixtureRoot(t)
    const calls = []
    const result = await runTask({
      taskInput: { task: 'degraded denied routing', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: routeExecutorFor(calls),
      routing: {
        enabled: true,
        health: {
          enabled: true,
          store: healthStoreWith([['deepseek', 'deepseek-v4-flash', 'DEGRADED']]),
          probe_policy: { max_candidates_probed_per_route: 0 },
        },
      },
    })
    assert.equal(result.phase, 'ROUTING_BLOCKED')
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'DEGRADED_ROUTE_DENIED')
    assert.equal(calls.length, 0, 'NO worker invocation on a denied degraded route')
    assert.equal(countEvents(result.events, 'model.worker.start'), 0)
    assert.ok(result.events.some((e) => e.job === 'model.route.rejected'))
  })
})

describe('shared budget — structural lifecycle closure (Phase A stop-gate)', () => {
  // A routeExecutor that THROWS during executor creation simulates an
  // exception escaping the reserve → invoke → commit window BEFORE any
  // productive worker invocation (pre-spawn abort). The structural closure
  // must deterministically RELEASE the reservation (capacity restored) before
  // runTask rethrows the original error (non-CONTRACT_INVALID errors rethrow).
  const preSpawnThrowingExecutor = () => {
    throw new Error('PRE_SPAWN_ABORT')
  }
  const routingWithGovernor = (governor) => ({
    enabled: true,
    explicit_override: HIGH_OVERRIDE,
    catalog: HIGH_CATALOG,
    cost_policy: COST_POLICY,
    shared_budget: { enabled: true, governor },
  })

  it('LIFECYCLE 1: reserve → pre-spawn abort (routeExecutor throw) → RELEASED, capacity restored, no orphan RESERVED', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 1 } })
    // runTask rethrows the original non-CONTRACT_INVALID error.
    await assert.rejects(
      runTask({
        taskInput: { task: 'pre-spawn abort high-cost run', repository: root },
        repoRoot: root,
        nativePlan: { planText: PLAN },
        verifyChecks: [],
        routeExecutor: preSpawnThrowingExecutor,
        routing: routingWithGovernor(governor),
      }),
      /PRE_SPAWN_ABORT/,
      'the original executor-creation error must propagate out of runTask',
    )
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.released, 1, 'reservation deterministically RELEASED')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.reserved, 0, 'NO orphan RESERVED record survives the abort')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 1, 'released capacity restored to the full capacity')
  })

  it('LIFECYCLE 2: exception → budget.shared.release observable (valid run-event v1) + governor release proof', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 1 } })
    const sinkPath = path.join(root, 'events.jsonl')
    await assert.rejects(
      runTask({
        taskInput: { task: 'observable pre-spawn abort', repository: root },
        repoRoot: root,
        nativePlan: { planText: PLAN },
        verifyChecks: [],
        routeExecutor: preSpawnThrowingExecutor,
        eventSink: sinkPath,
        routing: routingWithGovernor(governor),
      }),
      /PRE_SPAWN_ABORT/,
    )
    const sinkEvents = (await fs.readFile(sinkPath, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
    const release = sinkEvents.find((e) => e.job === 'budget.shared.release')
    assert.ok(release, 'a budget.shared.release event must be emitted after the pre-spawn abort')
    assert.equal(countEvents(sinkEvents, 'budget.shared.release'), 1)
    assert.equal(release.budget_status, RESERVATION_STATUS.RELEASED, 'release event carries the RELEASED reservation status')
    assert.ok(release.reservation_id, 'release event carries the reservation_id')
    assert.equal(release.resource, SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE)
    assert.equal(release.strategy_delta, 'SHARED_BUDGET_ABORT_CLOSURE_RELEASED')
    const validation = validate(release)
    assert.equal(validation.ok, true, `release event must be a valid ecosystem.run-event.v1: ${validation.issues.join('; ')}`)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.released, 1)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.reserved, 0)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 1)
  })

  it('LIFECYCLE 3: worker returns FAILURE result → CONSUMED (consume boundary holds, no leak)', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 1 } })
    const calls = []
    const failingResultExecutor = (route, { attempt }) => async () => {
      calls.push({ provider: route.provider, model: route.model, attempt, cost_tier: route.cost_tier })
      return { status: 'FAILURE', changed_files: [], errors: ['boom'] }
    }
    const result = await runTask({
      taskInput: { task: 'worker failure high-cost run', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: failingResultExecutor,
      routing: routingWithGovernor(governor),
    })
    assert.equal(result.phase, 'PIPELINE', 'the run completes through the controller (terminal decision)')
    // A RETURNED worker object is always wrapped as SUCCESS by the
    // native-build adapter (documented runNativeBuild behavior — the
    // escalation test drives the real FAILURE path with a THROWN error), so
    // the controller terminates DONE and the FAILURE signal flows as data in
    // build_result.errors. The budget lifecycle is the invariant under test:
    // the worker WAS productively invoked → the reservation is CONSUMED
    // regardless of the returned outcome (consume boundary).
    assert.ok(
      ['DONE', 'SPLIT', 'BLOCKED', 'FIX'].includes(result.decision.decision),
      `terminal decision expected, got ${result.decision.decision}`,
    )
    assert.equal(calls.length, 1, 'worker was productively invoked exactly once')
    assert.deepEqual(result.build_result.errors, ['boom'], 'FAILURE signal flows as build data')
    assert.equal(countEvents(result.events, 'budget.shared.consume'), 1)
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 1, 'productive invocation consumed the slot')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.reserved, 0, 'worker failure must NOT leave an orphan RESERVED record')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 0, 'consumed slot holds its capacity')
  })

  it('LIFECYCLE 4: released capacity immediately reusable at pipeline level (same governor, capacity 1)', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 1 } })
    // First run aborts pre-spawn → the structural closure RELEASES the slot.
    await assert.rejects(
      runTask({
        taskInput: { task: 'first run pre-spawn abort', repository: root },
        repoRoot: root,
        nativePlan: { planText: PLAN },
        verifyChecks: [],
        routeExecutor: preSpawnThrowingExecutor,
        routing: routingWithGovernor(governor),
      }),
      /PRE_SPAWN_ABORT/,
    )
    let snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.released, 1)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 1, 'capacity restored after the aborted run')
    // Second run against the SAME governor must reserve, invoke and commit
    // the released capacity → DONE.
    const calls = []
    const result = await runTask({
      taskInput: { task: 'second run reuses released capacity', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: routeExecutorFor(calls),
      routing: routingWithGovernor(governor),
    })
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(calls.length, 1)
    snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 1, 'second run consumed the reused slot')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.released, 1, 'release record preserved')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.reserved, 0)
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 0)
  })

  it('LIFECYCLE 5: run_id forgery → CONTRACT_INVALID abort → CONSUMED, no orphan RESERVED (GAP-2 no-orphan)', async (t) => {
    const root = await fixtureRoot(t)
    const governor = new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 1 } })
    const forgedRunIdExecutor = (route, { attempt }) => async () => {
      // The worker forges a run_id different from the run's immutable id → the
      // pipeline aborts deterministically with CONTRACT_INVALID AFTER the
      // worker was productively invoked.
      return { changed_files: [], errors: [], run_id: 'forged-run-id' }
    }
    const result = await runTask({
      taskInput: { task: 'forged run_id high-cost run', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: [],
      routeExecutor: forgedRunIdExecutor,
      routing: routingWithGovernor(governor),
    })
    assert.equal(result.phase, 'ABORTED')
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'CONTRACT_INVALID')
    const snapshot = governor.snapshot()
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.reserved, 0, 'abort must NOT leave capacity leaked as RESERVED')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.consumed, 1, 'the productive invocation consumed the slot')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.released, 0, 'no release after a productive invocation')
    assert.equal(snapshot.resources.HIGH_COST_ROUTE.remaining, 0, 'consumed slot holds its capacity')
  })
})
