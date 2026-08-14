import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateAction, normalizeRequest } from '../../runtime/gates/evaluate-action.mjs'
import { EFFECTS, REVERSIBILITY } from '../../runtime/approval/approval-engine.mjs'

const capsule = {
  task_id: 'todo-compat-test',
  read_scope: ['**'],
  write_scope: ['src/**'],
  forbidden_scope: ['.env', '**/.env', '**/.env.*'],
  allowed_effects: [EFFECTS.LOCAL_WRITE],
}

for (const tool of ['todo', 'todowrite', 'todoread']) {
  test(`OpenCode ${tool} maps to the internal todo capability`, () => {
    const request = normalizeRequest({ tool, args: { todos: [{ content: 'track progress' }] } })
    assert.equal(request.tool, 'opencode')
    assert.equal(request.action, 'todo')
    assert.equal(request.effect, EFFECTS.LOCAL_STATE)
    assert.equal(request.reversibility, REVERSIBILITY.FULLY_REVERSIBLE)
    assert.equal(request.resource, 'opencode://todo')
    assert.equal(request.source_tool, tool)
  })
}

test('OpenCode todo state is allowed without a task capsule', async () => {
  const result = await evaluateAction({ tool: 'todowrite', args: { todos: [] }, runtime: 'opencode' })
  assert.equal(result.allowed, true)
  assert.equal(result.decision_class, 'A_AUTONOMOUS')
  assert.equal(result.capability_key, 'opencode.todo')
  assert.equal(result.effect, undefined)
  assert.equal(result.tool, 'opencode')
  assert.equal(result.action, 'todo')
})

test('OpenCode todo state does not expand a project write capsule', async () => {
  const result = await evaluateAction({ tool: 'todoread', args: {}, runtime: 'opencode', capsule })
  assert.equal(result.allowed, true)
  assert.equal(result.capability_key, 'opencode.todo')
  assert.equal(result.resource, 'opencode://todo')
})

test('unknown tools remain fail-closed', async () => {
  const result = await evaluateAction({ tool: 'unknown-tool', action: 'update', runtime: 'opencode', capsule })
  assert.equal(result.allowed, false)
  assert.equal(result.code, 'RED_BLOCK_UNKNOWN_TOOL_EFFECT')
})
