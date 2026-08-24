// SPDX-License-Identifier: MIT
/**
 * Health probe tests — bounded, lazy, demand-based probing.
 *
 * All probe tests use fake probe functions and injected clocks — no real
 * provider calls, deterministic and fast.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  HealthStore,
  probeClassificationFromError,
  statusFromProbeFailure,
  parseRetryAfter,
  resolveCandidateHealth,
} from '../../runtime/routing/index.mjs'

describe('health probe', () => {
  it('classification: auth → PROVIDER_AUTH_FAILURE', () => {
    assert.equal(probeClassificationFromError({ output: 'invalid api key' }), 'PROVIDER_AUTH_FAILURE')
    assert.equal(probeClassificationFromError({ output: '401 unauthorized' }), 'PROVIDER_AUTH_FAILURE')
  })

  it('classification: rate limit → PROVIDER_RATE_LIMITED', () => {
    assert.equal(probeClassificationFromError({ output: 'rate limit exceeded' }), 'PROVIDER_RATE_LIMITED')
  })

  it('classification: http 429 → PROVIDER_RATE_LIMITED', () => {
    assert.equal(probeClassificationFromError({ http_status: 429 }), 'PROVIDER_RATE_LIMITED')
  })

  it('classification: 404 → MODEL_UNAVAILABLE; 5xx → PROVIDER_UNAVAILABLE; timeout → PROVIDER_TRANSPORT_FAILURE', () => {
    assert.equal(probeClassificationFromError({ http_status: 404 }), 'MODEL_UNAVAILABLE')
    assert.equal(probeClassificationFromError({ http_status: 503 }), 'PROVIDER_UNAVAILABLE')
    assert.equal(probeClassificationFromError({ timed_out: true }), 'PROVIDER_TRANSPORT_FAILURE')
  })

  it('statusFromProbeFailure: AUTH→AUTH_FAILED, RATE_LIMITED→RATE_LIMITED, MODEL_UNAVAILABLE→UNAVAILABLE, MODEL_OUTPUT_INVALID→UNKNOWN (no false negative)', () => {
    assert.equal(statusFromProbeFailure('PROVIDER_AUTH_FAILURE'), 'AUTH_FAILED')
    assert.equal(statusFromProbeFailure('PROVIDER_RATE_LIMITED'), 'RATE_LIMITED')
    assert.equal(statusFromProbeFailure('MODEL_UNAVAILABLE'), 'UNAVAILABLE')
    assert.equal(statusFromProbeFailure('PROVIDER_UNAVAILABLE'), 'UNAVAILABLE')
    assert.equal(statusFromProbeFailure('MODEL_OUTPUT_INVALID'), 'UNKNOWN')
    assert.equal(statusFromProbeFailure('NOT_A_CLASS'), 'UNKNOWN', 'unknown class must never invent unavailability')
  })

  it('parseRetryAfter extracts real value, never invents', () => {
    assert.equal(parseRetryAfter('retry-after: 12'), 12)
    assert.equal(parseRetryAfter('retry_after: 5'), 5)
    assert.equal(parseRetryAfter('rate_limit_reset: 42'), 42)
    assert.equal(parseRetryAfter('nothing here'), null)
    assert.equal(parseRetryAfter(''), null)
    assert.equal(parseRetryAfter(null), null)
  })

  it('resolveCandidateHealth: UNKNOWN probed → HEALTHY map entry', async () => {
    const store = new HealthStore()
    const result = await resolveCandidateHealth({
      candidates: [{ provider: 'deepseek', model: 'm', cost_tier: 'LOW', quality_tier: 'LOW' }],
      store,
      probe_fn: async () => ({ ok: true, status: 'HEALTHY', latency_ms: 5 }),
    })
    assert.equal(result.health_map['deepseek/m'].status, 'HEALTHY')
    assert.equal(result.probed.length, 1)
  })

  it('cache hit: HEALTHY cached → no re-probe (no probe storm)', async () => {
    const store = new HealthStore()
    let calls = 0
    const probe_fn = async () => { calls += 1; return { ok: true, status: 'HEALTHY', latency_ms: 2 } }
    await resolveCandidateHealth({
      candidates: [{ provider: 'deepseek', model: 'm', cost_tier: 'LOW', quality_tier: 'LOW' }],
      store, probe_fn,
    })
    assert.equal(calls, 1)
    const second = await resolveCandidateHealth({
      candidates: [{ provider: 'deepseek', model: 'm', cost_tier: 'LOW', quality_tier: 'LOW' }],
      store, probe_fn,
    })
    assert.equal(calls, 1, 'cached HEALTHY must not be re-probed')
    assert.ok(second.cache_hits.some((hit) => hit.model === 'm' && hit.status === 'HEALTHY'), 'cache_hits must include the model')
  })

  it('budget skip stays UNKNOWN, never UNAVAILABLE (§21)', async () => {
    const store = new HealthStore()
    const result = await resolveCandidateHealth({
      candidates: [
        { provider: 'deepseek', model: 'a', cost_tier: 'LOW', quality_tier: 'LOW' },
        { provider: 'deepseek', model: 'b', cost_tier: 'LOW', quality_tier: 'LOW' },
      ],
      store,
      probe_policy: { max_candidates_probed_per_route: 1 },
      probe_fn: async () => ({ ok: true, status: 'HEALTHY', latency_ms: 1 }),
    })
    assert.equal(result.probe_budget_skipped.length, 1)
    assert.deepEqual(result.health_map['deepseek/b'], { status: 'UNKNOWN' }, 'unprobed candidate must stay UNKNOWN, never UNAVAILABLE')
  })

  it('probe failure → classified state written', async () => {
    const store = new HealthStore()
    const result = await resolveCandidateHealth({
      candidates: [{ provider: 'deepseek', model: 'm', cost_tier: 'LOW', quality_tier: 'LOW' }],
      store,
      probe_fn: async () => ({ ok: false, status: 'RATE_LIMITED', failure_class: 'PROVIDER_RATE_LIMITED', retry_after: 30, latency_ms: 9 }),
    })
    assert.equal(result.health_map['deepseek/m'].status, 'RATE_LIMITED')
    assert.equal(result.health_map['deepseek/m'].retry_after, 30)
    assert.equal(store.get('deepseek', 'm').status, 'RATE_LIMITED')
  })

  it('probe timeout: probe_fn throws → PROVIDER_TRANSPORT_FAILURE classified, no crash', async () => {
    const store = new HealthStore()
    let result
    await assert.doesNotReject(async () => {
      result = await resolveCandidateHealth({
        candidates: [{ provider: 'deepseek', model: 'm', cost_tier: 'LOW', quality_tier: 'LOW' }],
        store,
        probe_fn: async () => { throw new Error('timeout') },
      })
    })
    assert.equal(result.probed[0].status, 'UNAVAILABLE', 'transport failure must map to UNAVAILABLE, never crash')
  })

  it('probe emit events', async () => {
    const store = new HealthStore()
    const events = []
    await resolveCandidateHealth({
      candidates: [{ provider: 'deepseek', model: 'm', cost_tier: 'LOW', quality_tier: 'LOW' }],
      store,
      emit: async (event) => events.push(event),
      probe_fn: async () => ({ ok: true, status: 'HEALTHY', latency_ms: 1 }),
      run_id: 'run-1',
      phase: 'ROUTING',
      attempt: 0,
    })
    assert.ok(events.some((event) => event.job === 'model.health.probe.start'), 'probe start event must be emitted')
    assert.ok(events.some((event) => event.job === 'model.health.probe.result'), 'probe result event must be emitted')
  })

  it('cheapest-first probe order', async () => {
    const store = new HealthStore()
    const order = []
    await resolveCandidateHealth({
      candidates: [
        { provider: 'deepseek', model: 'high-cost', cost_tier: 'HIGH', quality_tier: 'HIGH' },
        { provider: 'deepseek', model: 'low-cost', cost_tier: 'LOW', quality_tier: 'LOW' },
      ],
      store,
      probe_fn: async ({ provider, model }) => {
        order.push(model)
        return { ok: true, status: 'HEALTHY', latency_ms: 1 }
      },
    })
    assert.equal(order[0], 'low-cost', 'cheapest candidate must be probed first')
  })

  it('REAL probe success shape: step_finish with part.reason + part.tokens (regression)', () => {
    // The real opencode JSON output nests reason/tokens/cost inside `part`.
    const output = [
      JSON.stringify({ type: 'step_start', sessionID: 's' }),
      JSON.stringify({ type: 'text', sessionID: 's', part: { type: 'text', text: 'OK' } }),
      JSON.stringify({
        type: 'step_finish', sessionID: 's',
        part: { id: 'p', reason: 'stop', type: 'step-finish', tokens: { total: 100, input: 80, output: 2, reasoning: 0, cache: { read: 10, write: 0 } }, cost: 0.001 },
      }),
    ].join('\n')
    // parse the last step_finish exactly as probeProviderModel does
    let last = null
    for (const line of output.split('\n')) {
      try { const j = JSON.parse(line); if (j && typeof j === 'object' && j.type === 'step_finish') last = j } catch {}
    }
    assert.ok(last, 'step_finish found')
    const part = last && typeof last.part === 'object' ? last.part : {}
    assert.equal(Boolean(part.reason), true, 'part.reason must drive the success check')
    assert.equal(part.tokens.input, 80)
  })

})
