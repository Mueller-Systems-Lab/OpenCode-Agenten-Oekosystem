import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runPipeline } from '../../runtime/pipeline/pipeline.mjs'
import { createTask } from '../../runtime/contracts/index.mjs'
import { loadRunEvents, runIdsOf, hasSecretLeak } from '../../runtime/observability/run-events.mjs'

const SLICE_PLAN = {
  plan: {
    targets: [{ path: 'src/add.mjs', description: 'add(a, b) returns a + b' }],
    acceptance_criteria: ['add(2, 3) returns 5'],
    required_tests: ['node --test test/add.test.mjs'],
    risks: [],
    build_scope: { files: ['src/add.mjs', 'test/add.test.mjs'] },
  },
}

const TEST_CONTENT = (implementation) => `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add } from '../src/add.mjs'
test('add returns sum', () => { assert.equal(add(2, 3), 5) })
${''}
`

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-observability-'))
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

describe('boundary observability', () => {
  it('controlled failure: same run_id, attempt, signature, first bad boundary, final state', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const runId = `obs-fail-${Date.now()}`
    const task = createTask({ run_id: runId, task: 'implement add(a, b) with a passing test', repository: root })

    const buildExecutor = async (buildInput) => {
      await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
      await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_CONTENT(), 'utf8')
      return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [] }
    }

    const result = await runPipeline({
      taskInput: task,
      repoRoot: root,
      nativePlan: SLICE_PLAN,
      buildExecutor,
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })

    assert.equal(result.run_id, runId)
    assert.equal(result.decision.decision, 'SPLIT')
    assert.equal(result.decision.reason_code, 'RETRY_DENIED_NO_STRATEGY_DELTA')
    assert.equal(result.decision.first_bad_boundary, 'VERIFY')
    assert.match(result.verification.verification.failure_signature, /^TEST_FAILURE:/)

    const events = await loadRunEvents(eventSink)
    assert.equal(events.length > 0, true)
    assert.equal(runIdsOf(events).length, 1)
    assert.equal(runIdsOf(events)[0], runId)
    const verifyEvents = events.filter((event) => event.phase === 'VERIFY')
    assert.equal(verifyEvents.length, 1)
    assert.equal(verifyEvents[0].attempt, 0)
    assert.equal(verifyEvents[0].status, 'FAIL')
    assert.match(verifyEvents[0].failure_signature, /^TEST_FAILURE:/)
    assert.equal(hasSecretLeak(events), false)

    await fs.rm(root, { recursive: true, force: true })
  })

  it('bounded retry: attempt visible, retry with strategy delta, then DONE', async () => {
    const root = await makeRoot()
    const eventSink = path.join(root, 'events.jsonl')
    const runId = `obs-retry-${Date.now()}`
    const task = createTask({ run_id: runId, task: 'implement add(a, b) with a passing test', repository: root, attempt: 0, max_attempts: 2 })

    const buildExecutor = async (buildInput) => {
      if (buildInput.attempt === 0) {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_CONTENT(), 'utf8')
        return {
          changed_files: ['src/add.mjs', 'test/add.test.mjs'],
          errors: [],
          strategy_delta: 'Replace subtraction with addition because the acceptance criterion expects a sum.',
        }
      }
      await fs.writeFile(path.join(root, 'src', 'add.mjs'), 'export function add(a, b) { return a + b }\n', 'utf8')
      await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_CONTENT(), 'utf8')
      return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [] }
    }

    const result = await runPipeline({
      taskInput: task,
      repoRoot: root,
      nativePlan: SLICE_PLAN,
      buildExecutor,
      verifyChecks: verifyChecksFor(root),
      eventSink,
    })

    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.decision.first_bad_boundary, null)

    const events = await loadRunEvents(eventSink)
    assert.equal(runIdsOf(events).length, 1)
    assert.equal(runIdsOf(events)[0], runId)

    const verifyEvents = events.filter((event) => event.phase === 'VERIFY')
    assert.equal(verifyEvents.length, 2)
    assert.deepEqual(verifyEvents.map((event) => event.attempt), [0, 1])
    assert.equal(verifyEvents[0].status, 'FAIL')
    assert.equal(verifyEvents[1].status, 'PASS')
    assert.match(verifyEvents[0].failure_signature, /^TEST_FAILURE:/)
    assert.equal(verifyEvents[0].strategy_delta.includes('Replace subtraction with addition'), true)

    const buildEvents = events.filter((event) => event.phase === 'BUILD')
    assert.deepEqual(buildEvents.map((event) => event.attempt), [0, 1])

    assert.equal(hasSecretLeak(events), false)

    await fs.rm(root, { recursive: true, force: true })
  })

  it('hasSecretLeak detects embedded secrets in events', () => {
    assert.equal(hasSecretLeak([{ run_id: 'x', note: 'fine' }]), false)
    assert.equal(hasSecretLeak([{ run_id: 'x', note: 'api_key = "abcdefghijklmnopqrstuvwxyz123456"' }]), true)
    assert.equal(hasSecretLeak([{ run_id: 'x' }], ['super-secret-value-xyz']), false)
    assert.equal(hasSecretLeak([{ run_id: 'x', note: 'super-secret-value-xyz' }], ['super-secret-value-xyz']), true)
  })
})
