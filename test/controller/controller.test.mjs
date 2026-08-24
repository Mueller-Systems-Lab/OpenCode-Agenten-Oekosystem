import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decide } from '../../runtime/controller/controller.mjs'
import { evaluatePlanGate } from '../../runtime/controller/plan-gate.mjs'
import { createPlan, createVerification, createReview, createBaseline } from '../../runtime/contracts/index.mjs'

const RUN_ID = 'controller-test-run'

function fullPlan(overrides = {}) {
  return createPlan({
    run_id: RUN_ID,
    plan: {
      targets: [{ path: 'src/helper.mjs', description: 'helper' }],
      acceptance_criteria: ['helper returns expected value'],
      required_tests: ['node --test test/helper.test.mjs'],
      risks: [],
      build_scope: { files: ['src/helper.mjs', 'test/helper.test.mjs'] },
      ...overrides,
    },
  })
}

const baselineOk = () => createBaseline({ run_id: RUN_ID, required_capabilities: { filesystem: 'PASS' }, required_mcp: {}, required_skills: [], runtime: { status: 'PASS' }, approved: true, errors: [] })
const passVerify = () => createVerification({ run_id: RUN_ID, verification: { passed: true } })
const passReviews = () => [
  createReview({ run_id: RUN_ID, review_type: 'correctness', review: { status: 'PASS', severity: 'INFO', blocking: false, recommendation: 'PASS', findings: [] } }),
  createReview({ run_id: RUN_ID, review_type: 'security', review: { status: 'PASS', severity: 'INFO', blocking: false, recommendation: 'PASS', findings: [] } }),
  createReview({ run_id: RUN_ID, review_type: 'quality', review: { status: 'PASS', severity: 'INFO', blocking: false, recommendation: 'PASS', findings: [] } }),
]

const GREEN_BOUNDARIES = [
  { name: 'TASK', status: 'PASS' }, { name: 'BASELINE', status: 'PASS' },
  { name: 'RESEARCH', status: 'PASS' }, { name: 'PLAN', status: 'PASS' },
  { name: 'PLAN_GATE', status: 'PASS' }, { name: 'BUILD', status: 'PASS' },
  { name: 'VERIFY', status: 'PASS' }, { name: 'REVIEWS', status: 'PASS' },
]

describe('deterministic controller — mandatory cases', () => {
  it('plan vollständig → approved (plan gate)', () => {
    const gate = evaluatePlanGate(fullPlan())
    assert.equal(gate.approved, true)
    assert.deepEqual(gate.errors, [])
  })

  it('acceptance criteria fehlen → BLOCKED', () => {
    const rawPlan = {
      targets: [{ path: 'src/helper.mjs', description: 'helper' }],
      acceptance_criteria: [],
      required_tests: ['node --test test/helper.test.mjs'],
      risks: [],
      build_scope: { files: ['src/helper.mjs'] },
    }
    const gate = evaluatePlanGate(rawPlan)
    assert.deepEqual(gate.errors, ['ACCEPTANCE_CRITERIA_MISSING'])
    const decision = decide({ baseline: baselineOk(), planGate: gate, verification: passVerify(), reviews: passReviews() })
    assert.equal(decision.decision, 'BLOCKED')
    assert.equal(decision.reason_code, 'ACCEPTANCE_CRITERIA_MISSING')
    assert.equal(decision.next_path, 'HUMAN_OR_POLICY_INTERVENTION')
  })

  it('build scope fehlt → BLOCKED', () => {
    const rawPlan = {
      targets: [{ path: 'src/helper.mjs', description: 'helper' }],
      acceptance_criteria: ['helper returns expected value'],
      required_tests: ['node --test test/helper.test.mjs'],
      risks: [],
      build_scope: null,
    }
    const gate = evaluatePlanGate(rawPlan)
    assert.deepEqual(gate.errors, ['BUILD_SCOPE_MISSING'])
    const decision = decide({ baseline: baselineOk(), planGate: gate, verification: passVerify(), reviews: passReviews() })
    assert.equal(decision.decision, 'BLOCKED')
    assert.equal(decision.reason_code, 'BUILD_SCOPE_MISSING')
  })

  it('verify PASS → reviews evaluated', () => {
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: passVerify(), reviews: passReviews(), boundaries: GREEN_BOUNDARIES })
    assert.equal(decision.decision, 'DONE')
    assert.equal(decision.reason_code, 'ALL_HARD_GATES_GREEN')
    // Verification passed but reviews never performed → no self-certification.
    const noReviews = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: passVerify(), reviews: [] })
    assert.equal(noReviews.decision, 'BLOCKED')
    assert.equal(noReviews.reason_code, 'REVIEWS_NOT_PERFORMED')
  })

  it('verify FAIL + signature + strategy delta → RETRY', () => {
    const failVerify = createVerification({
      run_id: RUN_ID,
      verification: {
        passed: false,
        failure_signature: 'TEST_FAILURE:add_returns_sum',
        strategy_delta: 'Replace direct arithmetic with a schema-aware implementation because the input contains optional chaining.',
      },
    })
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: failVerify, reviews: [], attempt: 0, max_attempts: 2 })
    assert.equal(decision.decision, 'RETRY')
    assert.equal(decision.reason_code, 'RETRY_ALLOWED_WITH_STRATEGY_DELTA')
    assert.equal(decision.next_path, 'REBUILD')
  })

  it('verify FAIL ohne failure signature → SPLIT', () => {
    const failVerify = createVerification({ run_id: RUN_ID, verification: { passed: false, failure_signature: null, strategy_delta: 'do something different' } })
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: failVerify, reviews: [], attempt: 0, max_attempts: 2 })
    assert.equal(decision.decision, 'SPLIT')
    assert.equal(decision.reason_code, 'RETRY_DENIED_NO_FAILURE_SIGNATURE')
  })

  it('verify FAIL ohne strategy delta → SPLIT', () => {
    const failVerify = createVerification({ run_id: RUN_ID, verification: { passed: false, failure_signature: 'TEST_FAILURE:x', strategy_delta: null } })
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: failVerify, reviews: [], attempt: 0, max_attempts: 2 })
    assert.equal(decision.decision, 'SPLIT')
    assert.equal(decision.reason_code, 'RETRY_DENIED_NO_STRATEGY_DELTA')
  })

  it('attempt limit erreicht → SPLIT', () => {
    const failVerify = createVerification({ run_id: RUN_ID, verification: { passed: false, failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use a parser' } })
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: failVerify, reviews: [], attempt: 2, max_attempts: 2 })
    assert.equal(decision.decision, 'SPLIT')
    assert.equal(decision.reason_code, 'RETRY_DENIED_ATTEMPT_LIMIT')
  })

  it('identischer Fehler + identische Strategie erneut → SPLIT', () => {
    const failVerify = createVerification({ run_id: RUN_ID, verification: { passed: false, failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use a parser' } })
    const previous = [{ failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use a parser' }]
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: failVerify, reviews: [], attempt: 0, max_attempts: 2, previous_failures: previous })
    assert.equal(decision.decision, 'SPLIT')
    assert.equal(decision.reason_code, 'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE')
  })

  it('security HIGH blocking → BLOCKED', () => {
    const reviews = [
      ...passReviews().filter((review) => review.review_type !== 'security'),
      createReview({ run_id: RUN_ID, review_type: 'security', review: { status: 'FAIL', severity: 'HIGH', blocking: true, recommendation: 'BLOCK', findings: [{ severity: 'HIGH', message: 'secret in source' }] } }),
    ]
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: passVerify(), reviews })
    assert.equal(decision.decision, 'BLOCKED')
    assert.equal(decision.reason_code, 'BLOCKING_HIGH_OR_CRITICAL_FINDING')
    assert.equal(decision.next_path, 'HUMAN_OR_POLICY_INTERVENTION')
  })

  it('security CRITICAL blocking → BLOCKED (not 2-of-3 vote)', () => {
    const reviews = [
      createReview({ run_id: RUN_ID, review_type: 'correctness', review: { status: 'PASS', severity: 'INFO', blocking: false, recommendation: 'PASS', findings: [] } }),
      createReview({ run_id: RUN_ID, review_type: 'security', review: { status: 'FAIL', severity: 'CRITICAL', blocking: true, recommendation: 'BLOCK', findings: [{ severity: 'CRITICAL', message: 'private key' }] } }),
      createReview({ run_id: RUN_ID, review_type: 'quality', review: { status: 'PASS', severity: 'INFO', blocking: false, recommendation: 'PASS', findings: [] } }),
    ]
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: passVerify(), reviews })
    assert.equal(decision.decision, 'BLOCKED')
    assert.equal(decision.reason_code, 'BLOCKING_HIGH_OR_CRITICAL_FINDING')
  })

  it('quality non-blocking finding → FIX', () => {
    const reviews = [
      createReview({ run_id: RUN_ID, review_type: 'correctness', review: { status: 'PASS', severity: 'INFO', blocking: false, recommendation: 'PASS', findings: [] } }),
      createReview({ run_id: RUN_ID, review_type: 'security', review: { status: 'PASS', severity: 'INFO', blocking: false, recommendation: 'PASS', findings: [] } }),
      createReview({ run_id: RUN_ID, review_type: 'quality', review: { status: 'FAIL', severity: 'LOW', blocking: false, recommendation: 'FIX', findings: [{ severity: 'LOW', message: 'TODO present' }] } }),
    ]
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: passVerify(), reviews })
    assert.equal(decision.decision, 'FIX')
    assert.equal(decision.reason_code, 'NON_BLOCKING_REVIEW_FINDINGS')
    assert.equal(decision.next_path, 'TARGETED_FIX')
  })

  it('review recommendation SPLIT → SPLIT', () => {
    const reviews = [
      ...passReviews().filter((review) => review.review_type !== 'correctness'),
      createReview({ run_id: RUN_ID, review_type: 'correctness', review: { status: 'FAIL', severity: 'MEDIUM', blocking: false, recommendation: 'SPLIT', findings: [{ severity: 'MEDIUM', message: 'two independent root causes' }] } }),
    ]
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: passVerify(), reviews })
    assert.equal(decision.decision, 'SPLIT')
    assert.equal(decision.reason_code, 'REVIEW_REQUESTED_SPLIT')
    assert.equal(decision.next_path, 'DECOMPOSE_INTO_SUBTASKS')
  })

  it('alles grün → DONE', () => {
    const decision = decide({ baseline: baselineOk(), planGate: evaluatePlanGate(fullPlan()), verification: passVerify(), reviews: passReviews(), boundaries: GREEN_BOUNDARIES })
    assert.equal(decision.decision, 'DONE')
    assert.equal(decision.reason_code, 'ALL_HARD_GATES_GREEN')
    assert.equal(decision.next_path, 'FINALIZE')
    assert.equal(decision.first_bad_boundary, null)
  })

  it('baseline missing required capability → BLOCKED', () => {
    const blockedBaseline = createBaseline({ run_id: RUN_ID, required_capabilities: { git: 'MISSING' }, required_mcp: {}, required_skills: [], runtime: { status: 'PASS' }, approved: false, errors: ['required capability git: MISSING'] })
    const decision = decide({ baseline: blockedBaseline, planGate: evaluatePlanGate(fullPlan()), verification: passVerify(), reviews: passReviews() })
    assert.equal(decision.decision, 'BLOCKED')
    assert.equal(decision.reason_code, 'BLOCKED_MISSING_REQUIRED_CAPABILITY')
    assert.equal(decision.first_bad_boundary, 'BASELINE')
  })
})
