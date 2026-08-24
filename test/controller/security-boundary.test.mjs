import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runTask } from '../../runtime/run.mjs'
import { reviewSecurity } from '../../runtime/reviews/analyze.mjs'
import { create as createReview } from '../../runtime/contracts/review.mjs'

const PLAN_TEXT = `# Plan
## Targets
- src/eval-calc.mjs — add expression evaluator
## Acceptance Criteria
- src/eval-calc.mjs is syntactically valid
## Required Tests
- node --check src/eval-calc.mjs
## Risks
- none
## Build Scope
- files: src/eval-calc.mjs
`

test('security review: non-blocking MEDIUM finding => status FAIL, recommendation FIX, blocking false', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-sec-boundary-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'eval-calc.mjs'), 'export function evaluate(expression) { return eval(expression) }\n', 'utf8')
  const review = reviewSecurity({ run_id: 'sec-boundary-run', buildResult: { status: 'SUCCESS', changed_files: ['src/eval-calc.mjs'] }, repoRoot: root })
  assert.equal(review.review_type, 'security')
  assert.equal(review.review.status, 'FAIL')
  assert.equal(review.review.blocking, false)
  assert.equal(review.review.recommendation, 'FIX')
  assert.ok(review.review.findings.some((f) => f.severity === 'MEDIUM'))
  await fs.rm(root, { recursive: true, force: true })
})

test('security review: clean file => status PASS, blocking false, recommendation PASS', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-sec-clean-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'clean.mjs'), 'export function identity(value) { return value }\n', 'utf8')
  const review = reviewSecurity({ run_id: 'sec-clean-run', buildResult: { status: 'SUCCESS', changed_files: ['src/clean.mjs'] }, repoRoot: root })
  assert.equal(review.review.status, 'PASS')
  assert.equal(review.review.blocking, false)
  await fs.rm(root, { recursive: true, force: true })
})

test('security hard block: CRITICAL finding => blocking true', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-sec-hard-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'config.mjs'), 'export const api_key = "sk-fixture-test-only-0123456789abcdef"\n', 'utf8')
  const review = reviewSecurity({ run_id: 'sec-hard-run', buildResult: { status: 'SUCCESS', changed_files: ['src/config.mjs'] }, repoRoot: root })
  assert.equal(review.review.status, 'FAIL')
  assert.equal(review.review.blocking, true)
  assert.equal(review.review.recommendation, 'BLOCK')
  await fs.rm(root, { recursive: true, force: true })
})

test('integration: FIX from non-blocking security finding reports FIRST_BAD_BOUNDARY REVIEWS (not CONTROLLER)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-sec-boundary-run-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'eval-calc.mjs'), 'export function evaluate(expression) { return Number(expression) }\n', 'utf8')
  const result = await runTask({
    taskInput: { task: 'Add a calculator src/eval-calc.mjs that evaluates an expression. Keep syntax valid.', repository: root },
    repoRoot: root,
    nativePlan: { planText: PLAN_TEXT },
    buildExecutor: async (buildInput) => {
      await fs.writeFile(path.join(root, 'src', 'eval-calc.mjs'), 'export function evaluate(expression) { return eval(expression) }\n', 'utf8')
      return { changed_files: ['src/eval-calc.mjs'], errors: [], strategy_delta: null }
    },
    verifyChecks: [{ command: process.execPath, args: ['--check', 'src/eval-calc.mjs'], cwd: root }],
  })
  assert.equal(result.decision.decision, 'FIX')
  assert.equal(result.decision.reason_code, 'NON_BLOCKING_REVIEW_FINDINGS')
  assert.equal(result.decision.first_bad_boundary, 'REVIEWS')
  const security = result.reviews.find((r) => r.review_type === 'security')
  assert.equal(security.review.blocking, false)
  await fs.rm(root, { recursive: true, force: true })
})

test('integration: plan build_scope files inform required capability write (fail-early calibration)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-plan-cap-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'calc.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
  const result = await runTask({
    taskInput: { task: 'Fix the bug in src/calc.mjs so that add(2, 3) returns 5.', repository: root },
    repoRoot: root,
    nativePlan: { planText: `# Plan
## Targets
- src/calc.mjs — fix add
## Acceptance Criteria
- add(2, 3) returns 5
## Required Tests
- node --check src/calc.mjs
## Risks
- none
## Build Scope
- files: src/calc.mjs
` },
    buildExecutor: async (buildInput) => {
      await fs.writeFile(path.join(root, 'src', 'calc.mjs'), 'export function add(a, b) { return a + b }\n', 'utf8')
      return { changed_files: ['src/calc.mjs'], errors: [], strategy_delta: null }
    },
    verifyChecks: [{ command: process.execPath, args: ['--check', 'src/calc.mjs'], cwd: root }],
  })
  const required = result.baseline.required_capability_list || []
  assert.ok(required.includes('write'), `expected write derived from plan build_scope, got ${JSON.stringify(required)}`)
  assert.equal(result.decision.decision, 'DONE')
  await fs.rm(root, { recursive: true, force: true })
})
