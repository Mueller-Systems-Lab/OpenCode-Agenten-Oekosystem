import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runTask } from '../../runtime/run.mjs'
import { createTask } from '../../runtime/contracts/index.mjs'
import { loadRunEvents, runIdsOf, hasSecretLeak } from '../../runtime/observability/run-events.mjs'

/**
 * Vertical Slice II — Runtime Adoption.
 *
 * A small REAL development task runs through the canonical runtime entry
 * (runtime/run.mjs → runTask):
 *
 *   TASK → BASELINE → RESEARCH → PLAN → PLAN_GATE → BUILD → VERIFY →
 *   (bounded RETRY) → REVIEWS → CONTROLLER → DONE | FIX | SPLIT | BLOCKED
 *
 * One single run_id across the entire run. Real files on disk, real verify
 * commands, real run events.
 */
const PLAN_TEXT = `# Plan

## Targets
- src/math.mjs — implement add(a, b)

## Acceptance Criteria
- add(2, 3) returns 5

## Required Tests
- node --test test/math.test.mjs

## Risks
- none

## Build Scope
files: src/math.mjs, test/math.test.mjs
`

const TEST_FILE = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add } from '../src/math.mjs'
test('add returns sum', () => { assert.equal(add(2, 3), 5) })
`

async function makeRoot(prefix = 'ocae-slice2-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.mkdir(path.join(root, 'test'), { recursive: true })
  return root
}

function verifyChecksFor(root) {
  return [
    { command: process.execPath, args: ['--check', 'src/math.mjs'], cwd: root },
    { command: process.execPath, args: ['--test', 'test/math.test.mjs'], cwd: root },
  ]
}

describe('vertical slice II — runtime adoption of a real task', () => {
  it('HAPPY PATH: real task → canonical entry → full pipeline → DONE with one run_id', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const runId = `slice2-happy-${Date.now()}`
    const task = createTask({ run_id: runId, task: 'implement add(a, b) with a passing test', repository: root })

    const result = await runTask({
      taskInput: task,
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async (buildInput) => {
        assert.equal(buildInput.run_id, runId) // worker only receives the immutable run_id
        await fs.writeFile(path.join(root, 'src', 'math.mjs'), 'export function add(a, b) { return a + b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'math.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/math.mjs', 'test/math.test.mjs'], errors: [] }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })

    // Canonical entry ran the full pipeline.
    assert.equal(result.phase, 'PIPELINE')
    assert.equal(result.run_id, runId)
    assert.equal(result.decision_validated, true)

    // Baseline, native plan and deterministic plan gate all green.
    assert.equal(result.baseline.approved, true)
    assert.equal(result.plan.contract, 'ecosystem.plan.v1')
    assert.equal(result.plan_gate.approved, true)

    // Native build wrote real files; verify ran real commands.
    assert.equal(result.build_result.status, 'SUCCESS')
    assert.deepEqual([...result.build_result.changed_files].sort(), ['src/math.mjs', 'test/math.test.mjs'].sort())
    assert.equal(result.verification.verification.passed, true)
    const source = await fs.readFile(path.join(root, 'src', 'math.mjs'), 'utf8')
    assert.match(source, /return a \+ b/)

    // Independent reviews ran (correctness, security, quality).
    assert.deepEqual(result.reviews.map((review) => review.review_type).sort(), ['correctness', 'quality', 'security'])
    assert.ok(result.reviews.every((review) => review.review.status === 'PASS'))

    // The deterministic controller produced the sole terminal decision.
    assert.equal(result.decision.contract, 'ecosystem.decision.v1')
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.decision.reason_code, 'ALL_HARD_GATES_GREEN')
    assert.equal(result.decision.next_path, 'FINALIZE')
    assert.equal(result.decision.first_bad_boundary, null)
    assert.deepEqual(
      result.decision.phase_history.map((boundary) => boundary.name),
      ['TASK', 'BASELINE', 'RESEARCH', 'PLAN', 'PLAN_GATE', 'BUILD', 'VERIFY', 'REVIEWS', 'CONTROLLER'],
    )

    // One run_id across every emitted event; no secret leaks.
    const events = await loadRunEvents(eventSink)
    assert.equal(runIdsOf(events).length, 1)
    assert.equal(runIdsOf(events)[0], runId)
    assert.equal(events.every((event) => event.contract === 'ecosystem.run-event.v1'), true)
    assert.equal(hasSecretLeak(events), false)

    await fs.rm(root, { recursive: true, force: true })
  })

  it('FAILURE PATH: VERIFY fails → failure_signature → strategy_delta → bounded retry → DONE, boundary resets', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const runId = `slice2-failure-${Date.now()}`
    const task = createTask({ run_id: runId, task: 'implement add(a, b) with a passing test', repository: root, max_attempts: 2 })

    const result = await runTask({
      taskInput: task,
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async (buildInput) => {
        if (buildInput.attempt === 0) {
          // Controlled, harmless failure: wrong implementation on purpose.
          await fs.writeFile(path.join(root, 'src', 'math.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
          await fs.writeFile(path.join(root, 'test', 'math.test.mjs'), TEST_FILE, 'utf8')
          return {
            changed_files: ['src/math.mjs', 'test/math.test.mjs'],
            errors: [],
            strategy_delta: 'replace subtraction with addition because the acceptance criterion expects a sum',
          }
        }
        await fs.writeFile(path.join(root, 'src', 'math.mjs'), 'export function add(a, b) { return a + b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'math.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/math.mjs', 'test/math.test.mjs'], errors: [] }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })

    // Real failure at VERIFY, normalized signature, concrete strategy delta.
    assert.equal(result.verification.verification.passed, true) // final attempt passed
    const events = await loadRunEvents(eventSink)
    const verifyEvents = events.filter((event) => event.phase === 'VERIFY')
    assert.equal(verifyEvents.length, 2)
    assert.equal(verifyEvents[0].status, 'FAIL')
    assert.match(verifyEvents[0].failure_signature, /^TEST_FAILURE:/)
    assert.ok(verifyEvents[0].strategy_delta.includes('replace subtraction with addition'))
    assert.equal(verifyEvents[1].status, 'PASS')

    // Bounded retry under the retry policy, then DONE — no artificial GREEN shortcut.
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.decision.reason_code, 'ALL_HARD_GATES_GREEN')
    // After the retry succeeded, the final run is NOT blamed on VERIFY.
    assert.equal(result.decision.first_bad_boundary, null)
    assert.equal(runIdsOf(events).length, 1)
    assert.equal(hasSecretLeak(events), false)

    await fs.rm(root, { recursive: true, force: true })
  })

  it('CONTROLLED FAILURE WITHOUT DELTA: FIRST_BAD_BOUNDARY=VERIFY from real execution, SPLIT', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const runId = `slice2-blocked-${Date.now()}`
    const task = createTask({ run_id: runId, task: 'implement add(a, b) with a passing test', repository: root })

    const result = await runTask({
      taskInput: task,
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'math.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'math.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/math.mjs', 'test/math.test.mjs'], errors: [] } // no strategy delta
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })

    // No meaningful strategy delta → no retry → SPLIT, and the first bad
    // boundary is VERIFY because that is where the real run failed.
    assert.equal(result.decision.decision, 'SPLIT')
    assert.equal(result.decision.reason_code, 'RETRY_DENIED_NO_STRATEGY_DELTA')
    assert.equal(result.decision.first_bad_boundary, 'VERIFY')
    assert.match(result.verification.verification.failure_signature, /^TEST_FAILURE:/)
    const events = await loadRunEvents(eventSink)
    assert.equal(runIdsOf(events).length, 1)
    assert.equal(events.some((event) => event.phase === 'VERIFY' && event.status === 'FAIL'), true)

    await fs.rm(root, { recursive: true, force: true })
  })
})