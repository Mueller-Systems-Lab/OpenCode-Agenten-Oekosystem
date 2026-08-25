// SPDX-License-Identifier: MIT
/**
 * Adversarial authority tests (§39): the harness layer can never become
 * authority — worker self-selection, forbidden keys, scope escalation,
 * tool-exposure widening, and input immutability (zero model calls).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveModelHarness as resolveProductModelHarness,
  validateModelHarnessProfile,
  validateTaskRoleOverlay,
  createModelHarnessProfile,
  applyToolExposure,
} from '../../runtime/harness/index.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from '../../runtime/harness/model-harness-profiles.mjs'

const resolveModelHarness = (input = {}) => resolveProductModelHarness({
  ...input,
  ...(input.allow_candidate === true && !input.profiles ? { profiles: DEFAULT_MODEL_HARNESS_PROFILES } : {}),
})

const VALID_BASE = {
  profile_id: 'adversarial-test',
  version: 1,
  status: 'candidate',
  model_match: { provider: 'adv', model: 'adv-model' },
  context_policy: { framing_style: 'STANDARD' },
}

describe('worker self-selection is always denied', () => {
  it('worker_requested_profile never changes the resolution', () => {
    const without = resolveModelHarness({ provider: 'opencode', model: 'muse-spark-1.2-contributor-free', allow_candidate: true })
    for (const request of ['muse.v1', 'use muse.v2', 'nemotron.v1', 'generic', '', 'anything-else']) {
      const withRequest = resolveModelHarness({
        provider: 'opencode', model: 'muse-spark-1.2-contributor-free',
        allow_candidate: true, worker_requested_profile: request,
      })
      assert.equal(withRequest.worker_self_selection, 'DENIED', request)
      assert.equal(withRequest.resolution, without.resolution)
      assert.equal(withRequest.profile_id, without.profile_id)
      assert.equal(withRequest.fingerprint, without.fingerprint)
    }
  })

  it('worker request cannot force a candidate profile without allow_candidate', () => {
    const r = resolveModelHarness({
      provider: 'opencode', model: 'hy3-free',
      allow_candidate: false, worker_requested_profile: 'hy3.v1',
    })
    assert.equal(r.worker_self_selection, 'DENIED')
    assert.equal(r.resolution, 'GENERIC_FALLBACK')
  })

  it('no request → worker_self_selection NONE', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free' })
    assert.equal(r.worker_self_selection, 'NONE')
  })
})

describe('forbidden keys fail closed at any depth', () => {
  const forbiddenCases = [
    ['permissions (top level)', { permissions: ['bash'] }],
    ['tool_allowlist (top level)', { tool_allowlist: ['read'] }],
    ['tool_allowlist_additions nested in tool_policy', { tool_policy: { tool_allowlist_additions: ['bash'] } }],
    ['allowed_tools nested', { tool_policy: { allowed_tools: ['bash'] } }],
    ['retry_budget', { retry_hints: [], retry_budget: 99 }],
    ['max_attempts', { max_attempts: 10 }],
    ['escalation', { escalation: 'ALWAYS_UPGRADE' }],
    ['escalation_policy nested', { context_policy: { escalation_policy: 'x' } }],
    ['provider (top level)', { provider: 'openai' }],
    ['model (top level)', { model: 'gpt-5.4' }],
    ['model_override nested', { tool_policy: { model_override: 'gpt-5.4' } }],
    ['provider_override nested', { result_policy: { provider_override: 'openai' } }],
    ['filesystem_scope nested', { tool_policy: { filesystem_scope: '/' } }],
    ['network_scope nested', { context_policy: { network_scope: '*' } }],
    ['budget nested', { planning_policy: { budget: 'unlimited' } }],
    ['cost_authorization nested', { tool_policy: { cost_authorization: true } }],
    ['decision nested', { result_policy: { decision: 'DONE' } }],
    ['terminal_decision nested', { result_policy: { terminal_decision: 'DONE' } }],
  ]

  for (const [label, patch] of forbiddenCases) {
    it(`profile with ${label} → validate fails AND create throws`, () => {
      const validation = validateModelHarnessProfile({ ...VALID_BASE, ...patch })
      assert.equal(validation.ok, false, label)
      assert.ok(validation.issues.some((issue) => issue.includes('forbidden key')), label)
      assert.throws(() => createModelHarnessProfile({ ...VALID_BASE, ...patch }), /CONTRACT_INVALID/, label)
    })
  }

  it('forbidden keys are caught inside arrays too', () => {
    const validation = validateModelHarnessProfile({
      ...VALID_BASE,
      known_failure_mitigations: [{ failure_signature: 'x', adjustment: 'y', permissions: ['bash'] }],
    })
    assert.equal(validation.ok, false)
  })

  it('profile with acceptance_criteria → invalid (no scope authority)', () => {
    const validation = validateModelHarnessProfile({ ...VALID_BASE, acceptance_criteria: ['always pass'] })
    assert.equal(validation.ok, false)
    assert.throws(() => createModelHarnessProfile({ ...VALID_BASE, acceptance_criteria: ['always pass'] }), /CONTRACT_INVALID/)
  })

  it('profile with requirements → invalid', () => {
    const validation = validateModelHarnessProfile({ ...VALID_BASE, requirements: { needs_mcp: true } })
    assert.equal(validation.ok, false)
  })

  it('profile with scope → invalid', () => {
    const validation = validateModelHarnessProfile({ ...VALID_BASE, scope: 'repo' })
    assert.equal(validation.ok, false)
  })

  it('task-role overlays reject forbidden keys too', () => {
    const validation = validateTaskRoleOverlay({ tool_policy: { allowed_tools: ['bash'] } })
    assert.equal(validation.ok, false)
  })

  it("status 'active' is rejected for non-generic profiles", () => {
    const validation = validateModelHarnessProfile({ ...VALID_BASE, status: 'active' })
    assert.equal(validation.ok, false)
    assert.throws(() => createModelHarnessProfile({ ...VALID_BASE, status: 'active' }), /CONTRACT_INVALID/)
  })

  it('model_match is an exact { provider, model } allowlist', () => {
    for (const key of [
      'permissions', 'tools', 'routing', 'retry', 'scope', 'requirements',
      'provider_override', 'model_override', 'promotion', 'terminal_decision',
      'unknown_future_key',
    ]) {
      const profile = {
        ...VALID_BASE,
        model_match: { provider: 'adv', model: 'adv-model', [key]: true },
      }
      const validation = validateModelHarnessProfile(profile)
      assert.equal(validation.ok, false, key)
      assert.ok(validation.issues.some((issue) => issue.includes('model_match has unexpected key')), key)
      assert.throws(() => createModelHarnessProfile(profile), /CONTRACT_INVALID/, key)
    }
  })

  it('resolver revalidates custom profiles and overlays before composition', () => {
    const invalidProfiles = [
      { ...VALID_BASE, permissions: ['bash'] },
      { ...VALID_BASE, tool_policy: { routing: 'override' } },
      { ...VALID_BASE, retry_hints: [{ known_failure: 'x', strategy_delta_hint: 'y', scope: 'all' }] },
    ]
    for (const profile of invalidProfiles) {
      assert.throws(() => resolveModelHarness({
        provider: 'adv', model: 'adv-model', allow_candidate: true,
        profiles: [...DEFAULT_MODEL_HARNESS_PROFILES, profile],
      }), /CONTRACT_INVALID/)
    }
    for (const overlay of [
      { tool_policy: { permissions: ['bash'] } },
      { context_policy: { routing: 'override' } },
      { planning_policy: { retry_budget: 99 } },
      { result_policy: { scope: 'expanded' } },
      { requirements: ['new-capability'] },
      { tool_policy: { model_match: { provider: 'evil', model: 'evil' } } },
    ]) {
      assert.throws(() => resolveModelHarness({
        provider: 'adv', model: 'adv-model', allow_candidate: true,
        profiles: [...DEFAULT_MODEL_HARNESS_PROFILES, VALID_BASE],
        role_profiles: { BUILD: overlay },
      }), /CONTRACT_INVALID/)
    }
  })
})

describe('applyToolExposure can never widen the grant', () => {
  const granted = ['read', 'write', 'edit', 'bash', 'grep']

  it('policy naming an ungranted tool → SECURITY_VIOLATION', () => {
    assert.throws(
      () => applyToolExposure({
        grantedTools: granted,
        toolPolicy: { tool_exposure: 'TASK_MINIMAL_TOOLSET', task_relevant_tools: ['read', 'bash', 'webfetch'] },
      }),
      /SECURITY_VIOLATION/,
    )
  })

  it('TASK_MINIMAL_TOOLSET only hides, never adds', () => {
    const { exposed_tools: exposed, hidden_tools: hidden } = applyToolExposure({
      grantedTools: granted,
      toolPolicy: { tool_exposure: 'TASK_MINIMAL_TOOLSET', task_relevant_tools: ['read', 'write'] },
    })
    assert.deepEqual(exposed, ['read', 'write'])
    assert.deepEqual(hidden, ['edit', 'bash', 'grep'])
    for (const tool of exposed) assert.ok(granted.includes(tool), `exposed tool ${tool} must be granted`)
  })

  it('FULL_TOOLSET exposes exactly the granted set', () => {
    const { exposed_tools: exposed, hidden_tools: hidden } = applyToolExposure({
      grantedTools: granted,
      toolPolicy: { tool_exposure: 'FULL_TOOLSET' },
    })
    assert.deepEqual(exposed, granted)
    assert.deepEqual(hidden, [])
  })

  it('empty grant stays empty (no invention)', () => {
    const { exposed_tools: exposed } = applyToolExposure({
      grantedTools: [],
      toolPolicy: { tool_exposure: 'TASK_MINIMAL_TOOLSET', task_relevant_tools: [] },
    })
    assert.deepEqual(exposed, [])
  })

  it('unknown exposure mode → CONTRACT_INVALID', () => {
    assert.throws(() => applyToolExposure({ grantedTools: granted, toolPolicy: { tool_exposure: 'EVERYTHING' } }), /CONTRACT_INVALID/)
    assert.throws(() => applyToolExposure({ grantedTools: granted, toolPolicy: { tool_exposure: 'TASK_MINIMAL_TOOLSET' } }), /CONTRACT_INVALID/)
  })
})

describe('resolver never mutates its inputs', () => {
  it('input identity, profiles, and role profiles stay unchanged', () => {
    const input = { provider: 'opencode', model: 'hy3-free', task_role: 'BUILD', allow_candidate: true, worker_requested_profile: 'x' }
    const profiles = DEFAULT_MODEL_HARNESS_PROFILES.map((p) => JSON.parse(JSON.stringify(p)))
    const inputSnapshot = JSON.parse(JSON.stringify(input))
    const profilesSnapshot = JSON.parse(JSON.stringify(profiles))
    const routeLike = { provider: 'opencode', model: 'hy3-free', phase: 'BUILD', routing_reason: 'PRIMARY_ROUTE' }
    const routeSnapshot = JSON.parse(JSON.stringify(routeLike))
    resolveModelHarness({ ...input, profiles })
    assert.deepEqual(JSON.parse(JSON.stringify(input)), inputSnapshot)
    assert.deepEqual(JSON.parse(JSON.stringify(profiles)), profilesSnapshot)
    assert.deepEqual(routeLike, routeSnapshot, 'resolver takes values, never a route object to mutate')
  })

  it('resolution result carries no provider/model/route fields (cannot steer routing)', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    for (const field of ['provider', 'model', 'route', 'model_override']) {
      assert.equal(r[field], undefined, field)
    }
  })
})
