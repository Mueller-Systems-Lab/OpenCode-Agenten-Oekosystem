import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runPipeline } from '../../runtime/pipeline/pipeline.mjs'
import { createTask } from '../../runtime/contracts/index.mjs'
import { loadRunEvents, runIdsOf, hasSecretLeak } from '../../runtime/observability/run-events.mjs'
import { fromNativePlan } from '../../runtime/adapters/native-opencode.mjs'

const PLAN_TEXT = `# Plan

## Targets
- src/add.mjs — implement add(a, b)

## Acceptance Criteria
- add(2, 3) returns 5

## Required Tests
- node --test test/add.test.mjs

## Risks
- none

## Build Scope
files: src/add.mjs, test/add.test.mjs
`

const TEST_FILE = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add } from '../src/add.mjs'
test('add returns sum', () => { assert.equal(add(2, 3), 5) })
`

describe('real vertical slice', () => {
  it('TASK → BASELINE → RESEARCH → PLAN → PLAN_GATE → BUILD → VERIFY → REVIEWS → CONTROLLER → DONE with one run_id', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-vertical-slice-'))
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    const eventSink = path.join(root, 'events.jsonl')

    const buildExecutor = async (buildInput) => {
      await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a + b }\n', 'utf8')
      await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
      return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [] }
    }

    const task = createTask({ run_id: 'vertical-slice-run', task: 'implement a small deterministic add(a, b) function with a passing test', repository: root })

    const result = await runPipeline({
      taskInput: task,
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor,
      verifyChecks: [
        { command: process.execPath, args: ['--check', 'src/add.mjs'], cwd: root },
        { command: process.execPath, args: ['--test', 'test/add.test.mjs'], cwd: root },
      ],
      eventSink,
    })

    // Native plan seam produced a plan contract that passed the gate.
    const nativePlan = fromNativePlan({ run_id: task.run_id, planText: PLAN_TEXT })
    assert.equal(nativePlan.contract, 'ecosystem.plan.v1')
    assert.equal(result.plan_gate.approved, true)
    assert.equal(result.plan.plan.acceptance_criteria[0], 'add(2, 3) returns 5')

    // Real build and verify happened on disk.
    assert.equal(result.build_result.status, 'SUCCESS')
    assert.deepEqual([...result.build_result.changed_files].sort(), ['src/add.mjs', 'test/add.test.mjs'].sort())
    assert.equal(result.verification.verification.passed, true)
    const builtSource = await fs.readFile(path.join(root, 'src', 'add.mjs'), 'utf8')
    assert.match(builtSource, /return a \+ b/)

    // Reviews ran independently.
    assert.deepEqual(result.reviews.map((review) => review.review_type).sort(), ['correctness', 'quality', 'security'])
    assert.ok(result.reviews.every((review) => review.review.status === 'PASS'))

    // Deterministic controller: DONE only here, never worker-certified.
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.decision.reason_code, 'ALL_HARD_GATES_GREEN')
    assert.equal(result.decision.next_path, 'FINALIZE')
    assert.equal(result.decision.first_bad_boundary, null)

    // Phase history is complete and ordered.
    const phaseNames = result.decision.phase_history.map((boundary) => boundary.name)
    assert.deepEqual(phaseNames, ['TASK', 'BASELINE', 'RESEARCH', 'PLAN', 'PLAN_GATE', 'BUILD', 'VERIFY', 'REVIEWS', 'CONTROLLER'])

    // One run_id across every emitted event.
    const events = await loadRunEvents(eventSink)
    assert.equal(runIdsOf(events).length, 1)
    assert.equal(runIdsOf(events)[0], task.run_id)
    assert.equal(events.every((event) => event.contract === 'ecosystem.run-event.v1'), true)
    assert.equal(hasSecretLeak(events), false)

    await fs.rm(root, { recursive: true, force: true })
  })
})
