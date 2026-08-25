// SPDX-License-Identifier: MIT
/**
 * OCAE Production Sentinel tests.
 *
 * Positive proof (F):
 *   - the unmodified current baseline passes every sentinel invariant
 *   - the structural baseline fingerprint is stable and matches the record
 *
 * Negative drift proofs (isolated fixtures, never touching real files):
 *   A. canonical runtime missing          → SENTINEL FAIL
 *   B. required contract missing          → SENTINEL FAIL
 *   C. legacy fallback reintroduced       → SENTINEL FAIL
 *   D. installer drift                    → SENTINEL FAIL
 *   E. manifest/runner drift              → SENTINEL FAIL
 *   fingerprint drift                     → SENTINEL FAIL
 *   G. cancellation-release marker removed → BUDGET_CANCELLATION_RELEASE FAIL
 *   H. consume marker removed → BUDGET_NO_ORPHAN_RESERVATIONS FAIL
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { repoRoot } from '../helpers.mjs'
import {
  SENTINEL_INVARIANTS,
  REQUIRED_CONTRACT_IDS,
  REQUIRED_TERMINAL_STATES,
  runProductionSentinel,
  checkCanonicalRuntime,
  checkContractIds,
  checkNoSilentLegacyFallback,
  checkInstallerBaseline,
  checkTestRunnerExhaustive,
  checkBaselineFingerprint,
  checkBaselineManifest,
  computeBaselineFingerprint,
  checkHealthStateTtlBounded,
  checkUnhealthyModelNotRouted,
  checkHealthProbeBounded,
  checkHighCostEscalationPolicyGated,
  checkRoutingBudgetBounded,
  checkUsageNoSecretLeak,
  checkSharedBudgetRuntimeAuthority,
  checkSharedBudgetAtomicReservation,
  checkSharedBudgetReservationTtl,
  checkSharedBudgetWorkerCannotMutate,
  checkDegradedRoutingPolicyDeterministic,
  checkSharedBudgetNoSecretLeak,
  checkBudgetCancellationRelease,
  checkBudgetNoOrphanReservations,
} from '../../scripts/lib/production-sentinel.mjs'

async function makeFixtureRoot(t, prefix = 'ocae-sentinel-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

describe('production sentinel — current baseline must pass (F)', () => {
  it('unmodified baseline passes all sentinel invariants', async () => {
    const result = await runProductionSentinel({ repoRoot })
    assert.equal(result.status, 'PASS', result.issues.join('\n'))
    assert.equal(result.results.length, 80, 'expected the full evaluated invariant set (core + availability/cost + shared-budget/degraded + budget lifecycle + visual QA + hierarchical model-harness)')
    for (const entry of result.results) {
      assert.equal(entry.ok, true, `${entry.invariant}: ${entry.issues.join(' | ')}`)
    }
    const invariantIds = result.results.map((entry) => entry.invariant)
    for (const invariant of SENTINEL_INVARIANTS) {
      assert.ok(invariantIds.includes(invariant), `invariant ${invariant} must be evaluated`)
    }
  })

  it('baseline manifest matches canonical structure and records the fingerprint', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'runtime', 'production-baseline.json'), 'utf8'))
    const manifestCheck = await checkBaselineManifest({ repoRoot })
    assert.equal(manifestCheck.ok, true, manifestCheck.issues.join('\n'))
    assert.equal(manifest.canonical_entry, 'runtime/run.mjs')
    assert.equal(manifest.canonical_test_command, 'npm test')
    assert.equal(manifest.legacy_execution_status, 'RETIRED')
    assert.deepEqual([...manifest.terminal_states].sort(), [...REQUIRED_TERMINAL_STATES].sort())
    for (const contract of REQUIRED_CONTRACT_IDS) assert.ok(manifest.contracts.includes(contract), contract)
    for (const invariant of SENTINEL_INVARIANTS) assert.ok(manifest.critical_invariants.includes(invariant), invariant)
  })

  it('structural fingerprint is stable and matches the recorded baseline', async () => {
    const { fingerprint } = await computeBaselineFingerprint({ repoRoot })
    const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'runtime', 'production-baseline.json'), 'utf8'))
    assert.equal(fingerprint, manifest.baseline_fingerprint, 'live fingerprint must equal the recorded baseline fingerprint')
    const check = await checkBaselineFingerprint({ repoRoot })
    assert.equal(check.ok, true, check.issues.join('\n'))
  })
})

describe('production sentinel — negative drift proofs', () => {
  it('A: canonical runtime missing → SENTINEL FAIL', async (t) => {
    const root = await makeFixtureRoot(t, 'ocae-sentinel-missing-runtime-')
    const result = await checkCanonicalRuntime({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('runtime/run.mjs missing')), result.issues.join('\n'))
  })

  it('B: required contract removed → SENTINEL FAIL', async (t) => {
    const root = await makeFixtureRoot(t, 'ocae-sentinel-missing-contract-')
    await fs.mkdir(path.join(root, 'runtime', 'contracts'), { recursive: true })
    // Only one of the ten canonical contracts survives in the fixture.
    await fs.writeFile(path.join(root, 'runtime', 'contracts', 'task.mjs'), "export const CONTRACT_ID = 'ecosystem.task.v1'\n", 'utf8')
    const result = await checkContractIds({ repoRoot: root })
    assert.equal(result.ok, false)
    for (const missing of ['ecosystem.decision.v1', 'ecosystem.verification.v1', 'ecosystem.run-event.v1']) {
      assert.ok(result.issues.some((issue) => issue.includes(missing)), `missing contract not detected: ${missing}`)
    }
  })

  it('C: legacy fallback reintroduced in the normal entry → SENTINEL FAIL', async (t) => {
    const fallbackPlugin = `export const CanonicalGovernancePlugin = async () => ({
      'chat.message': async function (input, output) {
        try {
          await import('../../runtime/run.mjs')
        } catch (error) {
          await import('../../runtime/agent/run-state.mjs')
        }
      },
    })`
    const result = await checkNoSilentLegacyFallback({ repoRoot, pluginSource: fallbackPlugin })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('NO_SILENT_LEGACY_FALLBACK')), result.issues.join('\n'))
  })

  it('C2: legacy startAgent call inside a catch block → SENTINEL FAIL', async (t) => {
    const fallbackPlugin = `export const CanonicalGovernancePlugin = async () => ({
      'chat.message': async function (input, output) {
        let entry = null
        try {
          entry = await import('../../runtime/run.mjs')
        } catch (error) {
          entry = await startAgent(input, output)
        }
      },
    })`
    const result = await checkNoSilentLegacyFallback({ repoRoot, pluginSource: fallbackPlugin })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('catch block')), result.issues.join('\n'))
  })

  it('C3: legacy module import anywhere in the plugin entry → SENTINEL FAIL', async (t) => {
    const driftedPlugin = `import { bootstrapTask } from '../../runtime/bootstrap/task-bootstrap.mjs'
import { startAgent } from '../../runtime/agent/start.mjs'
export const CanonicalGovernancePlugin = async () => ({ 'chat.message': async () => {}, 'tool.execute.before': async () => {} })`
    const result = await checkNoSilentLegacyFallback({ repoRoot, pluginSource: driftedPlugin })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('legacy execution module')), result.issues.join('\n'))
  })

  it('D: installer drift — canonical artifact absent from install set → SENTINEL FAIL', async (t) => {
    const realList = (await import('../../scripts/install-governance.mjs')).getRuntimeFileList()
    const drifted = realList.filter((entry) => entry.dest !== 'run.mjs')
    const result = await checkInstallerBaseline({ repoRoot, runtimeFileList: drifted })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('run.mjs')), result.issues.join('\n'))
  })

  it('D2: installer drift — legacy execution artifact in install set → SENTINEL FAIL', async (t) => {
    const realList = (await import('../../scripts/install-governance.mjs')).getRuntimeFileList()
    const drifted = [...realList, { source: 'runtime/agent/start.mjs', dest: 'agent/start.mjs' }]
    const result = await checkInstallerBaseline({ repoRoot, runtimeFileList: drifted })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('legacy execution artifact')), result.issues.join('\n'))
  })

  it('E: manifest drift — required group missing → SENTINEL FAIL', async (t) => {
    const badManifest = {
      version: 1,
      groups: {
        unit: ['test/helpers.mjs'],
        // bootstrap group missing entirely
      },
    }
    const result = await checkTestRunnerExhaustive({ repoRoot, manifest: badManifest })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('missing group "bootstrap"')), result.issues.join('\n'))
    assert.ok(result.issues.some((issue) => issue.includes('fixture/helper')), result.issues.join('\n'))
  })

  it('E2: manifest drift — invalid entry shape → SENTINEL FAIL', async (t) => {
    const badManifest = {
      version: 1,
      groups: {
        unit: ['not-a-test-file.txt'],
        contract: [],
        integration: [],
        bootstrap: [],
        governance: [],
        e2e: [],
        provider_optional: [],
      },
    }
    const result = await checkTestRunnerExhaustive({ repoRoot, manifest: badManifest })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('not a test file')), result.issues.join('\n'))
  })

  it('fingerprint drift → SENTINEL FAIL', async (t) => {
    const result = await checkBaselineFingerprint({ repoRoot, baselineManifest: { baseline_fingerprint: 'deadbeef' } })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('BASELINE_FINGERPRINT')), result.issues.join('\n'))
  })
})

describe('production sentinel — availability & cost negative drift proofs', () => {
  // NOTE: mutations must remove the marker string entirely (checks are
  // includes()-based; an X-suffixed target like `usageRedactedX` still
  // contains the original substring). Multi-occurrence markers use replaceAll.
  async function makeRuntimeFixture(t, sourceFiles, mutate) {
    const root = await makeFixtureRoot(t, 'ocae-sentinel-availcost-')
    for (const [name, transform] of Object.entries(sourceFiles)) {
      const source = await fs.readFile(path.join(repoRoot, 'runtime', 'routing', name), 'utf8')
      await fs.mkdir(path.join(root, 'runtime', 'routing'), { recursive: true })
      await fs.writeFile(path.join(root, 'runtime', 'routing', name), transform(source), 'utf8')
    }
    return root
  }

  it('A: health TTL removed → SENTINEL FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'health-state.mjs': (source) => source.replaceAll('clampTtl', 'clmpTtlX'),
    })
    const result = await checkHealthStateTtlBounded({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('HEALTH_STATE_TTL_BOUNDED')), result.issues.join('\n'))
  })

  it('B: unhealthy candidate allowed → SENTINEL FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'routing-policy.mjs': (source) => source.replaceAll('healthRoutable', 'healthGateRemoved'),
    })
    const result = await checkUnhealthyModelNotRouted({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('UNHEALTHY_MODEL_NOT_ROUTED')), result.issues.join('\n'))
  })

  it('C: probe bound removed → SENTINEL FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'health-probe.mjs': (source) => source.replaceAll('max_probe_attempts', 'maxProbeAttemptsBudget'),
    })
    const result = await checkHealthProbeBounded({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('HEALTH_PROBE_BOUNDED')), result.issues.join('\n'))
  })

  it('D: high-cost gate removed → SENTINEL FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'routing-policy.mjs': (source) => source.replaceAll('allow_high_cost_escalation', 'allowHighCostEscalation'),
    })
    const result = await checkHighCostEscalationPolicyGated({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('HIGH_COST_ESCALATION_POLICY_GATED')), result.issues.join('\n'))
  })

  it('E: routing budget removed → SENTINEL FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'routing-policy.mjs': (source) => source.replaceAll('max_high_cost_routes', 'maxHighCostRoutes'),
    })
    const result = await checkRoutingBudgetBounded({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('ROUTING_BUDGET_BOUNDED')), result.issues.join('\n'))
  })

  it('F: usage secret-redaction removed → SENTINEL FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'usage.mjs': (source) => source.replace('usageRedacted', 'removedRedactionFn'),
    })
    const result = await checkUsageNoSecretLeak({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('USAGE_NO_SECRET_LEAK')), result.issues.join('\n'))
  })
})

describe('production sentinel — shared budget & degraded negative drift proofs', () => {
  // Same isolated-fixture pattern; budget-governor.mjs and routing-policy.mjs
  // are read from the real repo and mutated in the temp root only.
  async function makeRuntimeFixture(t, sourceFiles, mutate) {
    const root = await makeFixtureRoot(t, 'ocae-sentinel-budget-')
    for (const [name, transform] of Object.entries(sourceFiles)) {
      const source = await fs.readFile(path.join(repoRoot, 'runtime', 'routing', name), 'utf8')
      await fs.mkdir(path.join(root, 'runtime', 'routing'), { recursive: true })
      await fs.writeFile(path.join(root, 'runtime', 'routing', name), transform(source), 'utf8')
    }
    return root
  }

  it('A: expireStale removed from the governor → SHARED_BUDGET_RESERVATION_TTL FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'budget-governor.mjs': (source) => source.replaceAll('expireStale', 'expireOldSlots'),
    })
    const result = await checkSharedBudgetReservationTtl({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('SHARED_BUDGET_RESERVATION_TTL')), result.issues.join('\n'))
  })

  it('B: healthRankOf removed from the policy → DEGRADED_ROUTING_POLICY_DETERMINISTIC FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'routing-policy.mjs': (source) => source.replaceAll('healthRankOf', 'healthOrderRank'),
    })
    const result = await checkDegradedRoutingPolicyDeterministic({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('DEGRADED_ROUTING_POLICY_DETERMINISTIC')), result.issues.join('\n'))
  })

  it('C: WORKER_CANNOT_MUTATE marker removed → SHARED_BUDGET_WORKER_CANNOT_MUTATE FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'budget-governor.mjs': (source) => source.replace('WORKER_CANNOT_MUTATE', 'WORKER_MARKER_REMOVED'),
    })
    const result = await checkSharedBudgetWorkerCannotMutate({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('SHARED_BUDGET_WORKER_CANNOT_MUTATE')), result.issues.join('\n'))
  })

  it('D: SYNCHRONOUS_RESERVE_ATOMIC marker AND structural reserve marker removed → SHARED_BUDGET_ATOMIC_RESERVATION FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'budget-governor.mjs': (source) => source
        .replaceAll('SYNCHRONOUS_RESERVE_ATOMIC', 'ATOMICITY_MARKER_REMOVED')
        .replace('reservation_id: crypto.randomUUID()', 'reservation_id: uuid()'),
    })
    const result = await checkSharedBudgetAtomicReservation({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('SHARED_BUDGET_ATOMIC_RESERVATION')), result.issues.join('\n'))
    assert.ok(result.issues.some((issue) => issue.includes('crypto.randomUUID')), 'structural marker removal must be detected: ' + result.issues.join('\n'))
  })

  it('E: runtime authority wiring removed → SHARED_BUDGET_RUNTIME_AUTHORITY FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'budget-governor.mjs': (source) => source.replace('class SharedBudgetGovernor', 'class SharedBudgetLedger'),
    })
    const result = await checkSharedBudgetRuntimeAuthority({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('SHARED_BUDGET_RUNTIME_AUTHORITY')), result.issues.join('\n'))
  })

  it('F: budget event secret field marker removed → SHARED_BUDGET_NO_SECRET_LEAK FAIL', async (t) => {
    const root = await makeRuntimeFixture(t, {
      'budget-governor.mjs': (source) => source.replace('SHARED_BUDGET_NO_SECRET_LEAK', 'SECRET_LEAK_MARKER_REMOVED'),
    })
    const result = await checkSharedBudgetNoSecretLeak({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('SHARED_BUDGET_NO_SECRET_LEAK')), result.issues.join('\n'))
  })

  // Pipeline lifecycle fixture: reads the REAL runtime/pipeline/pipeline.mjs
  // from repoRoot and writes a mutated copy to the temp root (mkdir recursive),
  // mirroring the routing fixture pattern but for the pipeline file. The REAL
  // runtime/routing/budget-governor.mjs is copied unmutated as well so the
  // BUDGET_NO_ORPHAN_RESERVATIONS failure is attributable to the pipeline
  // mutation, not to the fail-closed missing-file path.
  async function makePipelineFixture(t, transform) {
    const root = await makeFixtureRoot(t, 'ocae-sentinel-budget-pipeline-')
    const source = await fs.readFile(path.join(repoRoot, 'runtime', 'pipeline', 'pipeline.mjs'), 'utf8')
    await fs.mkdir(path.join(root, 'runtime', 'pipeline'), { recursive: true })
    await fs.writeFile(path.join(root, 'runtime', 'pipeline', 'pipeline.mjs'), transform(source), 'utf8')
    // Mirror makeRuntimeFixture: copy the REAL governor from the repo.
    const budget = await fs.readFile(path.join(repoRoot, 'runtime', 'routing', 'budget-governor.mjs'), 'utf8')
    await fs.mkdir(path.join(root, 'runtime', 'routing'), { recursive: true })
    await fs.writeFile(path.join(root, 'runtime', 'routing', 'budget-governor.mjs'), budget, 'utf8')
    return root
  }

  it('G: abort-closure release marker removed from the pipeline → BUDGET_CANCELLATION_RELEASE FAIL', async (t) => {
    const root = await makePipelineFixture(t, (source) => source.replaceAll('SHARED_BUDGET_ABORT_CLOSURE_RELEASED', 'ABORT_CLOSURE_MARKER_REMOVED'))
    const result = await checkBudgetCancellationRelease({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('BUDGET_CANCELLATION_RELEASE')), result.issues.join('\n'))
  })

  it('H: pipeline consume marker removed → BUDGET_NO_ORPHAN_RESERVATIONS FAIL', async (t) => {
    const root = await makePipelineFixture(t, (source) => source.replaceAll('budget.shared.consume', 'budget.shared.spent'))
    const result = await checkBudgetNoOrphanReservations({ repoRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.includes('BUDGET_NO_ORPHAN_RESERVATIONS')), result.issues.join('\n'))
  })
})
