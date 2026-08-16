import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateRetry, isMeaningfulStrategyDelta, isRepeat, RETRY_REASON_CODES, DEFAULT_MAX_ATTEMPTS,
} from '../../runtime/controller/retry-policy.mjs'
import { normalizeFailureSignature } from '../../runtime/controller/verify.mjs'

describe('deterministic retry policy', () => {
  it('default max_attempts is 2', () => {
    assert.equal(DEFAULT_MAX_ATTEMPTS, 2)
  })

  it('signature + delta + attempt under limit → RETRY_ALLOWED_WITH_STRATEGY_DELTA', () => {
    const result = evaluateRetry({
      failure_signature: 'TEST_FAILURE:user_creation',
      strategy_delta: 'Replace direct JSON parsing with schema-aware parser because input contains JSONC.',
      attempt: 0,
      max_attempts: 2,
    })
    assert.equal(result.allowed, true)
    assert.equal(result.decision, 'RETRY')
    assert.equal(result.reason_code, 'RETRY_ALLOWED_WITH_STRATEGY_DELTA')
  })

  it('missing failure signature → RETRY_DENIED_NO_FAILURE_SIGNATURE', () => {
    const result = evaluateRetry({ failure_signature: '', strategy_delta: 'use a parser', attempt: 0, max_attempts: 2 })
    assert.equal(result.allowed, false)
    assert.equal(result.reason_code, 'RETRY_DENIED_NO_FAILURE_SIGNATURE')
    assert.equal(result.decision, 'SPLIT')
  })

  it('missing strategy delta → RETRY_DENIED_NO_STRATEGY_DELTA', () => {
    const result = evaluateRetry({ failure_signature: 'TEST_FAILURE:x', strategy_delta: '', attempt: 0, max_attempts: 2 })
    assert.equal(result.allowed, false)
    assert.equal(result.reason_code, 'RETRY_DENIED_NO_STRATEGY_DELTA')
  })

  it('vague strategy deltas are invalid (try again / retry / attempt another fix)', () => {
    assert.equal(isMeaningfulStrategyDelta('try again'), false)
    assert.equal(isMeaningfulStrategyDelta('retry'), false)
    assert.equal(isMeaningfulStrategyDelta('attempt another fix'), false)
    assert.equal(isMeaningfulStrategyDelta('Replace direct JSON parsing with schema-aware parser.'), true)
    assert.equal(isMeaningfulStrategyDelta('x'), false)
  })

  it('attempt limit reached → RETRY_DENIED_ATTEMPT_LIMIT', () => {
    const result = evaluateRetry({ failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use a parser', attempt: 2, max_attempts: 2 })
    assert.equal(result.allowed, false)
    assert.equal(result.reason_code, 'RETRY_DENIED_ATTEMPT_LIMIT')
    const resultAtLimit = evaluateRetry({ failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use a parser', attempt: 1, max_attempts: 2 })
    assert.equal(resultAtLimit.allowed, true)
  })

  it('identical failure + identical strategy → RETRY_DENIED_REPEATED_IDENTICAL_FAILURE', () => {
    const previous = [{ failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use a schema-aware parser' }]
    const result = evaluateRetry({ failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use a schema-aware parser', attempt: 1, max_attempts: 2, previous_failures: previous })
    assert.equal(result.allowed, false)
    assert.equal(result.reason_code, 'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE')
  })

  it('same signature but a different strategy is still retryable', () => {
    const previous = [{ failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use a schema-aware parser' }]
    const result = evaluateRetry({ failure_signature: 'TEST_FAILURE:x', strategy_delta: 'switch to streaming API and retry idempotently', attempt: 1, max_attempts: 2, previous_failures: previous })
    assert.equal(result.allowed, true)
    assert.equal(result.reason_code, 'RETRY_ALLOWED_WITH_STRATEGY_DELTA')
  })

  it('isRepeat treats equivalent normalized text as equal', () => {
    assert.equal(isRepeat([{ failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use a parser' }], 'TEST_FAILURE:x', 'Use a parser!'), true)
    assert.equal(isRepeat([{ failure_signature: 'TEST_FAILURE:x', strategy_delta: 'use a parser' }], 'TEST_FAILURE:x', 'use a compiler'), false)
  })

  it('all five reason codes are defined', () => {
    assert.deepEqual(RETRY_REASON_CODES, [
      'RETRY_ALLOWED_WITH_STRATEGY_DELTA',
      'RETRY_DENIED_NO_FAILURE_SIGNATURE',
      'RETRY_DENIED_NO_STRATEGY_DELTA',
      'RETRY_DENIED_ATTEMPT_LIMIT',
      'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE',
    ])
  })

  describe('failure signature normalization', () => {
    it('extracts TEST_FAILURE from test runner output', () => {
      const signature = normalizeFailureSignature({ tool: 'node', exit_code: 1, stderr: '\nnot ok add_returns_sum\n', stdout: '' })
      assert.equal(signature, 'TEST_FAILURE:add_returns_sum')
    })

    it('extracts TYPE_ERROR with file:line', () => {
      const signature = normalizeFailureSignature({ tool: 'tsc', exit_code: 1, stderr: 'src/runtime/controller.ts:117:9 error', stdout: '' })
      assert.equal(signature, 'TYPE_ERROR:src/runtime/controller.ts:117')
    })

    it('extracts BUILD_FAILURE for missing export', () => {
      const signature = normalizeFailureSignature({ tool: 'node', exit_code: 1, stderr: "SyntaxError: Cannot use import statement outside a module: missing export 'helper'", stdout: '' })
      assert.match(signature, /^BUILD_FAILURE:missing_/)
    })

    it('falls back to tool exit code', () => {
      const signature = normalizeFailureSignature({ tool: 'eslint', exit_code: 2, stderr: '', stdout: '' })
      assert.equal(signature, 'ESLINT_EXIT:2')
    })
  })
})
