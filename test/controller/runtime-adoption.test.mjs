import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runTask, enterRun, defaultRunEventSink } from '../../runtime/run.mjs'
import { createTask } from '../../runtime/contracts/index.mjs'
import { loadRunEvents, runIdsOf, hasSecretLeak } from '../../runtime/observability/run-events.mjs'

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

const baseProfile = (requiredTools = [], optionalTools = []) => ({
  agent_id: 'adoption-agent', role: 'adoption', required_tools: requiredTools, optional_tools: optionalTools,
  allowed_operations: ['read', 'test', 'write'], denied_operations: ['merge', 'deploy'],
  allowed_paths: ['**'], write_paths: ['src/**', 'test/**'],
  network_policy: 'deny', egress_policy: 'deny', trust_tier: '1_sandboxed', tool_version_constraints: {},
  auth_requirement: {}, timeout_ms: 5000, preflight_failure_policy: 'FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT',
})

async function makeRoot(prefix = 'ocae-adoption-') {
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

const goodExecutor = (root, impl = 'export function add(a, b) { return a + b }\n') => async () => {
  await fs.writeFile(path.join(root, 'src', 'add.mjs'), impl, 'utf8')
  await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
  return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [] }
}

describe('runtime adoption — canonical entry is the real task path', () => {
  it('normal task enters the canonical runtime (ecosystem.task.v1 + run_id created)', async () => {
    const root = await makeRoot()
    const entry = await runTask({ taskInput: { task: 'implement add(a, b) with a passing test', repository: root }, repoRoot: root })
    assert.equal(entry.phase, 'ENTRY')
    assert.equal(entry.task.contract, 'ecosystem.task.v1')
    assert.ok(entry.run_id && entry.task.run_id === entry.run_id)
    assert.equal(entry.baseline.approved, true)
    assert.equal(entry.decision, null) // terminal decision only from the controller when a full run happens
    await fs.rm(root, { recursive: true, force: true })
  })

  it('same run_id across real execution: entry reuses the task contract', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const entry = await runTask({ taskInput: { task: 'implement add(a, b) with a passing test', repository: root }, repoRoot: root, eventSink })
    const full = await runTask({
      taskInput: entry.task, // the exact ecosystem.task.v1 from the entry
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: goodExecutor(root),
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    assert.equal(full.phase, 'PIPELINE')
    assert.equal(full.run_id, entry.run_id)
    assert.equal(full.task.run_id, entry.run_id)
    const events = await loadRunEvents(eventSink)
    assert.equal(runIdsOf(events).length, 1)
    assert.equal(runIdsOf(events)[0], entry.run_id)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('plan cannot bypass the deterministic plan gate: build is never invoked on a failing plan', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    let buildCalls = 0
    const badPlan = '# Plan\n## Targets\n- src/add.mjs\n## Acceptance Criteria\n\n## Build Scope\nfiles: src/add.mjs\n'
    const result = await runTask({
      taskInput: { task: 'implement add', repository: root },
      repoRoot: root,
      nativePlan: { planText: badPlan },
      buildExecutor: async () => { buildCalls += 1; return { changed_files: [], errors: [] } },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    assert.equal(buildCalls, 0) // no build without an approved plan gate
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.first_bad_boundary, 'PLAN_GATE')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('build cannot bypass verify: a successful build without passing checks never reaches DONE', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    // Build writes a WRONG implementation; verify must catch it.
    const result = await runTask({
      taskInput: { task: 'implement add(a, b) with a passing test', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [] }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    assert.notEqual(result.decision.decision, 'DONE')
    assert.equal(result.decision.first_bad_boundary, 'VERIFY')
    assert.match(result.verification.verification.failure_signature, /^TEST_FAILURE:/)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('worker cannot directly declare DONE: a worker-claimed terminal state is ignored', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const result = await runTask({
      taskInput: { task: 'implement add(a, b) with a passing test', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [], decision: 'DONE', status: 'SUCCESS' }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    // Worker claimed DONE but verify failed → controller says SPLIT, never DONE.
    assert.equal(result.decision.decision, 'SPLIT')
    assert.equal(result.decision.reason_code, 'RETRY_DENIED_NO_STRATEGY_DELTA')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('retry cannot bypass the retry policy: attempt limit and invalid deltas are denied', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const run = async (delta) => runTask({
      taskInput: { task: 'implement add(a, b) with a passing test', repository: root, max_attempts: 1 },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [], strategy_delta: delta }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    const attemptLimit = await run('replace subtraction with addition because the criterion expects a sum')
    assert.equal(attemptLimit.decision.decision, 'SPLIT')
    assert.equal(attemptLimit.decision.reason_code, 'RETRY_DENIED_ATTEMPT_LIMIT')
    const invalidDelta = await run('try again')
    assert.equal(invalidDelta.decision.decision, 'SPLIT')
    assert.equal(invalidDelta.decision.reason_code, 'RETRY_DENIED_NO_STRATEGY_DELTA')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('required MCP missing blocks before any work is performed', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    let buildCalls = 0
    const result = await runTask({
      taskInput: { task: 'implement a github workflow change', repository: root },
      repoRoot: root,
      mcpProfile: baseProfile([{ name: 'github', server: 'github-server' }]),
      inventory: {},
      buildExecutor: async () => { buildCalls += 1; return { changed_files: [], errors: [] } },
      nativePlan: { planText: PLAN_TEXT },
      verifyChecks: [],
      eventSink,
    })
    assert.equal(result.phase, 'BLOCKED_ENTRY')
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'BLOCKED_MISSING_REQUIRED_CAPABILITY')
    assert.equal(result.decision.first_bad_boundary, 'BASELINE')
    assert.equal(buildCalls, 0) // fail early: no worker work started
    await fs.rm(root, { recursive: true, force: true })
  })

  it('optional capability missing does not block the run', async () => {
    const root = await makeRoot()
    const entry = await runTask({
      taskInput: { task: 'implement a local function and open a github issue when done', repository: root },
      repoRoot: root,
      env: {}, // no GITHUB_TOKEN → optional github capability missing
    })
    assert.equal(entry.phase, 'ENTRY')
    assert.equal(entry.baseline.approved, true)
    assert.equal(entry.baseline.required_capabilities.github, 'MISSING')
    assert.ok(entry.baseline.optional_degradations.length > 0)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('security HIGH blocking overrides correctness and quality PASS (no majority override)', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const result = await runTask({
      taskInput: { task: 'implement add(a, b) with a passing test', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a + b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        // Hardcoded credential-like value → security analyzer must flag it CRITICAL.
        await fs.writeFile(path.join(root, 'src', 'secret-holder.mjs'), 'export const apiKey = "sk-secret-abcdefghijklmnop"\n', 'utf8')
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs', 'src/secret-holder.mjs'], errors: [] }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'BLOCKING_HIGH_OR_CRITICAL_FINDING')
    const security = result.reviews.find((review) => review.review_type === 'security')
    assert.equal(security.review.blocking, true)
    // No secret leaks into the event stream despite the hardcoded credential on disk.
    const events = await loadRunEvents(eventSink)
    assert.equal(hasSecretLeak(events), false)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('real run emits observability events with the canonical event schema', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const result = await runTask({
      taskInput: { task: 'implement add(a, b) with a passing test', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: goodExecutor(root),
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    const events = await loadRunEvents(eventSink)
    assert.equal(runIdsOf(events).length, 1)
    for (const event of events) {
      assert.equal(event.contract, 'ecosystem.run-event.v1')
      for (const field of ['run_id', 'phase', 'job', 'attempt', 'timestamp', 'status', 'duration_ms']) {
        assert.ok(field in event, `event missing ${field}`)
      }
    }
    assert.equal(events.some((event) => event.phase === 'CONTROLLER' && event.status === 'PASS'), true)
    assert.equal(hasSecretLeak(events), false)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('FIRST_BAD_BOUNDARY comes from real execution and resets after a successful retry', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const runId = `adopt-fbb-${Date.now()}`
    const task = createTask({ run_id: runId, task: 'implement add(a, b) with a passing test', repository: root, max_attempts: 2 })
    const result = await runTask({
      taskInput: task,
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async (buildInput) => {
        if (buildInput.attempt === 0) {
          await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
          return { changed_files: ['src/add.mjs'], errors: [], strategy_delta: 'replace subtraction with addition because the acceptance criterion expects a sum' }
        }
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a + b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [] }
      },
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    // After the bounded retry succeeded, the final run is not blamed on VERIFY.
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.decision.first_bad_boundary, null)
    const events = await loadRunEvents(eventSink)
    const verifyEvents = events.filter((event) => event.phase === 'VERIFY')
    assert.deepEqual(verifyEvents.map((event) => event.attempt), [0, 1])
    assert.equal(verifyEvents[0].status, 'FAIL')
    assert.equal(verifyEvents[1].status, 'PASS')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('legacy-compatible entry (enterRun) reaches the canonical runtime', async () => {
    const root = await makeRoot()
    const entry = await enterRun({
      targetRoot: root,
      taskText: 'Implement a small local feature and run the tests.',
      sessionId: 'session-legacy',
      messageId: 'message-legacy',
    })
    assert.equal(entry.task.contract, 'ecosystem.task.v1')
    assert.ok(entry.task.run_id)
    assert.equal(entry.phase, 'ENTRY')
    // Second call for the same message is idempotent: run_id is stable.
    const again = await enterRun({ targetRoot: root, taskText: 'Implement a small local feature and run the tests.', sessionId: 'session-legacy', messageId: 'message-legacy' })
    assert.equal(again.task.run_id, entry.task.run_id)
    assert.equal(again.idempotent, true)
    const events = await loadRunEvents(defaultRunEventSink(root))
    assert.equal(runIdsOf(events).length, 1)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('controller is the sole terminal authority: decision is a validated ecosystem.decision.v1', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const result = await runTask({
      taskInput: { task: 'implement add(a, b) with a passing test', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: goodExecutor(root),
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })
    assert.equal(result.phase, 'PIPELINE')
    assert.equal(result.decision_validated, true)
    assert.equal(result.decision.contract, 'ecosystem.decision.v1')
    assert.ok(['DONE', 'FIX', 'SPLIT', 'BLOCKED'].includes(result.decision.decision))
    await fs.rm(root, { recursive: true, force: true })
  })
})