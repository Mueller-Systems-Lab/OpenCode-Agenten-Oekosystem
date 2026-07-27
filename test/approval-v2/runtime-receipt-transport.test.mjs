import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { EFFECTS } from '../../runtime/approval/approval-engine.mjs'
import {
  ApprovalReceiptStore,
  createApprovalReceipt,
  validateApprovalReceipt,
} from '../../runtime/approval/approval-receipt.mjs'
import { evaluateAction } from '../../runtime/gates/evaluate-action.mjs'

const signingKey = 'synthetic-runtime-receipt-key'
const intent = { intent_id: 'receipt-intent', external_effect_policy: 'approval_required' }
const capsule = {
  task_id: 'receipt-task',
  owner_intent_id: intent.intent_id,
  project_id: 'synthetic-project',
  read_scope: ['**'],
  write_scope: ['synthetic-output.txt', 'git-remote'],
  external_effect_scope: ['git-remote'],
  forbidden_scope: ['.env', '**/.env', '**/.env.*'],
  allowed_effects: [EFFECTS.PUSH],
  baseline: { repository: 'synthetic-project', branch: 'main', base_sha: 'synthetic-base' },
}

async function fixture(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-receipt-transport-'))
  const store = new ApprovalReceiptStore(path.join(root, 'approvals'))
  const receipt = createApprovalReceipt({
    signing_key: signingKey,
    capsule,
    owner_intent_id: intent.intent_id,
    project_id: 'synthetic-project',
    runtime: 'opencode',
    run_id: 'run-1',
    session_id: 'session-1',
    call_id: 'call-1',
    tool: 'git',
    normalized_action: 'push',
    capability: 'git.push',
    effect: EFFECTS.PUSH,
    resource: 'git-remote',
    scope: ['git-remote'],
    approval_authority: 'OWNER_INTENT',
    effect_classes: [EFFECTS.PUSH],
    resource_scope: ['git-remote'],
    allowed_actions: ['push'],
    expires_at: '2099-01-01T00:00:00.000Z',
    ...overrides,
  })
  await store.save(receipt)
  return { root, store, receipt }
}

function actionInput(store, context = {}) {
  return {
    tool: 'bash',
    command: 'git push --force origin main',
    capsule,
    intent,
    runtime: 'opencode',
    receiptStore: store,
    receiptSigningKey: signingKey,
    receiptContext: { project_id: 'synthetic-project', run_id: 'run-1', session_id: 'session-1', call_id: 'call-1', ...context },
  }
}

test('valid receipt reaches the real action evaluator and allows exactly one action', async () => {
  const { store } = await fixture()
  const first = await evaluateAction(actionInput(store))
  const second = await evaluateAction(actionInput(store))
  assert.equal(first.allowed, true)
  assert.equal(first.decision_class, 'B_LEASE_OR_RECEIPT')
  assert.equal(second.allowed, false)
  assert.equal(second.code, 'RED_BLOCK_RECEIPT_REPLAY')
})

test('missing or empty OpenCode session/call bindings block before receipt use', async () => {
  for (const receiptContext of [
    { project_id: 'synthetic-project', run_id: 'run-1', session_id: null, call_id: 'call-1' },
    { project_id: 'synthetic-project', run_id: 'run-1', session_id: '', call_id: 'call-1' },
    { project_id: 'synthetic-project', run_id: 'run-1', session_id: 'session-1', call_id: null },
    { project_id: 'synthetic-project', run_id: 'run-1', session_id: 'session-1', call_id: '' },
  ]) {
    const { store } = await fixture()
    const result = await evaluateAction(actionInput(store, receiptContext))
    assert.equal(result.allowed, false)
    assert.match(result.code, /RECEIPT_CONTEXT_(SESSION|CALL_ID)/)
  }
})

test('same receipt with a new OpenCode callID is blocked', async () => {
  const { store } = await fixture()
  const result = await evaluateAction(actionInput(store, { call_id: 'call-2' }))
  assert.equal(result.allowed, false)
  assert.match(result.code, /RECEIPT_CONTEXT_CALL_ID/)
})

for (const [label, overrides, context, code] of [
  ['resource', { resource: 'other-remote', resource_scope: ['other-remote'], scope: ['other-remote'] }, {}, 'RED_BLOCK_RECEIPT_CONTEXT_RESOURCE'],
  ['effect', { effect: EFFECTS.LOCAL_READ, effect_classes: [EFFECTS.LOCAL_READ] }, {}, 'RED_BLOCK_RECEIPT_CONTEXT_EFFECT'],
  ['tool', { tool: 'filesystem' }, {}, 'RED_BLOCK_RECEIPT_CONTEXT_TOOL'],
  ['action', { normalized_action: 'merge', allowed_actions: ['merge'] }, {}, 'RED_BLOCK_RECEIPT_CONTEXT_ACTION'],
  ['project', { project_id: 'other-project' }, {}, 'RED_BLOCK_RECEIPT_CONTEXT_PROJECT'],
  ['runtime', { runtime: 'hermes' }, {}, 'RED_BLOCK_RECEIPT_CONTEXT_RUNTIME'],
  ['run', { run_id: 'other-run' }, {}, 'RED_BLOCK_RECEIPT_CONTEXT_RUN'],
  ['session', { session_id: 'other-session' }, {}, 'RED_BLOCK_RECEIPT_CONTEXT_SESSION'],
]) {
  test(`receipt with wrong ${label} is fail-closed`, async () => {
    const { store } = await fixture(overrides)
    const result = await evaluateAction(actionInput(store, context))
    assert.equal(result.allowed, false)
    assert.equal(result.code, code)
  })
}

test('expired, tampered, missing, and unknown-field receipts are blocked', async () => {
  const expired = await fixture({ expires_at: '2020-01-01T00:00:00.000Z' })
  assert.equal((await evaluateAction(actionInput(expired.store))).allowed, false)

  const tampered = await fixture()
  const file = path.join(tampered.root, 'approvals', `${tampered.receipt.approval_id}.json`)
  const changed = { ...tampered.receipt, resource: 'other-remote' }
  await fs.writeFile(file, JSON.stringify(changed))
  const tamperedResult = await evaluateAction(actionInput(tampered.store))
  assert.equal(tamperedResult.allowed, false)
  assert.equal(tamperedResult.code, 'RED_BLOCK_RECEIPT_TAMPERED')

  const missingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-receipt-missing-'))
  const missing = await evaluateAction(actionInput(new ApprovalReceiptStore(path.join(missingRoot, 'approvals'))))
  assert.equal(missing.allowed, false)
  assert.equal(missing.code, 'RED_BLOCK_RECEIPT_MISSING')

  const unknown = await fixture()
  const unknownPath = path.join(unknown.root, 'approvals', `${unknown.receipt.approval_id}.json`)
  await fs.writeFile(unknownPath, JSON.stringify({ ...unknown.receipt, privilege_escalation: true }))
  const unknownResult = await evaluateAction(actionInput(unknown.store))
  assert.equal(unknownResult.allowed, false)
  assert.equal(unknownResult.code, 'RED_BLOCK_RECEIPT_UNKNOWN_FIELD')
})

test('symlinked receipt stores and path escape are blocked', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-receipt-safety-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-receipt-outside-'))
  await fs.symlink(outside, path.join(root, 'approvals'))
  await assert.rejects(() => new ApprovalReceiptStore(path.join(root, 'approvals')).listActive(), /symlink|RED_BLOCK/)
  assert.throws(() => new ApprovalReceiptStore(`${root}/../outside`), /inside|escape|RED_BLOCK/)
})

test('two concurrent uses of one receipt produce exactly one allow', async () => {
  const { store } = await fixture()
  const results = await Promise.all([evaluateAction(actionInput(store)), evaluateAction(actionInput(store))])
  assert.equal(results.filter((result) => result.allowed).length, 1)
  assert.equal(results.filter((result) => result.code === 'RED_BLOCK_RECEIPT_REPLAY').length, 1)
})

test('consumed receipt remains blocked after store reload', async () => {
  const { root, store } = await fixture()
  assert.equal((await evaluateAction(actionInput(store))).allowed, true)
  const reloaded = new ApprovalReceiptStore(path.join(root, 'approvals'))
  const replay = await evaluateAction(actionInput(reloaded))
  assert.equal(replay.allowed, false)
  assert.equal(replay.code, 'RED_BLOCK_RECEIPT_REPLAY')
})

test('receipt validator exposes strict runtime binding and does not expose signing material', async () => {
  const { receipt } = await fixture()
  const result = validateApprovalReceipt(receipt, {
    signing_key: signingKey,
    requireRuntimeBinding: true,
    project_id: 'synthetic-project',
    runtime: 'opencode',
    run_id: 'run-1',
    session_id: 'session-1',
    call_id: 'call-1',
    tool: 'git',
    normalized_action: 'push',
    capability: 'git.push',
    effect: EFFECTS.PUSH,
    resource: 'git-remote',
  })
  assert.equal(result.valid, true)
  assert.equal(JSON.stringify(result).includes(signingKey), false)
})

test('generated OpenCode hook transports runtime context to the receipt store', async () => {
  const installer = await fs.readFile(new URL('../../scripts/install-governance.mjs', import.meta.url), 'utf8')
  assert.match(installer, /ApprovalReceiptStore/)
  assert.match(installer, /sessionID/)
  assert.match(installer, /run_id|OCAE_RUN_ID/)
  assert.match(installer, /consume|receiptStore/)
})
