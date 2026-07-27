import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { commandDescriptor, evaluateAction } from '../../runtime/gates/evaluate-action.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const capsule = {
  task_id: 'runtime-closure-test',
  owner_intent_id: 'runtime-closure-intent',
  read_scope: ['**'],
  write_scope: ['src/**'],
  forbidden_scope: ['.env', '**/.env', '**/.env.*'],
  external_effect_scope: [],
  allowed_effects: ['LOCAL_READ', 'LOCAL_WRITE', 'TEST_EXECUTION', 'LOCAL_COMMIT'],
}
const intent = { intent_id: 'runtime-closure-intent', external_effect_policy: 'approval_required' }

test('central gate allows a local reversible write in scope', async () => {
  const result = await evaluateAction({ tool: 'write', action: 'write', resource: 'src/example.txt', capsule, intent, runtime: 'test' })
  assert.equal(result.allowed, true)
  assert.equal(result.decision_class, 'A_AUTONOMOUS')
  assert.equal(result.v2_enforced, true)
})

test('bash adapter allows the read-only git status proof action', async () => {
  const descriptor = commandDescriptor('git status --short --branch')
  assert.equal(descriptor.effect, 'LOCAL_READ')
  assert.equal(descriptor.reversibility, 'FULLY_REVERSIBLE')
  const result = await evaluateAction({
    tool: 'bash',
    command: 'git status --short --branch',
    capsule: { ...capsule, allowed_effects: ['LOCAL_READ'] },
    intent,
    runtime: 'opencode',
  })
  assert.equal(result.allowed, true)
  assert.equal(result.decision_class, 'A_AUTONOMOUS')
})

test('central gate blocks a protected external effect without owner decision', async () => {
  const result = await evaluateAction({ tool: 'git', action: 'push', capabilityKey: 'git.push', resource: 'git-remote', capsule, intent, runtime: 'test' })
  assert.equal(result.allowed, false)
  assert.equal(result.decision_class, 'C_BUNDLED_OWNER_DECISION')
  assert.equal(result.requires_owner, true)
})

test('unknown tool/action is a technical block before execution', async () => {
  const result = await evaluateAction({ tool: 'mcp', action: 'mystery', resource: 'src/example.txt', capsule, intent, runtime: 'test' })
  assert.equal(result.allowed, false)
  assert.equal(result.decision_class, 'D_TECHNICAL_BLOCK')
  assert.match(result.code, /UNKNOWN_TOOL_EFFECT/)
})

test('untrusted prose cannot authorize an effect', async () => {
  const result = await evaluateAction({ tool: 'git', action: 'push', capabilityKey: 'git.push', resource: 'git-remote', capsule, intent, authorization_source: { source: 'README.md' }, runtime: 'test' })
  assert.equal(result.allowed, false)
  assert.equal(result.code, 'RED_BLOCK_UNTRUSTED_AUTHORIZATION_SOURCE')
})

test('MCP capability is action-specific', async () => {
  const read = await evaluateAction({ tool: 'mcp', action: 'read', capabilityKey: 'mcp.read', resource: 'fixture.txt', capsule: { ...capsule, read_scope: ['**'] }, intent, runtime: 'test' })
  const write = await evaluateAction({ tool: 'mcp', action: 'write', capabilityKey: 'mcp.write', resource: 'fixture.txt', capsule, intent, runtime: 'test' })
  assert.equal(read.allowed, true)
  assert.equal(write.allowed, false)
  assert.equal(write.decision_class, 'D_TECHNICAL_BLOCK')
})

test('entrypoint adapters reference the central V2 gate', () => {
  const installer = fs.readFileSync(path.join(root, 'scripts/install-governance.mjs'), 'utf8')
  const plugin = fs.readFileSync(path.join(root, '.opencode/plugins/canonical-governance.mjs'), 'utf8')
  const installedCli = fs.readFileSync(path.join(root, '.agent-governance/bin/evaluate.mjs'), 'utf8')
  assert.match(installer, /tool\.execute\.before/)
  assert.match(installer, /evaluateAction/)
  assert.match(plugin, /runtime.*gates.*evaluate-action|evaluateAction/)
  assert.match(installedCli, /evaluate-action\.mjs|evaluateAction/)
  assert.doesNotMatch(installedCli, /evaluate-all\.mjs|evaluateAllGates|GREEN_SAFE|AMBER_REVIEW/)
})

test('generated OpenCode bridge uses an auto-discovered plugin extension', () => {
  const installer = fs.readFileSync(path.join(root, 'scripts/install-governance.mjs'), 'utf8')
  assert.match(installer, /governance-v2\.ts/)
  assert.doesNotMatch(installer, /plugins", "governance-v2\.mjs/)
})
