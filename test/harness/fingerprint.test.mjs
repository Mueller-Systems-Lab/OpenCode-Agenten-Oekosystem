// SPDX-License-Identifier: MIT
/**
 * Harness fingerprint tests: determinism, sensitivity, no timestamps.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveModelHarness as resolveProductModelHarness,
  createModelHarnessProfile,
} from '../../runtime/harness/index.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from '../../runtime/harness/model-harness-profiles.mjs'

const resolveModelHarness = (input = {}) => resolveProductModelHarness({
  ...input,
  ...(input.allow_candidate === true && !input.profiles ? { profiles: DEFAULT_MODEL_HARNESS_PROFILES } : {}),
})

function profileWith(overrides) {
  return createModelHarnessProfile({
    profile_id: 'fp-test',
    version: 1,
    status: 'candidate',
    model_match: { provider: 'fp', model: 'fp-model' },
    ...overrides,
  })
}

function resolveWith(profile, task_role = 'BUILD') {
  return resolveModelHarness({
    provider: 'fp', model: 'fp-model', allow_candidate: true,
    profiles: [...DEFAULT_MODEL_HARNESS_PROFILES, profile], task_role,
  })
}

describe('fingerprint determinism', () => {
  it('same effective harness → identical fingerprint (repeated recomputation)', () => {
    const base = profileWith({ context_policy: { framing_style: 'STANDARD' } })
    const f1 = resolveWith(base).fingerprint
    for (let i = 0; i < 5; i += 1) {
      assert.equal(resolveWith(profileWith({ context_policy: { framing_style: 'STANDARD' } })).fingerprint, f1)
    }
  })

  it('equal-value profiles produce equal fingerprints regardless of object identity', () => {
    const a = resolveWith(profileWith({ planning_policy: { granularity: 'COMPACT' } }))
    const b = resolveWith(profileWith({ planning_policy: { granularity: 'COMPACT' } }))
    assert.equal(a.fingerprint, b.fingerprint)
  })
})

describe('fingerprint sensitivity', () => {
  it('verbosity change → different fingerprint', () => {
    // REVIEW carries no scaffolding_verbosity overlay → the profile value stays visible
    const a = resolveWith(profileWith({ context_policy: { scaffolding_verbosity: 'STANDARD' } }), 'REVIEW')
    const b = resolveWith(profileWith({ context_policy: { scaffolding_verbosity: 'SHORT' } }), 'REVIEW')
    assert.notEqual(a.fingerprint, b.fingerprint)
  })

  it('tool exposure change → different fingerprint', () => {
    const a = resolveWith(profileWith({ tool_policy: { tool_exposure: 'FULL_TOOLSET', task_relevant_tools: ['read', 'write'] } }))
    const b = resolveWith(profileWith({ tool_policy: { tool_exposure: 'TASK_MINIMAL_TOOLSET', task_relevant_tools: ['read', 'write'] } }))
    assert.notEqual(a.fingerprint, b.fingerprint)
  })

  it('planning granularity change → different fingerprint', () => {
    // REVIEW carries no planning granularity overlay → the profile value stays visible
    const a = resolveWith(profileWith({ planning_policy: { granularity: 'COMPACT' } }), 'REVIEW')
    const b = resolveWith(profileWith({ planning_policy: { granularity: 'DETAILED' } }), 'REVIEW')
    assert.notEqual(a.fingerprint, b.fingerprint)
  })

  it('mitigation text change → different fingerprint', () => {
    const a = resolveWith(profileWith({
      known_failure_mitigations: [{ failure_signature: 'x', adjustment: 'do A' }],
    }))
    const b = resolveWith(profileWith({
      known_failure_mitigations: [{ failure_signature: 'x', adjustment: 'do B' }],
    }))
    assert.notEqual(a.fingerprint, b.fingerprint)
  })

  it('different task_role → different fingerprint (same profile)', () => {
    const profile = profileWith({ context_policy: { framing_style: 'STANDARD' } })
    const build = resolveWith(profile, 'BUILD')
    const review = resolveWith(profile, 'REVIEW')
    assert.notEqual(build.fingerprint, review.fingerprint)
  })

  it('generic fallback vs model profile → different fingerprints', () => {
    const fallback = resolveModelHarness({ provider: 'fp', model: 'fp-model' })
    const model = resolveWith(profileWith({}))
    assert.notEqual(fallback.fingerprint, model.fingerprint)
  })
})

describe('fingerprint contains no volatile inputs', () => {
  it('no timestamps / run ids: same-process re-resolution is byte-stable', () => {
    const r1 = resolveModelHarness({ provider: 'opencode', model: 'nemotron-3-ultra-free', allow_candidate: true, task_role: 'PLAN' })
    const r2 = resolveModelHarness({ provider: 'opencode', model: 'nemotron-3-ultra-free', allow_candidate: true, task_role: 'PLAN' })
    assert.equal(r1.fingerprint, r2.fingerprint)
    // The fingerprint input is reconstructable: same effective harness +
    // identity + role must re-hash identically (checked via resolution
    // equality — the fingerprint is derived, never stored state).
    assert.deepEqual(r1, r2)
  })

  it('fingerprint is 64 hex chars (sha256)', () => {
    const r = resolveModelHarness({ provider: 'x', model: 'y' })
    assert.match(r.fingerprint, /^[0-9a-f]{64}$/)
  })
})
