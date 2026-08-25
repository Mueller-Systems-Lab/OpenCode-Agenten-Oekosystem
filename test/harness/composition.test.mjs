// SPDX-License-Identifier: MIT
/**
 * L0/L1/L2 composition semantics tests (zero model calls).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveModelHarness as resolveProductModelHarness,
  createModelHarnessProfile,
  FORBIDDEN_PROFILE_KEYS,
  getProfile,
} from '../../runtime/harness/index.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from '../../runtime/harness/model-harness-profiles.mjs'

const resolveModelHarness = (input = {}) => resolveProductModelHarness({
  ...input,
  ...(input.allow_candidate === true && !input.profiles ? { profiles: DEFAULT_MODEL_HARNESS_PROFILES } : {}),
})

function forbiddenKeyHits(value, prefix = '') {
  const hits = []
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((item) => walk(item, path)); return }
    if (!node || typeof node !== 'object') return
    for (const key of Object.keys(node)) {
      const keyPath = path ? `${path}.${key}` : key
      if (FORBIDDEN_PROFILE_KEYS.includes(key)) hits.push(keyPath)
      walk(node[key], keyPath)
    }
  }
  walk(value, prefix)
  return hits
}

const customProfile = createModelHarnessProfile({
  profile_id: 'custom-test',
  version: 1,
  status: 'candidate',
  model_match: { provider: 'test', model: 'custom-model' },
  context_policy: { scaffolding_verbosity: 'SHORT' },
  planning_policy: { granularity: 'COMPACT' },
  task_role_overrides: {
    BUILD: { planning_policy: { granularity: 'DETAILED' } },
  },
})

const customProfiles = [...DEFAULT_MODEL_HARNESS_PROFILES, customProfile]

describe('L0/L1/L2 merge semantics', () => {
  it('model profile overrides the generic baseline per key (role without that key)', () => {
    // RESEARCH overlay carries no scaffolding_verbosity → the model profile
    // value survives (BUILD would win per key by design).
    const generic = resolveModelHarness({ provider: 'x', model: 'unknown', task_role: 'RESEARCH' })
    const model = resolveModelHarness({ provider: 'test', model: 'custom-model', allow_candidate: true, profiles: customProfiles, task_role: 'RESEARCH' })
    assert.equal(generic.effective_harness.context_policy.scaffolding_verbosity, 'STANDARD')
    assert.equal(model.effective_harness.context_policy.scaffolding_verbosity, 'SHORT')
    // untouched generic keys survive the merge
    assert.equal(model.effective_harness.context_policy.framing_style, generic.effective_harness.context_policy.framing_style)
  })

  it('role overlay overrides the model profile per key', () => {
    const build = resolveModelHarness({ provider: 'test', model: 'custom-model', allow_candidate: true, profiles: customProfiles, task_role: 'BUILD' })
    // BUILD overlay sets granularity STANDARD; the model profile says COMPACT
    assert.equal(build.effective_harness.planning_policy.granularity, 'STANDARD')
  })

  it('task_role_overrides from the model profile apply ONLY for the matching role (before the role overlay)', () => {
    // BUILD: model profile override says DETAILED, but the BUILD role overlay
    // wins per key (STANDARD) — model refinement applies before the overlay.
    const build = resolveModelHarness({ provider: 'test', model: 'custom-model', allow_candidate: true, profiles: customProfiles, task_role: 'BUILD' })
    assert.equal(build.effective_harness.planning_policy.granularity, 'STANDARD')
    // A role the profile has no override for keeps the profile's COMPACT.
    const research = resolveModelHarness({ provider: 'test', model: 'custom-model', allow_candidate: true, profiles: customProfiles, task_role: 'RESEARCH' })
    assert.equal(research.effective_harness.planning_policy.granularity, 'COMPACT', 'RESEARCH overlay granularity applies (also COMPACT) — use TOOL_USE to discriminate')
    const toolUse = resolveModelHarness({ provider: 'test', model: 'custom-model', allow_candidate: true, profiles: customProfiles, task_role: 'TOOL_USE' })
    assert.equal(toolUse.effective_harness.planning_policy.granularity, 'COMPACT', 'no task_role_override for TOOL_USE → model profile value stays')
    // Direct evidence for the matching-role override: a profile whose BUILD
    // override differs from every role-overlay value.
    const discriminating = createModelHarnessProfile({
      profile_id: 'discriminating',
      version: 1,
      status: 'candidate',
      model_match: { provider: 'test', model: 'discriminating-model' },
      planning_policy: { granularity: 'COMPACT' },
      task_role_overrides: { PLAN: { planning_policy: { granularity: 'STEPWISE' } } },
    })
    const withPlan = resolveModelHarness({
      provider: 'test', model: 'discriminating-model', allow_candidate: true,
      profiles: [...DEFAULT_MODEL_HARNESS_PROFILES, discriminating], task_role: 'PLAN',
    })
    // PLAN role overlay would say DETAILED — but the model-profile override
    // for PLAN (STEPWISE) is applied BEFORE the overlay, so the overlay wins.
    assert.equal(withPlan.effective_harness.planning_policy.granularity, 'DETAILED')
    // Discriminate the override application itself via a role overlay that
    // does NOT set planning granularity: REVIEW.
    const withReview = resolveModelHarness({
      provider: 'test', model: 'discriminating-model', allow_candidate: true,
      profiles: [...DEFAULT_MODEL_HARNESS_PROFILES, discriminating], task_role: 'REVIEW',
    })
    assert.equal(withReview.effective_harness.planning_policy.granularity, 'COMPACT', 'non-matching role must NOT receive the PLAN override')
  })

  it('compression hints are additive across layers', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true, task_role: 'RESEARCH' })
    const hints = r.effective_harness.context_policy.compression_hints
    assert.ok(hints.includes('Do not restate the task in your answer'), 'model profile hint survives')
    assert.ok(hints.includes('cite concrete file paths'), 'RESEARCH overlay hint added')
  })

  it('known_failure_mitigations flow from the model profile into the effective harness', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'muse-spark-1.2-contributor-free', allow_candidate: true })
    assert.equal(r.effective_harness.known_failure_mitigations.length, 1)
    assert.equal(r.effective_harness.known_failure_mitigations[0].failure_signature, 'fabricated_tool_result')
  })
})

describe('composed harness invariants', () => {
  it('composed harness never contains forbidden keys', () => {
    const cases = [
      resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true }),
      resolveModelHarness({ provider: 'opencode', model: 'muse-spark-1.2-contributor-free', allow_candidate: true, task_role: 'TOOL_USE' }),
      resolveModelHarness({ provider: 'opencode', model: 'nemotron-3-ultra-free', allow_candidate: true, task_role: 'REVIEW' }),
      resolveModelHarness({ provider: 'x', model: 'unknown', task_role: 'PLAN' }),
    ]
    for (const r of cases) {
      assert.deepEqual(forbiddenKeyHits(r.effective_harness), [], `${r.profile_id}/${r.task_role}`)
    }
  })

  it('core_authority_unchanged marker present on every effective harness', () => {
    for (const task_role of ['PLAN', 'BUILD', 'REVIEW', 'RESEARCH', 'TOOL_USE']) {
      const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true, task_role })
      assert.equal(r.effective_harness.core_authority_unchanged, true)
    }
  })

  it('generic fallback compose carries the safe generic baseline', () => {
    const fallback = resolveModelHarness({ provider: 'x', model: 'unknown' })
    const genericProfile = getProfile(DEFAULT_MODEL_HARNESS_PROFILES, 'generic')
    assert.equal(fallback.effective_harness.tool_policy.tool_exposure, genericProfile.tool_policy.tool_exposure)
    assert.equal(fallback.effective_harness.result_policy.truncation_hint, genericProfile.result_policy.truncation_hint)
  })

  it('resolution results are frozen', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    assert.ok(Object.isFrozen(r))
    assert.ok(Object.isFrozen(r.effective_harness))
  })
})
