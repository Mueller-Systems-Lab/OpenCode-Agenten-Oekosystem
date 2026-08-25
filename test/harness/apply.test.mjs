// SPDX-License-Identifier: MIT
/**
 * Harness apply-layer tests: deterministic composition, instruction order,
 * anchoring, action boundaries, tool exposure (zero model calls).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveModelHarness as resolveProductModelHarness,
  composeWorkerTaskText,
  applyToolExposure,
} from '../../runtime/harness/index.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from '../../runtime/harness/model-harness-profiles.mjs'

const resolveModelHarness = (input = {}) => resolveProductModelHarness({
  ...input,
  ...(input.allow_candidate === true && !input.profiles ? { profiles: DEFAULT_MODEL_HARNESS_PROFILES } : {}),
})

const TASK = 'Create proof.json with exactly {"value":42}'

describe('composeWorkerTaskText determinism', () => {
  it('same input → byte-identical string', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    const a = composeWorkerTaskText({ taskText: TASK, effectiveHarness: r.effective_harness })
    const b = composeWorkerTaskText({ taskText: TASK, effectiveHarness: r.effective_harness })
    assert.equal(a, b)
  })

  it('different harness → different composed text', () => {
    const hy3 = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    const generic = resolveModelHarness({ provider: 'x', model: 'y' })
    const a = composeWorkerTaskText({ taskText: TASK, effectiveHarness: hy3.effective_harness })
    const b = composeWorkerTaskText({ taskText: TASK, effectiveHarness: generic.effective_harness })
    assert.notEqual(a, b)
  })

  it('malformed input → CONTRACT_INVALID', () => {
    const r = resolveModelHarness({ provider: 'x', model: 'y' })
    assert.throws(() => composeWorkerTaskText({ taskText: 42, effectiveHarness: r.effective_harness }), /CONTRACT_INVALID/)
    assert.throws(() => composeWorkerTaskText({ taskText: TASK, effectiveHarness: null }), /CONTRACT_INVALID/)
  })
})

describe('instruction_order is honored', () => {
  it('hy3 order: task before output_format before constraints', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    const text = composeWorkerTaskText({ taskText: TASK, effectiveHarness: r.effective_harness })
    const iTask = text.indexOf(TASK)
    const iFormat = text.indexOf('Output format')
    const iConstraints = text.indexOf('Constraints')
    assert.ok(iTask !== -1 && iFormat !== -1 && iConstraints !== -1)
    assert.ok(iTask < iFormat, 'task before output_format')
    assert.ok(iFormat < iConstraints, 'output_format before constraints')
  })

  it('muse order: action_boundary before output_format before constraints', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'muse-spark-1.2-contributor-free', allow_candidate: true })
    const text = composeWorkerTaskText({ taskText: TASK, effectiveHarness: r.effective_harness })
    const iAction = text.indexOf('Action boundary')
    const iFormat = text.indexOf('Output format')
    const iConstraints = text.indexOf('Constraints')
    assert.ok(iAction !== -1 && iFormat !== -1 && iConstraints !== -1)
    assert.ok(iAction < iFormat && iFormat < iConstraints)
  })

  it('nemotron order: steps section appears between task and output_format', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'nemotron-3-ultra-free', allow_candidate: true })
    const text = composeWorkerTaskText({ taskText: TASK, effectiveHarness: r.effective_harness })
    const iTask = text.indexOf(TASK)
    const iSteps = text.indexOf('Steps')
    const iFormat = text.indexOf('Output format')
    assert.ok(iTask !== -1 && iSteps !== -1 && iFormat !== -1)
    assert.ok(iTask < iSteps && iSteps < iFormat)
  })

  it('SHORT verbosity renders minimal one-line headers', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    const text = composeWorkerTaskText({ taskText: TASK, effectiveHarness: r.effective_harness })
    assert.ok(text.includes('Task:'), 'minimal one-line task header')
    assert.ok(!text.includes('## Task'), 'no full scaffolding header under SHORT')
  })
})

describe('anchoring and boundaries', () => {
  it('STRICT anchoring restates the exact output format at the end', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'nemotron-3-ultra-free', allow_candidate: true })
    const text = composeWorkerTaskText({ taskText: TASK, effectiveHarness: r.effective_harness })
    const restatement = 'Final check: produce exactly the required output format'
    const iRestatement = text.indexOf(restatement)
    assert.ok(iRestatement !== -1, 'STRICT restatement present')
    assert.ok(iRestatement > text.indexOf('Output format'), 'restatement comes after the output format section')
    assert.ok(text.endsWith('End with the final artifact content only.'), 'final_answer_anchoring closes the text')
  })

  it('EXPLICIT action boundaries present for muse', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'muse-spark-1.2-contributor-free', allow_candidate: true })
    const text = composeWorkerTaskText({ taskText: TASK, effectiveHarness: r.effective_harness })
    assert.ok(text.includes('never invent file contents or tool results'))
    assert.ok(text.includes('Invoke each tool exactly as documented'), 'explicit tool contracts')
  })

  it('known-failure mitigations render as constraint lines', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'muse-spark-1.2-contributor-free', allow_candidate: true })
    const text = composeWorkerTaskText({ taskText: TASK, effectiveHarness: r.effective_harness })
    assert.ok(text.includes('Known failure fabricated_tool_result'))
  })

  it('compression hints render as a compact Efficiency block', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    const text = composeWorkerTaskText({ taskText: TASK, effectiveHarness: r.effective_harness })
    assert.ok(text.includes('Efficiency:'))
    assert.ok(text.includes('- Do not restate the task in your answer'))
  })

  it('planning directives render per granularity', () => {
    const hy3 = resolveModelHarness({ provider: 'opencode', model: 'hy3-free', allow_candidate: true })
    const text = composeWorkerTaskText({ taskText: TASK, effectiveHarness: hy3.effective_harness })
    assert.ok(text.includes('Planning: keep the plan compact'), 'COMPACT directive')
    const generic = resolveModelHarness({ provider: 'x', model: 'y' })
    const genericText = composeWorkerTaskText({ taskText: TASK, effectiveHarness: generic.effective_harness })
    assert.ok(!genericText.includes('Planning:'), 'STANDARD granularity emits no directive')
  })
})

describe('applyToolExposure', () => {
  const granted = ['read', 'write', 'edit', 'bash', 'grep', 'glob', 'list']

  it('FULL_TOOLSET (generic fallback) exposes the whole grant', () => {
    const r = resolveModelHarness({ provider: 'x', model: 'y' })
    const { exposed_tools: exposed, hidden_tools: hidden } = applyToolExposure({ grantedTools: granted, toolPolicy: r.effective_harness.tool_policy })
    assert.deepEqual(exposed, granted)
    assert.deepEqual(hidden, [])
  })

  it('TASK_MINIMAL_TOOLSET (muse) filters to task-relevant file-artifact tools', () => {
    const r = resolveModelHarness({ provider: 'opencode', model: 'muse-spark-1.2-contributor-free', allow_candidate: true })
    const { exposed_tools: exposed, hidden_tools: hidden } = applyToolExposure({ grantedTools: granted, toolPolicy: r.effective_harness.tool_policy })
    assert.deepEqual(exposed, ['read', 'write', 'edit', 'glob', 'list'])
    assert.deepEqual(hidden, ['bash', 'grep'])
  })
})
