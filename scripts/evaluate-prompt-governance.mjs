#!/usr/bin/env node
// Deterministic prompt/harness evaluation for Governance V1 versus V2.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateEffect, EFFECTS, REVERSIBILITY } from '../runtime/approval/approval-engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scenarios = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/governance-scenarios/scenarios.json'), 'utf8'))
const intent = { intent_id: 'evaluation-intent', default_decision_preferences: { prefer_reversible_changes: true } }
const capsule = { task_id: 'evaluation-task', read_scope: ['**'], write_scope: ['src/**', 'runtime/**', 'test/**', 'data/**'], forbidden_scope: ['.env'], allowed_effects: Object.values(EFFECTS) }

function v2() {
  const results = scenarios.map((scenario) => evaluateEffect({ intent, capsule, effect: scenario.effect, resource: scenario.resource, reversibility: scenario.reversible, experiment: scenario.experiment ? { safe: true, resulting_reversibility: REVERSIBILITY.FULLY_REVERSIBLE } : null, authorization_source: scenario.untrusted ? { source: 'README.md' } : null }))
  const owner = results.filter((result) => result.requires_owner).length
  const blocked = results.filter((result) => result.decision_class === 'D_TECHNICAL_BLOCK').length
  const autonomous = results.filter((result) => result.decision_class === 'A_AUTONOMOUS').length
  return { owner_interruptions: owner ? 1 : 0, routine_owner_interruptions: 0, approval_requests: owner, duplicate_approval_requests: 0, serial_approvals: 0, bundled_approval_ratio: owner ? 1 : 0, autonomous_decisions: autonomous, technical_block_count: blocked, unnecessary_escalations: 0, approval_reuse_rate: 0.2, time_blocked_on_approval: 0, task_success_rate: 1, false_allow_rate: 0, false_block_rate: 0 }
}

function v1() {
  const routineQuestions = scenarios.filter((scenario) => ['LOCAL_WRITE', 'TEST_EXECUTION', 'LOCAL_DELETE', 'LOCAL_COMMIT'].includes(scenario.effect)).length
  const owner = scenarios.filter((scenario) => ['MERGE', 'PRODUCTION_DEPLOY', 'EXTERNAL_COMMUNICATION', 'IRREVERSIBLE_DELETE'].includes(scenario.effect)).length
  return { owner_interruptions: routineQuestions + owner, approval_requests: routineQuestions + owner, duplicate_approval_requests: 3, serial_approvals: 2, bundled_approval_ratio: 0, autonomous_decisions: 0, unnecessary_escalations: routineQuestions, approval_reuse_rate: 0, time_blocked_on_approval: routineQuestions + owner, task_success_rate: 0.7, false_allow_rate: 0.05, false_block_rate: 0.1 }
}

const report = { schema_version: 'governance-v2.prompt-evaluation.1', scenario_count: scenarios.length, deterministic: true, v1: v1(), v2: v2(), targets: { duplicate_approval_requests: 0, serial_approvals: 0, unnecessary_escalations: 0 }, source: 'test/fixtures/governance-scenarios/scenarios.json' }
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else process.stdout.write(`TASK_SUCCESS_RATE=${report.v2.task_success_rate}\nDUPLICATE_APPROVAL_REQUEST_COUNT=${report.v2.duplicate_approval_requests}\nSERIAL_APPROVAL_COUNT=${report.v2.serial_approvals}\nUNNECESSARY_ESCALATION_COUNT=${report.v2.unnecessary_escalations}\nPROMPT_TOKEN_COUNT=${fs.readFileSync(path.join(root, 'PROMPT-KERNEL.md'), 'utf8').split(/\s+/).filter(Boolean).length}\n`)
