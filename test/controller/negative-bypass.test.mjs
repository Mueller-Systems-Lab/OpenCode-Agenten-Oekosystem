import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runTask } from '../../runtime/run.mjs'
import { createTask } from '../../runtime/contracts/index.mjs'

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

async function makeRoot(prefix = 'ocae-bypass-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.mkdir(path.join(root, 'test'), { recursive: true })
  return root
}

function verifyChecksFor(root) {
  return [
    { command: process.execPath, args: ['--check', 'src/add.mjs'], cwd: root },
    { command: process.execPath, args: ['--test', 'test/add.test.mjs'], cwd: root },
  ]
}

describe('negative bypass attempts — the control chain cannot be circumvented', () => {
  it('PLAN BYPASS: build without an approved plan gate is DENIED (worker never invoked)', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    let buildCalls = 0
    const result = await runTask({
      taskInput: { task: 'implement add', repository: root },
      repoRoot: root,
      // Plan text without acceptance criteria → plan gate must reject.
      nativePlan: { planText: '# Plan\n## Targets\n- src/add.mjs\n## Build Scope\nfiles: src/add.mjs\n' },
      buildExecutor: async () => { buildCalls += 1; return { changed_files: [], errors: [], decision: 'DONE' } },
      verifyChecks: [],
      eventSink,
    })
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.first_bad_boundary, 'PLAN_GATE')
    assert.equal(buildCalls, 0)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('WORKER DONE BYPASS: a worker-claimed DONE is not accepted as the global terminal state', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const result = await runTask({
      taskInput: { task: 'implement add(a, b) with a passing test', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        // The worker aggressively claims the terminal state.
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [], decision: 'DONE', done: true }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    // Verification failed → the terminal decision is SPLIT, never the worker claim.
    assert.equal(result.decision.decision, 'SPLIT')
    assert.equal(result.decision.first_bad_boundary, 'VERIFY')
    assert.ok(!result.decision.worker_claim_done)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('RETRY BYPASS: a worker cannot force additional attempts outside the retry policy', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    // max_attempts = 1: exactly one build attempt is authorized.
    const task = createTask({ run_id: 'retry-bypass', task: 'implement add(a, b) with a passing test', repository: root, max_attempts: 1 })
    let buildCalls = 0
    const result = await runTask({
      taskInput: task,
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        buildCalls += 1
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [], strategy_delta: 'replace subtraction with addition because the criterion expects a sum' }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    // The pipeline retried once (attempt 0 → 1) then the policy denied further attempts.
    assert.equal(result.decision.decision, 'SPLIT')
    assert.equal(result.decision.reason_code, 'RETRY_DENIED_ATTEMPT_LIMIT')
    assert.equal(buildCalls, 2)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('RETRY BYPASS: a meaningless strategy delta ("try again") is denied', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const result = await runTask({
      taskInput: { task: 'implement add(a, b) with a passing test', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [], strategy_delta: 'try again' }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    assert.equal(result.decision.decision, 'SPLIT')
    assert.equal(result.decision.reason_code, 'RETRY_DENIED_NO_STRATEGY_DELTA')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('SECURITY BYPASS: HIGH blocking security overrides correctness and quality PASS', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const result = await runTask({
      taskInput: { task: 'implement add(a, b) with a passing test', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a + b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        // A private key block is the strongest hard-block trigger.
        await fs.writeFile(path.join(root, 'src', 'key.mjs'), '-----BEGIN RSA PRIVATE KEY-----\nMIIEpA==\n-----END RSA PRIVATE KEY-----\n', 'utf8')
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs', 'src/key.mjs'], errors: [] }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    const correctness = result.reviews.find((review) => review.review_type === 'correctness')
    const quality = result.reviews.find((review) => review.review_type === 'quality')
    assert.equal(correctness.review.status, 'PASS')
    assert.equal(quality.review.status, 'PASS')
    // Despite two PASS reviews, the security hard block wins — no majority override.
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'BLOCKING_HIGH_OR_CRITICAL_FINDING')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('RUN-ID REPLACEMENT: a worker-supplied different run_id aborts with CONTRACT_INVALID', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const task = createTask({ run_id: 'canonical-run-id', task: 'implement add(a, b) with a passing test', repository: root })
    const result = await runTask({
      taskInput: task,
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a + b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        // The worker tries to replace the immutable correlation identity.
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [], run_id: 'worker-replaced-run-id' }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    assert.equal(result.phase, 'ABORTED')
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'CONTRACT_INVALID')
    assert.match(result.decision.contract_invalid_reason, /run_id worker-replaced-run-id does not match/)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('CONTRACT BYPASS: an invalid task contract is rejected before any work', async () => {
    const root = await makeRoot()
    const invalid = { contract: 'ecosystem.task.v1', run_id: '', task: '', attempt: -1, max_attempts: 0, created_at: 'not-a-date' }
    const result = await runTask({ taskInput: invalid, repoRoot: root })
    assert.equal(result.phase, 'FAILED_ENTRY')
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'CONTRACT_INVALID')
    assert.ok(result.validation_issues.length > 0)
    await fs.rm(root, { recursive: true, force: true })
  })
})