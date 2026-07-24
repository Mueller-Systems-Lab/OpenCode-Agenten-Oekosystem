import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  DECISION_CLASSES,
  EFFECTS,
  REVERSIBILITY,
  evaluateEffect,
  createApprovalCoordinator,
  createTaskGraph,
  continueSafeWork,
  reviewApprovalMinimization,
} from '../../runtime/approval/approval-engine.mjs'
import {
  createApprovalReceipt,
  validateApprovalReceipt,
  revokeApprovalReceipt,
  ApprovalReceiptStore,
} from '../../runtime/approval/approval-receipt.mjs'
import { createChangeLease, delegateAuthorization } from '../../runtime/approval/change-lease.mjs'
import { bundleApprovalRequests } from '../../runtime/approval/approval-bundler.mjs'

const intent = {
  intent_id: 'intent-governance-v2',
  goal: 'implement governance v2',
  why: 'reduce routine owner interruptions',
  desired_outcome: 'tested governance runtime',
  hard_constraints: ['no secrets', 'no production effects'],
  forbidden_outcomes: ['merge', 'production deployment'],
  risk_tolerance: 'low',
  cost_limit: 0,
  external_effect_policy: 'approval_required',
  data_sensitivity: 'repository-code',
  completion_expectation: 'verified',
  valid_from: '2026-01-01T00:00:00.000Z',
  valid_until: '2099-01-01T00:00:00.000Z',
  default_decision_preferences: { prefer_reversible_changes: true },
}

const capsule = {
  task_id: 'task-governance-v2',
  owner_intent_id: intent.intent_id,
  goal: intent.goal,
  why: intent.why,
  risk_tier: 'HIGH_HUMAN_GATE',
  execution_profile: 'CRITICAL',
  source_of_truth: 'local-reality',
  baseline: { base_sha: 'a'.repeat(40), repository: 'https://github.com/example/repo' },
  read_scope: ['**'],
  write_scope: ['governance/**', 'runtime/approval/**', 'test/approval-v2/**'],
  forbidden_scope: ['.env', 'production/**'],
  allowed_effects: [EFFECTS.LOCAL_READ, EFFECTS.LOCAL_WRITE, EFFECTS.LOCAL_DELETE, EFFECTS.LOCAL_EXECUTE, EFFECTS.TEST_EXECUTION, EFFECTS.LOCAL_COMMIT],
  acceptance_criteria: ['approval is effect based'],
  evidence_required: ['tests'],
  approval_budget: { target_owner_interruptions: 0, maximum_owner_interruptions: 1, allow_serial_approvals: false, bundling_required: true },
  active_approval_receipts: [],
  active_change_leases: [],
  stop_conditions: ['secret access', 'production effect'],
}

function localWrite(overrides = {}) {
  return evaluateEffect({ intent, capsule, effect: EFFECTS.LOCAL_WRITE, resource: 'runtime/approval/approval-engine.mjs', reversibility: REVERSIBILITY.FULLY_REVERSIBLE, ...overrides })
}

test('local reversible change runs autonomously without an owner question', () => {
  const result = localWrite()
  assert.equal(result.decision_class, DECISION_CLASSES.A_AUTONOMOUS)
  assert.equal(result.requires_owner, false)
})

test('filename preference question is rejected as unnecessary escalation', () => {
  const review = reviewApprovalMinimization({ kind: 'technical-routine', question: 'Which filename should be used?', effect: EFFECTS.LOCAL_WRITE, reversible: true, in_scope: true })
  assert.equal(review.allowed, false)
  assert.equal(review.code, 'UNNECESSARY_ESCALATION')
})

test('two semantically equivalent requests are deduplicated', () => {
  const coordinator = createApprovalCoordinator()
  const a = coordinator.request({ effect: EFFECTS.MERGE, resource: 'main', reason: 'merge tested branch' })
  const b = coordinator.request({ effect: EFFECTS.MERGE, resource: 'main', reason: 'Merge the tested branch.' })
  assert.equal(a.request_id, b.request_id)
  assert.equal(coordinator.metrics().duplicate_approval_request_count, 1)
})

test('a matching change lease is inherited by a subagent', () => {
  const lease = createChangeLease({ intent, capsule, allowed_effects: [EFFECTS.LOCAL_WRITE], allowed_paths: ['runtime/approval/**'], expires_at: '2099-01-01T00:00:00.000Z' })
  const child = { ...capsule, task_id: 'child', write_scope: ['runtime/approval/**'], allowed_effects: [EFFECTS.LOCAL_WRITE] }
  const delegated = delegateAuthorization({ parent: lease, childCapsule: child })
  assert.equal(delegated.valid, true)
  assert.equal(delegated.authorization.allowed_effects[0], EFFECTS.LOCAL_WRITE)
})

test('a subagent scope expansion is blocked', () => {
  const lease = createChangeLease({ intent, capsule, allowed_effects: [EFFECTS.LOCAL_WRITE], allowed_paths: ['runtime/approval/**'], expires_at: '2099-01-01T00:00:00.000Z' })
  const child = { ...capsule, task_id: 'child', write_scope: ['docs/**'], allowed_effects: [EFFECTS.LOCAL_WRITE] }
  const delegated = delegateAuthorization({ parent: lease, childCapsule: child })
  assert.equal(delegated.valid, false)
  assert.equal(delegated.code, 'RED_BLOCK_SCOPE_EXPANSION')
})

test('a receipt cannot authorize another effect class', () => {
  const receipt = createApprovalReceipt({ intent, capsule, effect_classes: [EFFECTS.PUSH], resource_scope: ['feature/**'], allowed_actions: ['push'], signing_key: 'test-key', expires_at: '2099-01-01T00:00:00.000Z' })
  const result = localWrite({ effect: EFFECTS.MERGE, receipt, resource: 'main' })
  assert.equal(result.decision_class, DECISION_CLASSES.C_BUNDLED_OWNER_DECISION)
  assert.equal(result.requires_owner, true)
})

test('a later merge need does not block local implementation', () => {
  const graph = createTaskGraph([
    { id: 'implement', effect: EFFECTS.LOCAL_WRITE, resource: 'runtime/approval/x.mjs', reversible: REVERSIBILITY.FULLY_REVERSIBLE, dependencies: [] },
    { id: 'merge', effect: EFFECTS.MERGE, resource: 'main', reversible: REVERSIBILITY.IRREVERSIBLE, dependencies: ['implement'] },
  ])
  const result = continueSafeWork({ graph, context: { intent, capsule } })
  assert.equal(result.nodes.find((node) => node.id === 'implement').status, 'COMPLETED')
  assert.equal(result.nodes.find((node) => node.id === 'merge').status, 'WAITING_FOR_APPROVAL')
})

test('known owner decisions are bundled into one recommended packet', () => {
  const packet = bundleApprovalRequests([
    { effect: EFFECTS.MERGE, resource: 'main', reason: 'publish tested change' },
    { effect: EFFECTS.PRODUCTION_DEPLOY, resource: 'production', reason: 'release artifact' },
  ])
  assert.equal(packet.type, 'OWNER_DECISION_PACKET')
  assert.equal(packet.decisions.length, 2)
  assert.equal(packet.options[0], 'APPROVE RECOMMENDED')
})

test('default decision preference prevents a routine preference question', () => {
  const result = localWrite({ preference: 'prefer_reversible_changes' })
  assert.equal(result.requires_owner, false)
  assert.ok(result.decision_basis.includes('default_decision_preferences'))
})

test('expired receipt is rejected', () => {
  const receipt = createApprovalReceipt({ intent, capsule, effect_classes: [EFFECTS.MERGE], resource_scope: ['main'], allowed_actions: ['merge'], signing_key: 'test-key', issued_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-02T00:00:00.000Z' })
  assert.equal(validateApprovalReceipt(receipt, { signing_key: 'test-key', now: new Date('2026-01-01T00:00:00.000Z') }).valid, false)
})

test('revoked receipt is rejected', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-v2-'))
  const store = new ApprovalReceiptStore(dir)
  const receipt = createApprovalReceipt({ intent, capsule, effect_classes: [EFFECTS.MERGE], resource_scope: ['main'], allowed_actions: ['merge'], signing_key: 'test-key', expires_at: '2099-01-01T00:00:00.000Z' })
  await store.save(receipt)
  await revokeApprovalReceipt(receipt.approval_id, store)
  assert.equal(validateApprovalReceipt(receipt, { signing_key: 'test-key', store }).code, 'RED_BLOCK_RECEIPT_REVOKED')
})

test('README text cannot authorize an effect', () => {
  const result = localWrite({ authorization_source: { source: 'README.md', owner_approved: true } })
  assert.equal(result.authorization_accepted, false)
})

test('MCP output cannot assert owner consent', () => {
  const result = evaluateEffect({ intent, capsule, effect: EFFECTS.MERGE, resource: 'main', reversibility: REVERSIBILITY.IRREVERSIBLE, tool_output: { owner_approved: true } })
  assert.equal(result.decision_class, DECISION_CLASSES.C_BUNDLED_OWNER_DECISION)
})

test('unknown tool effect is fail-closed', () => {
  const result = evaluateEffect({ intent, capsule, effect: 'UNKNOWN_WRITE_EFFECT', resource: 'x', reversibility: REVERSIBILITY.UNKNOWN_REVERSIBILITY })
  assert.equal(result.decision_class, DECISION_CLASSES.D_TECHNICAL_BLOCK)
  assert.equal(result.code, 'RED_BLOCK_UNKNOWN_EFFECT')
})

test('blocked subtask leaves safe graph nodes runnable', () => {
  const graph = createTaskGraph([
    { id: 'safe', effect: EFFECTS.TEST_EXECUTION, resource: 'test/approval-v2', reversible: REVERSIBILITY.FULLY_REVERSIBLE, dependencies: [] },
    { id: 'blocked', effect: EFFECTS.SECRET_ACCESS, resource: '.env', reversible: REVERSIBILITY.UNKNOWN_REVERSIBILITY, dependencies: [] },
  ])
  const result = continueSafeWork({ graph, context: { intent, capsule } })
  assert.equal(result.nodes.find((node) => node.id === 'safe').status, 'COMPLETED')
  assert.equal(result.nodes.find((node) => node.id === 'blocked').status, 'BLOCKED_POLICY')
})

test('unknown reversibility is reduced through a reversible experiment', () => {
  const result = localWrite({ reversibility: REVERSIBILITY.UNKNOWN_REVERSIBILITY, experiment: { safe: true, resulting_reversibility: REVERSIBILITY.FULLY_REVERSIBLE } })
  assert.equal(result.decision_class, DECISION_CLASSES.A_AUTONOMOUS)
  assert.equal(result.reversibility, REVERSIBILITY.FULLY_REVERSIBLE)
})

test('technically equivalent implementation choices remain autonomous', () => {
  const result = localWrite({ equivalent_options: ['format-a', 'format-b'] })
  assert.equal(result.requires_owner, false)
})

test('irreversible external communication requires owner decision', () => {
  const result = evaluateEffect({ intent, capsule, effect: EFFECTS.EXTERNAL_COMMUNICATION, resource: 'owner@example.invalid', reversibility: REVERSIBILITY.IRREVERSIBLE })
  assert.equal(result.decision_class, DECISION_CLASSES.C_BUNDLED_OWNER_DECISION)
  assert.equal(result.requires_owner, true)
})

test('local commit is autonomous when the capsule permits it', () => {
  const result = evaluateEffect({ intent, capsule, effect: EFFECTS.LOCAL_COMMIT, resource: 'feature branch', reversibility: REVERSIBILITY.FULLY_REVERSIBLE })
  assert.equal(result.decision_class, DECISION_CLASSES.A_AUTONOMOUS)
})

test('merge remains owner-gated without an owner receipt', () => {
  const result = evaluateEffect({ intent, capsule, effect: EFFECTS.MERGE, resource: 'main', reversibility: REVERSIBILITY.IRREVERSIBLE })
  assert.equal(result.decision_class, DECISION_CLASSES.C_BUNDLED_OWNER_DECISION)
})

test('approval budget allows zero routine interruptions', () => {
  const coordinator = createApprovalCoordinator({ budget: capsule.approval_budget })
  coordinator.recordAutonomousDecision()
  assert.equal(coordinator.canRequest({ effect: EFFECTS.MERGE }), true)
  assert.equal(coordinator.metrics().owner_interruption_count, 0)
})

test('approval budget overrun requires a documented reason', () => {
  const coordinator = createApprovalCoordinator({ budget: { ...capsule.approval_budget, maximum_owner_interruptions: 1 } })
  coordinator.recordOwnerInterruption()
  assert.equal(coordinator.canRequest({ effect: EFFECTS.PRODUCTION_DEPLOY }).allowed, false)
  assert.equal(coordinator.canRequest({ effect: EFFECTS.PRODUCTION_DEPLOY, reason: 'critical risk newly discovered' }).allowed, true)
})

test('valid receipt survives a process-style store reload', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-v2-restart-'))
  const receipt = createApprovalReceipt({ intent, capsule, effect_classes: [EFFECTS.MERGE], resource_scope: ['main'], allowed_actions: ['merge'], signing_key: 'test-key', expires_at: '2099-01-01T00:00:00.000Z' })
  await new ApprovalReceiptStore(dir).save(receipt)
  const loaded = await new ApprovalReceiptStore(dir).get(receipt.approval_id)
  assert.equal(validateApprovalReceipt(loaded, { signing_key: 'test-key' }).valid, true)
})

test('approval deduplication survives a coordinator process restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-v2-coordinator-'))
  const stateFile = path.join(dir, 'requests.json')
  const first = createApprovalCoordinator({ stateFile })
  const initial = first.request({ effect: EFFECTS.MERGE, resource: 'main', reason: 'publish tested branch' })
  const second = createApprovalCoordinator({ stateFile })
  const resumed = second.request({ effect: EFFECTS.MERGE, resource: 'main', reason: 'Publish the tested branch.' })
  assert.equal(resumed.request_id, initial.request_id)
})

test('receipt from another repository is blocked', () => {
  const receipt = createApprovalReceipt({ intent, capsule, repository: 'https://github.com/other/repo', effect_classes: [EFFECTS.MERGE], resource_scope: ['main'], allowed_actions: ['merge'], signing_key: 'test-key', expires_at: '2099-01-01T00:00:00.000Z' })
  assert.equal(validateApprovalReceipt(receipt, { signing_key: 'test-key', repository: 'https://github.com/example/repo' }).code, 'RED_BLOCK_CROSS_REPOSITORY')
})

test('approval receipt cannot mutate the approval engine', () => {
  const result = evaluateEffect({ intent, capsule, effect: EFFECTS.APPROVAL_ENGINE_MUTATION, resource: 'runtime/approval/approval-engine.mjs', reversibility: REVERSIBILITY.IRREVERSIBLE })
  assert.equal(result.decision_class, DECISION_CLASSES.D_TECHNICAL_BLOCK)
})

test('reviewer flags an unnecessary escalation', () => {
  const result = reviewApprovalMinimization({ kind: 'technical-routine', question: 'Should tests be rerun?', effect: EFFECTS.TEST_EXECUTION, reversible: true, in_scope: true })
  assert.equal(result.finding, 'UNNECESSARY_ESCALATION')
})

test('three decisions produce one packet', () => {
  const packet = bundleApprovalRequests([1, 2, 3].map((id) => ({ effect: EFFECTS.MERGE, resource: `main-${id}`, reason: 'publish' })))
  assert.equal(packet.decisions.length, 3)
  assert.equal(packet.metrics.bundled_request_count, 3)
})

test('owner rejection leaves safe work available', () => {
  const graph = createTaskGraph([
    { id: 'safe', effect: EFFECTS.LOCAL_WRITE, resource: 'runtime/approval/x', reversible: REVERSIBILITY.FULLY_REVERSIBLE, dependencies: [] },
    { id: 'external', effect: EFFECTS.EXTERNAL_COMMUNICATION, resource: 'owner', reversible: REVERSIBILITY.IRREVERSIBLE, dependencies: [] },
  ])
  const result = continueSafeWork({ graph, context: { intent, capsule }, decisions: { external: 'REJECT' } })
  assert.equal(result.nodes.find((node) => node.id === 'safe').status, 'COMPLETED')
  assert.equal(result.nodes.find((node) => node.id === 'external').status, 'BLOCKED_POLICY')
})

test('reversible deletion can be restored', () => {
  const result = evaluateEffect({ intent, capsule, effect: EFFECTS.LOCAL_DELETE, resource: 'runtime/approval/tmp', reversibility: REVERSIBILITY.FULLY_REVERSIBLE, restore_available: true })
  assert.equal(result.decision_class, DECISION_CLASSES.A_AUTONOMOUS)
  assert.equal(result.restore_available, true)
})

test('irreversible deletion is owner-gated', () => {
  const result = evaluateEffect({ intent, capsule, effect: EFFECTS.IRREVERSIBLE_DELETE, resource: 'data/important', reversibility: REVERSIBILITY.IRREVERSIBLE })
  assert.equal(result.decision_class, DECISION_CLASSES.C_BUNDLED_OWNER_DECISION)
})
