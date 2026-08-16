import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTask, validateTask,
  createBaseline, validateBaseline,
  createResearch, validateResearch,
  createPlan, validatePlan,
  createBuildInput, validateBuildInput,
  createBuildResult, validateBuildResult,
  createVerification, validateVerification,
  createReview, validateReview,
  createDecision, validateDecision,
  createRunEventContract, validateRunEventContract,
  validateContract, CONTRACT_IDS,
} from '../../runtime/contracts/index.mjs'

const RUN_ID = 'test-run-id-123'

describe('runtime pipeline contract layer', () => {
  it('task contract: valid create + validate', () => {
    const task = createTask({ run_id: RUN_ID, task: 'implement helper', repository: '/repo' })
    assert.equal(task.contract, CONTRACT_IDS.task)
    assert.equal(task.run_id, RUN_ID)
    assert.equal(task.max_attempts, 2)
    assert.deepEqual(validateTask(task), { ok: true, issues: [] })
  })

  it('task contract: rejects missing run_id and task', () => {
    const missingRun = { contract: CONTRACT_IDS.task, run_id: '', task: 'x', attempt: 0, max_attempts: 2, created_at: new Date().toISOString() }
    assert.equal(validateTask(missingRun).ok, false)
    const missingTask = { contract: CONTRACT_IDS.task, run_id: 'r', task: '', attempt: 0, max_attempts: 2, created_at: new Date().toISOString() }
    assert.equal(validateTask(missingTask).ok, false)
    assert.ok(validateTask(missingTask).issues.some((issue) => issue.includes('task')))
  })

  it('task contract: rejects negative attempt and invalid max_attempts', () => {
    const base = { contract: CONTRACT_IDS.task, run_id: 'r', task: 'x', created_at: new Date().toISOString() }
    assert.equal(validateTask({ ...base, attempt: -1, max_attempts: 2 }).ok, false)
    assert.equal(validateTask({ ...base, attempt: 0, max_attempts: 0 }).ok, false)
  })

  it('baseline contract: valid preflight output', () => {
    const baseline = createBaseline({
      run_id: RUN_ID,
      required_capabilities: { filesystem: 'PASS', git: 'PASS' },
      required_mcp: { github: 'PASS' },
      required_skills: [],
      runtime: { status: 'PASS' },
      approved: true,
      errors: [],
    })
    assert.equal(baseline.contract, CONTRACT_IDS.baseline)
    assert.equal(validateBaseline(baseline).ok, true)
  })

  it('baseline contract: credential status AVAILABLE/MISSING/DENIED allowed', () => {
    const baseline = createBaseline({
      run_id: RUN_ID,
      required_capabilities: { credentials: 'MISSING' },
      approved: false,
      errors: [],
    })
    assert.equal(validateBaseline(baseline).ok, true)
    assert.equal(validateBaseline({ ...baseline, required_capabilities: { credentials: 'SECRET_VALUE' } }).ok, false)
  })

  it('research contract: defaults to the three perspectives', () => {
    const research = createResearch({ run_id: RUN_ID })
    assert.equal(research.contract, CONTRACT_IDS.research)
    assert.deepEqual(research.research.map((entry) => entry.focus), ['code', 'docs', 'tests'])
    assert.equal(validateResearch(research).ok, true)
  })

  it('research contract: rejects empty research and unknown focus', () => {
    assert.equal(validateResearch({ contract: CONTRACT_IDS.research, run_id: 'r', research: [] }).ok, false)
    assert.equal(validateResearch({ contract: CONTRACT_IDS.research, run_id: 'r', research: [{ focus: 'unknown', findings: [] }] }).ok, false)
  })

  it('plan contract: valid structure', () => {
    const plan = createPlan({
      run_id: RUN_ID,
      plan: {
        targets: [{ path: 'src/a.mjs', description: 'a' }],
        acceptance_criteria: ['a works'],
        required_tests: ['node --test test/a.test.mjs'],
        risks: [],
        build_scope: { files: ['src/a.mjs'] },
      },
    })
    assert.equal(plan.contract, CONTRACT_IDS.plan)
    assert.equal(validatePlan(plan).ok, true)
  })

  it('plan contract: rejects missing arrays and build_scope', () => {
    const base = { contract: CONTRACT_IDS.plan, run_id: 'r' }
    assert.equal(validatePlan({ ...base, plan: { targets: [], acceptance_criteria: [], required_tests: [], risks: [], build_scope: {} } }).ok, true)
    assert.equal(validatePlan({ ...base, plan: { targets: [], acceptance_criteria: [], required_tests: 'nope', risks: [], build_scope: {} } }).ok, false)
    assert.equal(validatePlan({ ...base, plan: { targets: [], acceptance_criteria: [], required_tests: [], risks: [], build_scope: null } }).ok, false)
  })

  it('build-input contract: requires the four approved inputs', () => {
    const input = createBuildInput({
      run_id: RUN_ID,
      approved_plan: { plan: {} },
      approved_build_scope: { files: [] },
      research: { research: [] },
      task: { run_id: RUN_ID, task: 'x' },
    })
    assert.equal(input.contract, CONTRACT_IDS.build_input)
    assert.equal(validateBuildInput(input).ok, true)
    assert.equal(validateBuildInput({ contract: CONTRACT_IDS.build_input, run_id: 'r', attempt: 0 }).ok, false)
  })

  it('build-result contract: statuses and arrays', () => {
    const success = createBuildResult({ run_id: RUN_ID, status: 'SUCCESS', changed_files: ['a.mjs'] })
    assert.equal(success.contract, CONTRACT_IDS.build_result)
    assert.equal(validateBuildResult(success).ok, true)
    assert.equal(validateBuildResult({ ...success, status: 'MAYBE' }).ok, false)
    assert.equal(validateBuildResult({ ...success, changed_files: 'a.mjs' }).ok, false)
  })

  it('verification contract: failure signature + strategy delta fields', () => {
    const verification = createVerification({
      run_id: RUN_ID,
      verification: { passed: false, failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use schema-aware parser' },
    })
    assert.equal(verification.contract, CONTRACT_IDS.verification)
    assert.equal(validateVerification(verification).ok, true)
    assert.equal(validateVerification({ contract: CONTRACT_IDS.verification, run_id: 'r', verification: { passed: 'yes' } }).ok, false)
  })

  it('review contract: severity and recommendation enums', () => {
    const review = createReview({ run_id: RUN_ID, review_type: 'security', review: { status: 'FAIL', severity: 'HIGH', blocking: true, recommendation: 'BLOCK', findings: [{ severity: 'HIGH', message: 'x' }] } })
    assert.equal(review.contract, CONTRACT_IDS.review)
    assert.equal(validateReview(review).ok, true)
    assert.equal(validateReview({ ...review, review_type: 'unknown' }).ok, false)
    assert.equal(validateReview({ ...review, review: { ...review.review, severity: 'MAYBE' } }).ok, false)
  })

  it('decision contract: terminal states and next_path', () => {
    const decision = createDecision({ run_id: RUN_ID, decision: 'DONE', reason_code: 'ALL_HARD_GATES_GREEN' })
    assert.equal(decision.contract, CONTRACT_IDS.decision)
    assert.equal(decision.next_path, 'FINALIZE')
    assert.equal(validateDecision(decision).ok, true)
    assert.equal(validateDecision({ ...decision, decision: 'DONE', next_path: 'WRONG' }).ok, false)
    assert.equal(validateDecision({ ...decision, decision: 'MAYBE' }).ok, false)
  })

  it('decision contract: all four terminal states map to canonical next_path', () => {
    assert.equal(createDecision({ run_id: 'r', decision: 'DONE', reason_code: 'x' }).next_path, 'FINALIZE')
    assert.equal(createDecision({ run_id: 'r', decision: 'FIX', reason_code: 'x' }).next_path, 'TARGETED_FIX')
    assert.equal(createDecision({ run_id: 'r', decision: 'SPLIT', reason_code: 'x' }).next_path, 'DECOMPOSE_INTO_SUBTASKS')
    assert.equal(createDecision({ run_id: 'r', decision: 'BLOCKED', reason_code: 'x' }).next_path, 'HUMAN_OR_POLICY_INTERVENTION')
  })

  it('run-event contract: minimum event fields', () => {
    const event = createRunEventContract({ run_id: RUN_ID, phase: 'VERIFY', job: 'verify', attempt: 1, status: 'FAIL', duration_ms: 5 })
    assert.equal(event.contract, CONTRACT_IDS.run_event)
    assert.equal(event.run_id, RUN_ID)
    assert.equal(validateRunEventContract(event).ok, true)
    assert.equal(validateRunEventContract({ ...event, phase: 'NOPE' }).ok, false)
    assert.equal(validateRunEventContract({ ...event, run_id: '' }).ok, false)
  })

  it('validateContract dispatches to the right validator and rejects unknown contracts', () => {
    const task = createTask({ run_id: RUN_ID, task: 'x', repository: '/r' })
    assert.equal(validateContract({ contract: CONTRACT_IDS.task, value: task }).ok, true)
    assert.equal(validateContract({ contract: 'ecosystem.unknown.v1', value: task }).ok, false)
    assert.equal(validateContract({ contract: CONTRACT_IDS.task, value: { contract: 'other' } }).ok, false)
  })

  it('run_id is created by the task and never regenerated by other contracts', () => {
    const runId = 'fixed-run-id'
    const task = createTask({ run_id: runId, task: 'x', repository: '/r' })
    const plan = createPlan({ run_id: task.run_id })
    const verification = createVerification({ run_id: task.run_id })
    const review = createReview({ run_id: task.run_id, review_type: 'correctness' })
    const decision = createDecision({ run_id: task.run_id, decision: 'DONE', reason_code: 'x' })
    const event = createRunEventContract({ run_id: task.run_id, phase: 'TASK', job: 'create-task', status: 'PASS' })
    for (const value of [plan, verification, review, decision, event]) assert.equal(value.run_id, runId)
  })
})
