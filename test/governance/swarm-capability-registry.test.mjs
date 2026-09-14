/**
 * Governance ↔ swarm tool capability drift test.
 *
 * The governance plugin fails closed (RED_BLOCK_UNKNOWN_TOOL_EFFECT) on any
 * tool/action pair missing from the generated capability registry. Every
 * action exposed by the native swarm adapter must therefore have an explicit
 * coordination-plane capability entry — no more, no less.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers.mjs'

test('every swarm tool action is registered in the governance capability registry', () => {
  const adapter = fs.readFileSync(
    path.join(repoRoot, '.agents/skills/coordinate-blackboard-swarm/adapters/opencode/swarm.ts'),
    'utf8',
  )
  const enumBlock = /action: tool\.schema\.enum\(\[([\s\S]*?)\]\)/.exec(adapter)
  assert.ok(enumBlock, 'swarm.ts action enum not found')
  const actions = [...enumBlock[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1])
  assert.ok(actions.length >= 29, `unexpectedly small swarm action surface: ${actions.length}`)

  const registry = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'governance/generated/capability-registry.json'), 'utf8'),
  )
  const registered = Object.keys(registry.tools).filter((key) => key.startsWith('swarm.'))
  const expected = actions.map((action) => `swarm.${action}`).sort()

  assert.deepEqual(registered.sort(), expected, 'capability registry must cover exactly the swarm tool surface')
  for (const key of registered) {
    const capability = registry.tools[key]
    assert.equal(capability.approval_class, 'A_AUTONOMOUS', `${key}: coordination plane must never require or grant authority`)
    assert.equal(capability.effect_class.startsWith('LOCAL_'), true, `${key}: swarm effects are project-local`)
  }
})
