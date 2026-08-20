// SPDX-License-Identifier: MIT
/**
 * Routing failure classification tests.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROUTING_FAILURE_CLASSES,
  classifyWorkerOutcome,
  redactFailureReason,
  isRoutingFailureClass,
} from '../../runtime/routing/failure-classifier.mjs'

describe('routing failure classification', () => {
  it('defines the required classes only (no taxonomy explosion)', () => {
    for (const cls of [
      'MODEL_UNAVAILABLE', 'MODEL_CAPABILITY_INSUFFICIENT', 'MODEL_CONTEXT_LIMIT',
      'MODEL_OUTPUT_INVALID', 'MODEL_QUALITY_GATE_REJECTED', 'PROVIDER_UNAVAILABLE',
      'PROVIDER_RATE_LIMITED', 'PROVIDER_AUTH_FAILURE', 'PROVIDER_TRANSPORT_FAILURE',
      'ROUTING_POLICY_DENIED', 'ROUTING_BUDGET_EXHAUSTED',
    ]) {
      assert.ok(ROUTING_FAILURE_CLASSES.includes(cls), cls)
    }
    assert.ok(
      ROUTING_FAILURE_CLASSES.length <= 13,
      'bounded taxonomy: 11 original classes + 2 policy-level availability/cost classes (NO_HEALTHY_ELIGIBLE_MODEL, COST_GATE_DENIED)',
    )
  })

  it('classifies auth, rate-limit, context, model, provider failures', () => {
    assert.equal(classifyWorkerOutcome({ http_status: 401 }), 'PROVIDER_AUTH_FAILURE')
    assert.equal(classifyWorkerOutcome({ http_status: 403 }), 'PROVIDER_AUTH_FAILURE')
    assert.equal(classifyWorkerOutcome({ http_status: 429 }), 'PROVIDER_RATE_LIMITED')
    assert.equal(classifyWorkerOutcome({ http_status: 404 }), 'MODEL_UNAVAILABLE')
    assert.equal(classifyWorkerOutcome({ http_status: 503 }), 'PROVIDER_UNAVAILABLE')
    assert.equal(classifyWorkerOutcome({ error: 'maximum context length exceeded' }), 'MODEL_CONTEXT_LIMIT')
    assert.equal(classifyWorkerOutcome({ error: 'model does not exist' }), 'MODEL_UNAVAILABLE')
    assert.equal(classifyWorkerOutcome({ error: 'invalid api key' }), 'PROVIDER_AUTH_FAILURE')
    assert.equal(classifyWorkerOutcome({ error: 'ECONNREFUSED' }), 'PROVIDER_TRANSPORT_FAILURE')
    assert.equal(classifyWorkerOutcome({ error: 'rate limit exceeded' }), 'PROVIDER_RATE_LIMITED')
  })

  it('success and unknown shapes fail closed', () => {
    assert.equal(classifyWorkerOutcome({ status: 'SUCCESS' }), null)
    assert.equal(classifyWorkerOutcome({}), 'MODEL_OUTPUT_INVALID')
    assert.equal(classifyWorkerOutcome({ error: 'weird thing happened' }), 'MODEL_OUTPUT_INVALID')
    assert.equal(classifyWorkerOutcome({ timedOut: true }), 'MODEL_UNAVAILABLE')
  })

  it('explicit failure_class is honored and validated', () => {
    assert.equal(classifyWorkerOutcome({ failure_class: 'MODEL_QUALITY_GATE_REJECTED' }), 'MODEL_QUALITY_GATE_REJECTED')
    assert.equal(classifyWorkerOutcome({ failure_class: 'FAKE_CLASS' }), 'MODEL_OUTPUT_INVALID')
  })

  it('isRoutingFailureClass guards membership', () => {
    assert.equal(isRoutingFailureClass('MODEL_UNAVAILABLE'), true)
    assert.equal(isRoutingFailureClass('DONE'), false)
  })

  it('redactFailureReason strips secret shapes', () => {
    const reason = 'request failed with Authorization: Bearer sk-abcdefgh1234567890 and api_key=abcdefgh123456789012345678901234567890'
    const redacted = redactFailureReason(reason)
    assert.ok(!redacted.includes('sk-abcdefgh1234567890'))
    assert.ok(!redacted.includes('abcdefgh123456789012345678901234567890'))
    assert.ok(redacted.includes('[REDACTED]'))
  })
})
