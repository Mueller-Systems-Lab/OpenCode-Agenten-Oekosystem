// SPDX-License-Identifier: MIT
/**
 * Generic harness fallback tests: unknown models always get a safe harness
 * and the task can always run (zero model calls).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveModelHarness,
  composeWorkerTaskText,
  applyToolExposure,
  harnessEvidenceFields,
} from '../../runtime/harness/index.mjs'

describe('generic fallback for unknown models', () => {
  it('opencode/new-free-model resolves to the safe generic harness', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'new-free-model' })
    assert.equal(r.ok, true)
    assert.equal(r.resolution, 'GENERIC_FALLBACK')
    assert.equal(r.profile_full_id, 'generic.v1')
    assert.equal(r.effective_harness.tool_policy.tool_exposure, 'FULL_TOOLSET')
    assert.equal(r.effective_harness.core_authority_unchanged, true)
  })

  it('the task can run: composeWorkerTaskText works with the fallback harness', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'new-free-model', task_role: 'BUILD' })
    const text = composeWorkerTaskText({ taskText: 'Write proof.json with {"value":42}', effectiveHarness: r.effective_harness })
    assert.equal(typeof text, 'string')
    assert.ok(text.includes('Write proof.json with {"value":42}'))
    assert.ok(text.includes('Task'))
    assert.ok(text.includes('Output format'))
  })

  it('tool exposure under the fallback is the full grant', () => {
    const r = resolveModelHarness({ provider: 'unknown-provider', model: 'whatever' })
    const { exposed_tools: exposed } = applyToolExposure({
      grantedTools: ['read', 'write'],
      toolPolicy: r.effective_harness.tool_policy,
    })
    assert.deepEqual(exposed, ['read', 'write'])
  })

  it('evidence fields are present and flat', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'new-free-model', task_role: 'RESEARCH' })
    const fields = harnessEvidenceFields(r)
    assert.deepEqual(Object.keys(fields).sort(), [
      'effective_harness_fingerprint', 'harness_resolution', 'model_profile', 'profile_version', 'task_role',
    ])
    assert.equal(fields.model_profile, 'generic')
    assert.equal(fields.harness_resolution, 'GENERIC_FALLBACK')
    assert.equal(fields.effective_harness_fingerprint, r.fingerprint)
    assert.equal(fields.task_role, 'RESEARCH')
  })

  it('fallback works for every task role', () => {
    for (const task_role of ['PLAN', 'BUILD', 'REVIEW', 'RESEARCH', 'TOOL_USE']) {
      const r = resolveModelHarness({ provider: 'opencode', model: 'brand-new', task_role })
      assert.equal(r.resolution, 'GENERIC_FALLBACK', task_role)
      assert.doesNotThrow(() => composeWorkerTaskText({ taskText: 'do the work', effectiveHarness: r.effective_harness }))
    }
  })
})
