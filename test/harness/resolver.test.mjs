// SPDX-License-Identifier: MIT
/**
 * Deterministic harness resolver tests (zero model calls).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveModelHarness as resolveProductModelHarness,
  normalizeModelIdentity,
  getProfile,
} from '../../runtime/harness/index.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from '../../runtime/harness/model-harness-profiles.mjs'

const resolveModelHarness = (input = {}) => typeof input === 'string'
  ? resolveProductModelHarness(input)
  : resolveProductModelHarness({
    ...input,
    ...(input.allow_candidate === true && !input.profiles ? { profiles: DEFAULT_MODEL_HARNESS_PROFILES } : {}),
  })

describe('harness resolver: determinism', () => {
  it('same inputs → deep-equal result incl. fingerprint (5 repeats)', () => {
    const first = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true, task_role: 'BUILD' })
    for (let i = 0; i < 5; i += 1) {
      const repeat = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true, task_role: 'BUILD' })
      assert.deepEqual(repeat, first)
    }
    assert.match(first.fingerprint, /^[0-9a-f]{64}$/)
  })

  it('generic fallback resolution is deterministic too', () => {
    const a = resolveModelHarness({ provider: 'openai', model: 'gpt-5.4' })
    const b = resolveModelHarness({ provider: 'openai', model: 'gpt-5.4' })
    assert.deepEqual(a, b)
  })
})

describe('harness resolver: fallback and candidate gating', () => {
  it('unknown model → GENERIC_FALLBACK with generic.v1', () => {
    const r = resolveModelHarness({ provider: 'deepseek', model: 'deepseek-chat' })
    assert.equal(r.resolution, 'GENERIC_FALLBACK')
    assert.equal(r.profile_id, 'generic')
    assert.equal(r.profile_full_id, 'generic.v1')
  })

  it('known model + allow_candidate=false + candidate status → generic fallback (candidates never auto-applied)', () => {
    for (const model of ['hy3-free', 'muse-spark-1.2-contributor-free', 'nemotron-3-ultra-free']) {
      const r = resolveModelHarness({ provider: 'opencode', model })
      assert.equal(r.resolution, 'GENERIC_FALLBACK', model)
      assert.equal(r.profile_id, 'generic', model)
    }
  })

  it('allow_candidate=true → model profile applies', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    assert.equal(r.resolution, 'MODEL_PROFILE')
    assert.equal(r.profile_id, 'hy3')
    assert.equal(r.profile_full_id, 'hy3.v1')
  })
})

describe('harness resolver: exact model→profile mapping', () => {
  it('hy3-free → hy3.v1', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    assert.equal(r.profile_id, 'hy3')
    assert.equal(r.effective_harness.context_policy.framing_style, 'CONCISE')
  })

  it('muse-spark-1.2-contributor-free → muse.v1', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'muse-spark-1.2-contributor-free', allow_candidate: true })
    assert.equal(r.profile_id, 'muse')
    assert.equal(r.effective_harness.tool_policy.action_boundaries, 'EXPLICIT')
  })

  it('nemotron-3-ultra-free → nemotron.v1', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'nemotron-3-ultra-free', allow_candidate: true })
    assert.equal(r.profile_id, 'nemotron')
    assert.equal(r.effective_harness.result_policy.structured_output_anchoring, 'STRICT')
  })

  it('every registry profile except generic is a candidate (never auto-applied)', () => {
    for (const profile of DEFAULT_MODEL_HARNESS_PROFILES) {
      if (profile.profile_id === 'generic') continue
      assert.equal(profile.status, 'candidate')
    }
    assert.equal(getProfile(DEFAULT_MODEL_HARNESS_PROFILES, 'generic').status, 'active')
  })
})

describe('normalizeModelIdentity', () => {
  it('accepts provider/model string form', () => {
    assert.deepEqual(normalizeModelIdentity('opencode/hy3-free'), { provider: 'opencode', model: 'hy3-free' })
  })

  it('accepts object form', () => {
    assert.deepEqual(normalizeModelIdentity({ provider: 'opencode', model: 'hy3-free' }), { provider: 'opencode', model: 'hy3-free' })
  })

  it('normalizes case and whitespace once (catalog ids are lowercase)', () => {
    assert.deepEqual(normalizeModelIdentity({ provider: ' OpenCode ', model: 'HY3-FREE' }), { provider: 'opencode', model: 'hy3-free' })
  })

  it('rejects malformed identity (CONTRACT_INVALID)', () => {
    assert.throws(() => normalizeModelIdentity('hy3-free'), /CONTRACT_INVALID/)
    assert.throws(() => normalizeModelIdentity('a/b/c'), /CONTRACT_INVALID/)
    assert.throws(() => normalizeModelIdentity({ provider: '', model: 'x' }), /CONTRACT_INVALID/)
    assert.throws(() => normalizeModelIdentity(null), /CONTRACT_INVALID/)
  })

  it('resolver accepts the identity string/object form directly', () => {
    const r = resolveModelHarness('opencode/hy3-free')
    assert.equal(r.resolution, 'GENERIC_FALLBACK')
    const r2 = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    assert.equal(r2.profile_id, 'hy3')
  })
})

describe('harness resolver: task role contract', () => {
  it('unknown task role → CONTRACT_INVALID', () => {
    assert.throws(() => resolveModelHarness({ provider: 'opencode', model: 'hy3-free', task_role: 'HACK' }), /CONTRACT_INVALID:task-role/)
  })

  it('default task role is BUILD', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free' })
    assert.equal(r.task_role, 'BUILD')
  })
})
