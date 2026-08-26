import assert from 'node:assert/strict'
import test from 'node:test'
import { composeWorkerTaskText } from '../../runtime/harness/apply-harness.mjs'
import { resolveModelHarness } from '../../runtime/harness/harness-resolver.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from '../../runtime/harness/model-harness-profiles.mjs'
import { HY3_V2_PROFILE, PHASE_C_V2_PROFILES } from '../../runtime/harness/phase-c-candidate-v2.mjs'

const CASES = [
  ['isolated-bugfix', 'BUILD', 'Fix one isolated defect and report the changed file.'],
  ['multi-file-change', 'PLAN', 'Plan a bounded multi-file change with explicit targets.'],
  ['structured-output-exactness', 'REVIEW', 'Return the requested structured review result exactly.'],
  ['tool-minimal-artifact', 'TOOL_USE', 'Use only granted tools to produce the requested artifact.'],
  ['controlled-retry', 'RESEARCH', 'Research the bounded question and retain observed failures.'],
]

test('HY3 v2 is an evaluation-only candidate with no inactive compression claim', () => {
  assert.equal(HY3_V2_PROFILE.profile_id, 'hy3')
  assert.equal(HY3_V2_PROFILE.version, 2)
  assert.equal(HY3_V2_PROFILE.status, 'candidate')
  assert.deepEqual(HY3_V2_PROFILE.context_policy.compression_hints, [])
  assert.equal(HY3_V2_PROFILE.result_policy.truncation_hint, 'NONE')
  assert.equal(HY3_V2_PROFILE.planning_policy.granularity, 'STANDARD')
  assert.equal(PHASE_C_V2_PROFILES.some((profile) => profile.profile_id === 'generic'), true)
  assert.equal(PHASE_C_V2_PROFILES.includes(HY3_V2_PROFILE), true)
})

test('HY3 v2 static context is lower than generic across the diagnostic role corpus', () => {
  for (const [_caseId, taskRole, taskText] of CASES) {
    const generic = resolveModelHarness({
      provider: 'opencode',
      model: 'hy3-free',
      task_role: taskRole,
      profiles: DEFAULT_MODEL_HARNESS_PROFILES,
      allow_candidate: false,
    })
    const candidate = resolveModelHarness({
      provider: 'opencode',
      model: 'hy3-free',
      task_role: taskRole,
      profiles: PHASE_C_V2_PROFILES,
      allow_candidate: true,
    })
    const genericText = composeWorkerTaskText({ taskText, effectiveHarness: generic.effective_harness })
    const candidateText = composeWorkerTaskText({ taskText, effectiveHarness: candidate.effective_harness })
    assert.equal(candidate.profile_full_id, 'hy3.v2')
    assert.ok(candidateText.length < genericText.length, `${taskRole}: v2 must be shorter than generic`)
    assert.doesNotMatch(candidateText, /Summarize verbose tool output/)
  }
})
