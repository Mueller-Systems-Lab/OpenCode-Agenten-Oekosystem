// SPDX-License-Identifier: MIT
/**
 * Default shared-governor production wiring — canonical runtime concurrency
 * proofs (SHARED_GOVERNOR_PRODUCTION_WIRING_GAP closure).
 *
 * Real runTask through the deterministic pipeline (routeExecutor seam — no
 * real provider calls). Proves:
 *   CASE A: WITHOUT an explicit governor, three parallel normal-entry runs
 *           share ONE process-wide default governor (capacity defaults to 2)
 *           → exactly 2 DONE, 1 BLOCKED SHARED_BUDGET_EXHAUSTED.
 *   CASE B: an explicitly passed governor ALWAYS wins — two runs with their
 *           OWN governor instances bypass the singleton entirely.
 *   CASE C: a conflicting default-singleton configuration fails closed with
 *           CONFIG_INVALID:shared_budget.singleton_config_conflict.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  runTask,
  defaultSharedBudgetGovernor,
  resetDefaultSharedBudgetGovernorForTests,
} from '../../runtime/run.mjs'
import {
  SharedBudgetGovernor,
  SHARED_BUDGET_RESOURCES,
} from '../../runtime/routing/budget-governor.mjs'
import { DEFAULT_MODEL_CATALOG } from '../../runtime/routing/index.mjs'

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-shared-budget-wiring-'))
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

describe('shared budget — default governor production wiring', () => {
  it('CASE A: default wiring — three parallel normal-entry runs share ONE process-wide governor → 2 DONE, 1 SHARED_BUDGET_EXHAUSTED', async (t) => {
    resetDefaultSharedBudgetGovernorForTests()
    t.after(() => resetDefaultSharedBudgetGovernorForTests())
    const root = await fixtureRoot(t)
    assert.equal(defaultSharedBudgetGovernor(), null, 'singleton must start cleared')
    const calls = []
    // NO governor key anywhere in shared_budget — this is the point: the
    // process-wide default governor must be used and shared.
    const makeRun = () => runTask({
      taskInput: { task: 'concurrent high-cost run (default wiring)', repository: root },
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
    const results = await Promise.all([makeRun(), makeRun(), makeRun()])
    const done = results.filter((r) => r.decision.decision === 'DONE')
    const blocked = results.filter((r) => r.decision.reason_code === 'SHARED_BUDGET_EXHAUSTED')
    assert.equal(done.length, 2, 'exactly 2 runs may invoke the worker through the shared default governor')
    assert.equal(blocked.length, 1, 'exactly 1 run is denied by the shared default governor')
    assert.equal(blocked[0].decision.decision, 'BLOCKED')
    assert.equal(calls.length, 2, 'total productive worker calls across ALL runs = 2')
    const deniedRun = blocked[0]
    assert.equal(countEvents(deniedRun.events, 'model.worker.start'), 0, 'denied run must have ZERO worker invocations')
    assert.equal(deniedRun.build_result, null, 'denied run must have build_result null')
    assert.ok(deniedRun.events.some((e) => e.job === 'budget.shared.deny'), 'denial must be observable')
    const singleton = defaultSharedBudgetGovernor()
    assert.ok(singleton instanceof SharedBudgetGovernor, 'the process-wide default governor must exist after the runs')
    const snapshot = singleton.snapshot()
    assert.equal(snapshot.resources[SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE].capacity, 2, 'default capacity when not specified: 2')
    assert.ok(snapshot.total_reservations >= 2, `default governor must hold the shared reservations (got ${snapshot.total_reservations})`)
  })

  it('CASE B: explicit governor still wins over the singleton — own instances bypass it entirely', async (t) => {
    resetDefaultSharedBudgetGovernorForTests()
    t.after(() => resetDefaultSharedBudgetGovernorForTests())
    const root = await fixtureRoot(t)
    const calls = []
    // Each run brings its OWN explicitly created governor (capacity 2 each).
    const makeRun = (governor) => runTask({
      taskInput: { task: 'explicit governor run', repository: root },
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
    const results = await Promise.all([
      makeRun(new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 2 } })),
      makeRun(new SharedBudgetGovernor({ resources: { [SHARED_BUDGET_RESOURCES.HIGH_COST_ROUTE]: 2 } })),
    ])
    for (const result of results) {
      assert.equal(result.decision.decision, 'DONE', 'each explicitly injected governor allows its own reservation')
    }
    assert.equal(calls.length, 2, 'both runs invoked the worker productively (no cross-run denial)')
    assert.equal(defaultSharedBudgetGovernor(), null, 'explicit injection must bypass the singleton (it stays untouched/null)')
  })

  it('CASE C: conflicting singleton configuration fails closed → CONFIG_INVALID singleton_config_conflict', async (t) => {
    resetDefaultSharedBudgetGovernorForTests()
    t.after(() => resetDefaultSharedBudgetGovernorForTests())
    const root = await fixtureRoot(t)
    // First normal-entry run creates the singleton from the FIRST config
    // encountered (defaults). The throw happens inside runTask before any
    // pipeline work — mirroring the propagation style of the existing
    // CONFIG_INVALID resource-mismatch throw (rejected promise).
    await runTask({
      taskInput: { task: 'first run creates the default singleton', repository: root },
      repoRoot: root,
      routing: { shared_budget: { enabled: true } },
    })
    const singletonAfterFirst = defaultSharedBudgetGovernor()
    assert.ok(singletonAfterFirst instanceof SharedBudgetGovernor, 'first run must lazily create the default singleton')
    // A later run requesting a DIFFERENT effective singleton configuration
    // must fail closed — loud, never silent.
    await assert.rejects(
      runTask({
        taskInput: { task: 'second run with conflicting ttl_ms', repository: root },
        repoRoot: root,
        routing: { shared_budget: { enabled: true, ttl_ms: 123456 } },
      }),
      /CONFIG_INVALID.*singleton_config_conflict/,
    )
    assert.equal(
      defaultSharedBudgetGovernor(),
      singletonAfterFirst,
      'a conflicting request must NOT replace or mutate the existing singleton',
    )
  })

  it('CASE C-b: semantically identical configuration does NOT conflict (effective-config comparison)', async (t) => {
    resetDefaultSharedBudgetGovernorForTests()
    t.after(() => resetDefaultSharedBudgetGovernorForTests())
    const root = await fixtureRoot(t)
    await runTask({
      taskInput: { task: 'create singleton with defaults', repository: root },
      repoRoot: root,
      routing: { shared_budget: { enabled: true } },
    })
    const singletonAfterFirst = defaultSharedBudgetGovernor()
    // Same effective config expressed differently (explicit default values)
    // must reuse the singleton, not fail closed.
    await assert.doesNotReject(
      runTask({
        taskInput: { task: 'same effective config', repository: root },
        repoRoot: root,
        routing: { shared_budget: { enabled: true, ttl_ms: 30000, retention_limit: 500 } },
      }),
    )
    assert.equal(defaultSharedBudgetGovernor(), singletonAfterFirst, 'identical effective config reuses the singleton')
  })
})
