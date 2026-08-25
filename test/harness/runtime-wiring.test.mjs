// SPDX-License-Identifier: MIT
/**
 * Canonical runtime + hierarchical model-harness wiring integration tests.
 *
 * Proves the additive wiring inside runTask: after a successful route
 * selection the deterministic harness resolver runs, `model.harness.resolved`
 * is emitted with flat evidence fields, `route.harness` is attached, worker
 * profile requests are DENIED, and contract violations fail closed via the
 * routing rejection path. No real worker/model call — routeExecutor is a stub.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { runTask } from '../../runtime/run.mjs'
import { DEFAULT_ROUTING_POLICY } from '../../runtime/routing/index.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from '../../runtime/harness/model-harness-profiles.mjs'

async function fixtureRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-harness-it-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

/**
 * The harness resolution event is emitted in the ENTRY phase of runTask. For
 * PIPELINE-phase returns the pipeline's own events array is the result
 * surface (existing canonical semantics), so the entry events are read from
 * the real JSONL event sink — the durable observability path.
 */
async function sinkEvents(sinkPath) {
  const raw = await fs.readFile(sinkPath, 'utf8')
  return raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
}

const PLAN = '# Plan\n## Targets\n- proof.json — write the proof file\n## Acceptance Criteria\n- proof.json exists with exact JSON\n## Required Tests\n- node check\n## Build Scope\nfiles: proof.json'

function verifyChecks(root) {
  return [{
    command: 'node',
    args: ['-e', "const fs=require('fs');const c=JSON.parse(fs.readFileSync('proof.json','utf8'));if(c.value!==42)process.exit(1)"],
    cwd: root,
  }]
}

function stubRouteExecutor(root) {
  return (route) => async () => {
    assert.ok(route.harness, 'routeExecutor receives route.harness additively')
    await fs.writeFile(path.join(root, 'proof.json'), JSON.stringify({ ecosystem_proof: 'harness-wiring', value: 42 }))
    return { changed_files: ['proof.json'], errors: [], strategy_delta: null }
  }
}

describe('canonical runtime harness wiring', () => {
  it('routing enabled → harness resolved (generic fallback for routed model), event + route.harness + DONE pipeline intact', async (t) => {
    const root = await fixtureRoot(t)
    const sink = path.join(root, 'run-events.jsonl')
    const result = await runTask({
      taskInput: { task: 'harness wiring proof', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor: stubRouteExecutor(root),
      routing: { enabled: true },
      eventSink: sink,
    })
    assert.equal(result.phase, 'PIPELINE')
    assert.equal(result.decision.decision, 'DONE', 'harness wiring changes no pipeline semantics')
    assert.equal(result.route.model, 'deepseek-v4-flash')
    // route.harness is attached additively
    assert.ok(result.route.harness)
    assert.equal(result.route.harness.resolution, 'GENERIC_FALLBACK', 'no profile for the routed model → safe generic harness')
    assert.equal(result.route.harness.profile_full_id, 'generic.v1')
    assert.match(result.route.harness.fingerprint, /^[0-9a-f]{64}$/)
    // the resolution is observable in the event sink with flat evidence fields
    const events = (await sinkEvents(sink)).filter((e) => e.job === 'model.harness.resolved')
    assert.equal(events.length, 1)
    assert.equal(events[0].status, 'PASS')
    assert.equal(events[0].harness_resolution, 'GENERIC_FALLBACK')
    assert.equal(events[0].model_profile, 'generic')
    assert.equal(events[0].profile_version, 1)
    assert.equal(events[0].task_role, 'BUILD')
    assert.equal(events[0].effective_harness_fingerprint, result.route.harness.fingerprint)
    assert.equal(events[0].worker_self_selection, 'NONE')
    // harness resolution happens after route selection
    const allSinkEvents = await sinkEvents(sink)
    const selectedIdx = allSinkEvents.findIndex((e) => e.job === 'model.route.selected')
    const harnessIdx = allSinkEvents.findIndex((e) => e.job === 'model.harness.resolved')
    assert.ok(selectedIdx !== -1 && harnessIdx > selectedIdx)
  })

  it('worker_requested_profile → event carries worker_self_selection DENIED, resolution unchanged', async (t) => {
    const root = await fixtureRoot(t)
    const sink = path.join(root, 'run-events.jsonl')
    const result = await runTask({
      taskInput: { task: 'self-selection denial proof', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor: stubRouteExecutor(root),
      routing: {
        enabled: true,
        harness: { worker_requested_profile: 'muse.v1' },
      },
      eventSink: sink,
    })
    assert.equal(result.phase, 'PIPELINE')
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.route.harness.resolution, 'GENERIC_FALLBACK', 'worker request never changes the harness')
    const events = (await sinkEvents(sink)).filter((e) => e.job === 'model.harness.resolved')
    assert.equal(events.length, 1)
    assert.equal(events[0].worker_self_selection, 'DENIED')
  })

  it('evaluation-style run: opencode policy + reachable fixture entry + allow_candidate → hy3 model profile', async (t) => {
    const root = await fixtureRoot(t)
    // Fixture catalog (stub, not the canonical registry): the free model is
    // marked reachable ONLY for this test run — production routing policy and
    // the canonical catalog are untouched.
    const fixtureCatalog = [{
      provider: 'opencode',
      model: 'hy3-free',
      enabled: true,
      availability: 'reachable',
      tool_support: true,
      mcp_support: false,
      vision_support: false,
      structured_output: 'STANDARD',
      cost_tier: 'LOW',
      quality_tier: 'LOW',
      context_tier: 'MEDIUM',
      default_primary: true,
      capabilities: ['tools', 'structured_output'],
    }]
    const fixturePolicy = {
      ...DEFAULT_ROUTING_POLICY,
      primary_provider: 'opencode',
      primary_model: 'hy3-free',
      allowed_providers: ['opencode'],
      provider_fallback_allowlist: ['opencode'],
    }
    const sink = path.join(root, 'run-events.jsonl')
    const result = await runTask({
      taskInput: { task: 'candidate profile proof', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor: stubRouteExecutor(root),
      routing: {
        enabled: true,
        catalog: fixtureCatalog,
        policy: fixturePolicy,
        harness: { allow_candidate: true, task_role: 'BUILD', profiles: DEFAULT_MODEL_HARNESS_PROFILES },
      },
      eventSink: sink,
    })
    assert.equal(result.phase, 'PIPELINE')
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.route.model, 'hy3-free')
    assert.equal(result.route.harness.resolution, 'MODEL_PROFILE')
    assert.equal(result.route.harness.profile_full_id, 'hy3.v1')
    assert.equal(result.route.harness.worker_self_selection, 'NONE')
    const events = (await sinkEvents(sink)).filter((e) => e.job === 'model.harness.resolved')
    assert.equal(events[0].harness_resolution, 'MODEL_PROFILE')
    assert.equal(events[0].model_profile, 'hy3')
  })

  it('candidate without allow_candidate → generic fallback even when the model is routed', async (t) => {
    const root = await fixtureRoot(t)
    const fixtureCatalog = [{
      provider: 'opencode',
      model: 'hy3-free',
      enabled: true,
      availability: 'reachable',
      tool_support: true,
      mcp_support: false,
      vision_support: false,
      structured_output: 'STANDARD',
      cost_tier: 'LOW',
      quality_tier: 'LOW',
      context_tier: 'MEDIUM',
      default_primary: true,
      capabilities: ['tools', 'structured_output'],
    }]
    const result = await runTask({
      taskInput: { task: 'candidate gating proof', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor: stubRouteExecutor(root),
      routing: {
        enabled: true,
        catalog: fixtureCatalog,
        policy: {
          ...DEFAULT_ROUTING_POLICY,
          primary_provider: 'opencode',
          primary_model: 'hy3-free',
          allowed_providers: ['opencode'],
          provider_fallback_allowlist: ['opencode'],
        },
      },
    })
    assert.equal(result.phase, 'PIPELINE')
    assert.equal(result.route.harness.resolution, 'GENERIC_FALLBACK', 'candidates never auto-apply in production')
    assert.equal(result.route.harness.profile_full_id, 'generic.v1')
  })

  it('real canonical worker boundary receives composed task text, tools, and matching evidence', async (t) => {
    const root = await fixtureRoot(t)
    const received = []
    const fixtureCatalog = [{
      provider: 'opencode', model: 'hy3-free', enabled: true, availability: 'reachable',
      tool_support: true, mcp_support: false, vision_support: false,
      structured_output: 'STANDARD', cost_tier: 'LOW', quality_tier: 'LOW',
      context_tier: 'MEDIUM', default_primary: true, capabilities: ['tools'],
    }]
    const routeExecutor = (route) => async (input) => {
      received.push({ route, input })
      await fs.writeFile(path.join(root, 'proof.json'), JSON.stringify({ value: 42 }))
      return { changed_files: ['proof.json'], errors: [], strategy_delta: null }
    }
    const result = await runTask({
      taskInput: { task: 'Create proof.json with exactly {"value":42}', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor,
      routing: {
        enabled: true,
        catalog: fixtureCatalog,
        policy: { ...DEFAULT_ROUTING_POLICY, primary_provider: 'opencode', primary_model: 'hy3-free', allowed_providers: ['opencode'], provider_fallback_allowlist: ['opencode'] },
        harness: { allow_candidate: true, task_role: 'BUILD', profiles: DEFAULT_MODEL_HARNESS_PROFILES },
      },
    })
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(received.length, 1)
    assert.equal(received[0].route.harness.profile_id, 'hy3')
    assert.match(received[0].input.worker_task_text, /Planning: keep the plan compact/)
    assert.match(received[0].input.worker_task_text, /Create proof\.json/)
    assert.deepEqual(received[0].input.effective_tools, [])
    assert.equal(received[0].input.harness_evidence.effective_harness_fingerprint, received[0].route.harness.fingerprint)
  })

  it('route transition re-resolves the harness and never sends stale profile evidence', async (t) => {
    const root = await fixtureRoot(t)
    const received = []
    const catalog = [
      { provider: 'opencode', model: 'hy3-free', enabled: true, availability: 'reachable', tool_support: true, mcp_support: false, vision_support: false, structured_output: 'STANDARD', cost_tier: 'LOW', quality_tier: 'LOW', context_tier: 'MEDIUM', default_primary: true, capabilities: ['tools'] },
      { provider: 'opencode', model: 'nemotron-3-ultra-free', enabled: true, availability: 'reachable', tool_support: true, mcp_support: false, vision_support: false, structured_output: 'STANDARD', cost_tier: 'LOW', quality_tier: 'MEDIUM', context_tier: 'MEDIUM', default_primary: false, capabilities: ['tools'] },
    ]
    const routeExecutor = (route) => async (input) => {
      received.push({ route, input })
      if (route.model === 'nemotron-3-ultra-free') {
        await fs.writeFile(path.join(root, 'proof.json'), JSON.stringify({ value: 42 }))
      }
      return { changed_files: route.model === 'nemotron-3-ultra-free' ? ['proof.json'] : [], errors: [], strategy_delta: null }
    }
    let failureCalls = 0
    const result = await runTask({
      taskInput: { task: 'Create proof.json', repository: root, max_attempts: 1 },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor,
      onWorkerFailure: async () => {
        failureCalls += 1
        return failureCalls === 1
          ? { next_route: { provider: 'opencode', model: 'nemotron-3-ultra-free' }, routing_reason: 'ESCALATION' }
          : null
      },
      routing: {
        enabled: true,
        catalog,
        policy: { ...DEFAULT_ROUTING_POLICY, primary_provider: 'opencode', primary_model: 'hy3-free', allowed_providers: ['opencode'], provider_fallback_allowlist: ['opencode'] },
        harness: { allow_candidate: true, task_role: 'BUILD', profiles: DEFAULT_MODEL_HARNESS_PROFILES },
      },
    })
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(received.length, 2)
    assert.equal(received[0].route.harness.profile_id, 'hy3')
    assert.equal(received[1].route.model, 'nemotron-3-ultra-free')
    assert.equal(received[1].route.harness.profile_id, 'nemotron')
    assert.equal(received[1].input.harness_evidence.model_profile, 'nemotron')
    assert.notEqual(received[0].input.harness_evidence.effective_harness_fingerprint, received[1].input.harness_evidence.effective_harness_fingerprint)
  })

  it('invalid harness task_role → BLOCKED with HARNESS_CONTRACT_INVALID (routing rejection path)', async (t) => {
    const root = await fixtureRoot(t)
    const result = await runTask({
      taskInput: { task: 'contract invalid proof', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor: stubRouteExecutor(root),
      routing: {
        enabled: true,
        harness: { task_role: 'NOT_A_ROLE' },
      },
    })
    assert.equal(result.phase, 'ROUTING_BLOCKED')
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'HARNESS_CONTRACT_INVALID')
    assert.equal(result.route, null)
    assert.ok(result.events.some((e) => e.job === 'model.harness.resolved' && e.status === 'FAIL'))
    assert.ok(result.events.some((e) => e.failure_signature === 'HARNESS_CONTRACT_INVALID'))
  })
})
