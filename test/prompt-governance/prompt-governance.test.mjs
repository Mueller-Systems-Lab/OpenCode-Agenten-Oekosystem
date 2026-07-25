import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { repoRoot } from '../helpers.mjs'

test('prompt governance evaluation is deterministic and meets compression targets', () => {
  const run = () => spawnSync(process.execPath, [path.join(repoRoot, 'scripts/evaluate-prompt-governance.mjs'), '--json'], { cwd: repoRoot, encoding: 'utf8' })
  const first = run()
  const second = run()
  assert.equal(first.status, 0, first.stderr)
  assert.deepEqual(JSON.parse(first.stdout), JSON.parse(second.stdout))
  const report = JSON.parse(first.stdout)
  assert.equal(report.deterministic, true)
  assert.equal(report.v2.duplicate_approval_requests, 0)
  assert.equal(report.v2.serial_approvals, 0)
  assert.equal(report.v2.unnecessary_escalations, 0)
  assert.equal(report.v2.task_success_rate, 1)
  assert.equal(report.v2.approval_requests, report.v2.owner_interruptions)
  assert.ok(report.v2.approval_decisions_bundled > report.v2.approval_requests)
  assert.deepEqual(report.v2.metric_evidence.prevented_routine_escalation_ids.sort(), ['filename-question', 'review-escalation'])
  assert.equal(report.v2.metric_evidence.owner_scenario_ids.length, report.v2.approval_decisions_bundled)
})
