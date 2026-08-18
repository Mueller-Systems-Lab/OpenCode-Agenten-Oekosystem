// SPDX-License-Identifier: MIT
/**
 * Real-Worker Soak — deterministic regression tests for the invariants that
 * the real-worker soak (evidence/real-worker-soak) exercises with REAL LLM
 * workers. These tests keep the same runtime invariants verifiable WITHOUT a
 * model: the canonical plugin entry chain, run_id correlation, plan gate
 * unbypassability, verify mandatory, bounded retry, security hard block,
 * no-silent-fallback fail-fast, and secret-leak freedom are all enforced by
 * the deterministic runtime regardless of who produces the worker artifacts.
 *
 * Worker artifacts here are deterministic stand-ins; the runtime treats them
 * exactly like real worker output (native plan text, build snapshots).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { repoRoot, runNodeScript } from '../helpers.mjs'
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

const GOOD_IMPL = 'export function add(a, b) { return a + b }\n'
const BAD_IMPL = 'export function add(a, b) { return a - b }\n'
const TEST_FILE = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add } from '../src/add.mjs'
test('add returns sum', () => { assert.equal(add(2, 3), 5) })
`

async function makeTarget(prefix = 'ocae-rw-regression-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.mkdir(path.join(root, 'test'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'add.mjs'), BAD_IMPL, 'utf8')
  await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
  spawnSync('git', ['init', '--initial-branch=master'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'RW Regression'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: root, stdio: 'ignore' })
  return root
}

describe('real-worker soak invariants (deterministic, no model)', () => {
  it('canonical plugin entry chain creates a run-context with ecosystem.task.v1', async (t) => {
    const root = await makeTarget()
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const install = runNodeScript('scripts/install-governance.mjs', ['--target', root, '--apply', '--json'])
    assert.equal(install.status, 0, install.stderr || install.stdout)
    spawnSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'governance'], { cwd: root, stdio: 'ignore' })

    const pluginPath = path.join(root, '.agent-governance', 'hooks', 'opencode', 'canonical-governance.mjs')
    const plugin = await import(pathToFileURL(pluginPath).href)
    const hooks = await plugin.default({ directory: root, worktree: root })
    await hooks['chat.message'](
      { sessionID: 'rw-reg-session', messageID: 'rw-reg-message' },
      {
        message: { role: 'user', id: 'rw-reg-message', sessionID: 'rw-reg-session' },
        parts: [{ type: 'text', text: 'Implement add(a, b) so add(2, 3) returns 5 and run the test.' }],
      },
    )
    const runContext = JSON.parse(await fs.readFile(path.join(root, '.agent-governance', 'runtime', 'run-context.json'), 'utf8'))
    assert.equal(runContext.task.contract, 'ecosystem.task.v1')
    assert.ok(runContext.task.run_id)
    assert.equal(runContext.phase, 'ENTRY')
  })

  it('same run_id across entry and full pipeline (real artifacts correlation)', async (t) => {
    const root = await makeTarget()
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const eventSink = path.join(root, 'events.jsonl')
    const { runTask } = await import('../../runtime/run.mjs')
    const entry = await runTask({ taskInput: { task: 'implement add', repository: root }, repoRoot: root, eventSink })
    const result = await runTask({
      taskInput: entry.task,
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async (buildInput) => {
        const impl = buildInput.attempt === 0 ? BAD_IMPL : GOOD_IMPL
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), impl, 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/add.mjs', 'test/add.test.mjs'], errors: [], strategy_delta: buildInput.attempt === 0 ? 'replace subtraction with addition because the criterion expects a sum' : null }
      },
      verifyChecks: [{ command: process.execPath, args: ['--test', 'test/add.test.mjs'], cwd: root }],
      eventSink,
      max_attempts: 2,
    })
    assert.equal(result.run_id, entry.run_id)
    const events = await loadRunEvents(eventSink)
    assert.equal(runIdsOf(events).length, 1)
    assert.equal(runIdsOf(events)[0], entry.run_id)
  })

  it('plan gate cannot be bypassed: build is never called on a rejected plan', async (t) => {
    const root = await makeTarget()
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const { runTask } = await import('../../runtime/run.mjs')
    let buildCalls = 0
    const result = await runTask({
      taskInput: { task: 'implement add', repository: root },
      repoRoot: root,
      nativePlan: { planText: '# Plan\n## Targets\n- src/add.mjs\n' }, // no acceptance criteria
      buildExecutor: async () => { buildCalls += 1; return { changed_files: [], errors: [] } },
      verifyChecks: [{ command: process.execPath, args: ['--test', 'test/add.test.mjs'], cwd: root }],
    })
    assert.equal(buildCalls, 0)
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.first_bad_boundary, 'PLAN_GATE')
  })

  it('verify is mandatory: build success without passing checks never reaches DONE', async (t) => {
    const root = await makeTarget()
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const { runTask } = await import('../../runtime/run.mjs')
    const result = await runTask({
      taskInput: { task: 'implement add', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), BAD_IMPL, 'utf8')
        await fs.writeFile(path.join(root, 'test', 'add.test.mjs'), TEST_FILE, 'utf8')
        return { changed_files: ['src/add.mjs'], errors: [] }
      },
      verifyChecks: [{ command: process.execPath, args: ['--test', 'test/add.test.mjs'], cwd: root }],
    })
    assert.notEqual(result.decision.decision, 'DONE')
    assert.match(result.verification.verification.failure_signature, /^TEST_FAILURE:/)
  })

  it('bounded retry with meaningful strategy delta ends DONE with FIRST_BAD_BOUNDARY null', async (t) => {
    const root = await makeTarget()
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const { runTask } = await import('../../runtime/run.mjs')
    const eventSink = path.join(root, 'events.jsonl')
    const result = await runTask({
      taskInput: { task: 'implement add', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async (buildInput) => {
        const impl = buildInput.attempt === 0 ? BAD_IMPL : GOOD_IMPL
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), impl, 'utf8')
        return { changed_files: ['src/add.mjs'], errors: [], strategy_delta: buildInput.attempt === 0 ? 'replace subtraction with addition because the criterion expects a sum' : null }
      },
      verifyChecks: [{ command: process.execPath, args: ['--test', 'test/add.test.mjs'], cwd: root }],
      eventSink,
      max_attempts: 2,
    })
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.decision.first_bad_boundary, null)
    const events = await loadRunEvents(eventSink)
    const verifyEvents = events.filter((e) => e.phase === 'VERIFY')
    assert.deepEqual(verifyEvents.map((e) => e.attempt), [0, 1])
    assert.equal(verifyEvents[0].status, 'FAIL')
    assert.equal(verifyEvents[1].status, 'PASS')
  })

  it('retry policy cannot be bypassed: invalid strategy delta is denied', async (t) => {
    const root = await makeTarget()
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const { runTask } = await import('../../runtime/run.mjs')
    const result = await runTask({
      taskInput: { task: 'implement add', repository: root, max_attempts: 2 },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async (buildInput) => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), BAD_IMPL, 'utf8')
        return { changed_files: ['src/add.mjs'], errors: [], strategy_delta: buildInput.attempt === 0 ? 'try again' : null }
      },
      verifyChecks: [{ command: process.execPath, args: ['--test', 'test/add.test.mjs'], cwd: root }],
    })
    assert.equal(result.decision.decision, 'SPLIT')
    assert.equal(result.decision.reason_code, 'RETRY_DENIED_NO_STRATEGY_DELTA')
  })

  it('security hard block: CRITICAL credential finding blocks before DONE and leaks nothing', async (t) => {
    const root = await makeTarget()
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const { runTask } = await import('../../runtime/run.mjs')
    const eventSink = path.join(root, 'events.jsonl')
    const result = await runTask({
      taskInput: { task: 'implement add', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN_TEXT },
      buildExecutor: async () => {
        await fs.writeFile(path.join(root, 'src', 'add.mjs'), GOOD_IMPL, 'utf8')
        await fs.writeFile(path.join(root, 'src', 'secret-holder.mjs'), 'export const apiKey = "sk-regression-fake-0123456789abcdef"\n', 'utf8')
        return { changed_files: ['src/add.mjs', 'src/secret-holder.mjs'], errors: [] }
      },
      verifyChecks: [{ command: process.execPath, args: ['--test', 'test/add.test.mjs'], cwd: root }],
      eventSink,
    })
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'BLOCKING_HIGH_OR_CRITICAL_FINDING')
    const security = result.reviews.find((review) => review.review_type === 'security')
    assert.equal(security.review.blocking, true)
    const events = await loadRunEvents(eventSink)
    assert.equal(hasSecretLeak(events), false)
  })

  it('no silent fallback: runtime entry deliberately unavailable fails fast with CANONICAL_RUNTIME_UNAVAILABLE', async (t) => {
    const root = await makeTarget()
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const install = runNodeScript('scripts/install-governance.mjs', ['--target', root, '--apply', '--json'])
    assert.equal(install.status, 0, install.stderr || install.stdout)
    const runMjs = path.join(root, '.agent-governance', 'runtime', 'run.mjs')
    const moved = path.join(root, '.agent-governance', 'runtime', 'run.mjs.disabled')
    await fs.rename(runMjs, moved)
    try {
      const pluginPath = path.join(root, '.agent-governance', 'hooks', 'opencode', 'canonical-governance.mjs')
      const plugin = await import(pathToFileURL(pluginPath).href)
      const hooks = await plugin.default({ directory: root, worktree: root })
      await assert.rejects(
        () => hooks['chat.message'](
          { sessionID: 'legacy-session', messageID: 'legacy-message' },
          {
            message: { role: 'user', id: 'legacy-message', sessionID: 'legacy-session' },
            parts: [{ type: 'text', text: 'Implement add(a, b).' }],
          },
        ),
        /CANONICAL_RUNTIME_UNAVAILABLE/,
      )
      const runContextExists = await fs.access(path.join(root, '.agent-governance', 'runtime', 'run-context.json')).then(() => true).catch(() => false)
      assert.equal(runContextExists, false) // canonical runtime did not run and no silent fallback continued
    } finally {
      await fs.rename(moved, runMjs).catch(() => {})
    }
  })

  it('real-worker-soak corpus is structurally valid', async () => {
    const { CORPUS } = await import('../../test/fixtures/real-worker-soak/corpus.mjs')
    assert.ok(CORPUS.length >= 8, 'corpus must have at least 8 cases')
    for (const caseDef of CORPUS) {
      assert.ok(caseDef.case_id, 'case_id missing')
      assert.ok(caseDef.task, 'task missing')
      assert.ok(typeof caseDef.setup === 'function', 'setup missing')
      assert.ok(typeof caseDef.verifyChecks === 'function', 'verifyChecks missing')
    }
  })
})