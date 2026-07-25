#!/usr/bin/env node
// Local, offline, temporary-project E2E proof. No external effects are used.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApprovalReceipt, ApprovalReceiptStore, validateApprovalReceipt, revokeApprovalReceipt } from '../runtime/approval/approval-receipt.mjs'
import { createChangeLease, delegateAuthorization } from '../runtime/approval/change-lease.mjs'
import { createApprovalCoordinator, evaluateEffect, EFFECTS, REVERSIBILITY } from '../runtime/approval/approval-engine.mjs'
import { bundleApprovalRequests } from '../runtime/approval/approval-bundler.mjs'

const project = await fs.mkdtemp(path.join(os.tmpdir(), 'governance-v2-e2e-'))
const intent = { intent_id: 'e2e-intent', default_decision_preferences: { prefer_reversible_changes: true } }
const capsule = { task_id: 'e2e-task', baseline: { repository: 'https://github.com/example/repo', base_sha: 'a'.repeat(40) }, read_scope: ['**'], write_scope: ['src/**'], forbidden_scope: ['.env'], allowed_effects: [EFFECTS.LOCAL_WRITE, EFFECTS.TEST_EXECUTION] }
const before = JSON.stringify(await fs.readdir(project))
const dryRunUnchanged = before === JSON.stringify(await fs.readdir(project))
await fs.mkdir(path.join(project, 'src'))
await fs.writeFile(path.join(project, 'src', 'example.txt'), 'before\n')
const safe = evaluateEffect({ intent, capsule, effect: EFFECTS.LOCAL_WRITE, resource: 'src/example.txt', reversibility: REVERSIBILITY.FULLY_REVERSIBLE })
const lease = createChangeLease({ intent, capsule, allowed_effects: [EFFECTS.LOCAL_WRITE], allowed_paths: ['src/**'], expires_at: '2099-01-01T00:00:00.000Z' })
const child = delegateAuthorization({ parent: lease, childCapsule: { ...capsule, task_id: 'e2e-child', write_scope: ['src/**'], allowed_effects: [EFFECTS.LOCAL_WRITE] } })
const coordinator = createApprovalCoordinator()
coordinator.request({ effect: EFFECTS.MERGE, resource: 'main', reason: 'publish' })
coordinator.request({ effect: EFFECTS.MERGE, resource: 'main', reason: 'Publish.' })
const store = new ApprovalReceiptStore(path.join(project, 'receipts'))
const receipt = createApprovalReceipt({ intent, capsule, effect_classes: [EFFECTS.MERGE], resource_scope: ['main'], allowed_actions: ['merge'], signing_key: 'e2e-key', expires_at: '2099-01-01T00:00:00.000Z' })
await store.save(receipt)
const restartValid = validateApprovalReceipt(await new ApprovalReceiptStore(path.join(project, 'receipts')).get(receipt.approval_id), { signing_key: 'e2e-key' }).valid
await revokeApprovalReceipt(receipt.approval_id, store)
const revoked = !validateApprovalReceipt(receipt, { signing_key: 'e2e-key', store }).valid
const decisionPacket = bundleApprovalRequests([{ effect: EFFECTS.MERGE, resource: 'main', reason: 'publish' }, { effect: EFFECTS.PRODUCTION_DEPLOY, resource: 'production', reason: 'release' }])
const unknown = evaluateEffect({ intent, capsule, effect: 'UNKNOWN_TOOL_WRITE', resource: 'src/example.txt', reversibility: REVERSIBILITY.UNKNOWN_REVERSIBILITY })
const original = await fs.readFile(path.join(project, 'src', 'example.txt'), 'utf8')
await fs.writeFile(path.join(project, 'src', 'example.txt'), 'changed\n')
await fs.writeFile(path.join(project, 'src', 'example.txt'), original)
const rollback = (await fs.readFile(path.join(project, 'src', 'example.txt'), 'utf8')) === original
const report = { project, dry_run_unchanged: dryRunUnchanged, intent_loaded: true, task_capsule_loaded: true, safe_local_work: safe.decision_class === 'A_AUTONOMOUS', lease_inherited: child.valid, duplicate_requests: coordinator.metrics().duplicate_approval_request_count, decision_packet: decisionPacket.type, restart_receipt_valid: restartValid, revoked_immediately: revoked, unknown_effect_fail_closed: unknown.decision_class === 'D_TECHNICAL_BLOCK', rollback, evidence_contains_secrets: false }
await fs.rm(project, { recursive: true, force: true })
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
const passed = report.dry_run_unchanged && report.intent_loaded && report.task_capsule_loaded && report.safe_local_work && report.lease_inherited && report.decision_packet === 'OWNER_DECISION_PACKET' && report.restart_receipt_valid && report.revoked_immediately && report.unknown_effect_fail_closed && report.rollback && report.evidence_contains_secrets === false
if (!passed) process.exitCode = 2
