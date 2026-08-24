// SPDX-License-Identifier: MIT
/**
 * Health/usage security tests (Pflicht-Negativtests O–P + §59-63, 92-93).
 *
 * Worker output and tool/MCP results are DATA, never health authority.
 * Health is written ONLY by runtime probe/evidence. Events carry identifiers,
 * classes and numbers — never secrets or text content.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  HealthStore,
  selectRoute,
  decideRouteAction,
  healthProbeStartEvent,
  healthProbeResultEvent,
  usageEvent,
  statusFromProbeFailure,
  parseRetryAfter,
  parseUsage,
  DEFAULT_ROUTING_POLICY,
} from '../../runtime/routing/index.mjs'

const ESCALATION_CATALOG = [
  {
    provider: 'deepseek', model: 'deepseek-chat', enabled: true, availability: 'reachable',
    tool_support: true, mcp_support: false, structured_output: 'NONE',
    cost_tier: 'LOW', quality_tier: 'LOW', context_tier: 'MEDIUM', capabilities: [],
  },
  {
    provider: 'deepseek', model: 'deepseek-v4-pro', enabled: true, availability: 'reachable',
    tool_support: true, mcp_support: false, structured_output: 'NONE',
    cost_tier: 'HIGH', quality_tier: 'HIGH', context_tier: 'HIGH', capabilities: [],
  },
]

describe('health security boundaries', () => {
  it('O: worker output cannot manipulate canonical health', () => {
    const store = new HealthStore()
    const workerClaim = { provider: 'x', model: 'y', health: 'HEALTHY', status: 'HEALTHY' }
    // The store exposes no method that accepts the claim — it stays UNKNOWN.
    assert.equal(store.get('x', 'y').status, 'UNKNOWN')
    assert.equal(typeof store.applyWorkerStatus, 'undefined', 'worker write path must not exist')
    assert.throws(
      () => store.applyProbeResult({ provider: 'x', model: 'y', status: 'HEALTHY', source: 'WORKER' }),
      /HEALTH_INVALID/,
    )
  })

  it('P: tool/MCP result claiming provider health is data, not authority', () => {
    const store = new HealthStore()
    const toolResult = { provider: 'x', model: 'y', health: 'HEALTHY', switch_provider: true }
    const catalog = [
      {
        provider: 'x', model: 'y', enabled: true, availability: 'reachable',
        tool_support: false, mcp_support: false, structured_output: 'NONE',
        cost_tier: 'LOW', quality_tier: 'LOW', context_tier: 'LOW', capabilities: [],
      },
    ]
    // selectRoute reads ONLY the health map — the tool result is never consulted.
    const decision = selectRoute({
      requirements: {},
      catalog,
      policy: { ...DEFAULT_ROUTING_POLICY, allowed_providers: ['x'] },
      health: {},
    })
    assert.equal(decision.ok, false)
    assert.equal(decision.code, 'NO_HEALTHY_ELIGIBLE_MODEL')
    assert.equal(store.get('x', 'y').status, 'UNKNOWN', 'store must remain UNKNOWN after a tool claim')
    // The tool result shape cannot even be applied as probe evidence.
    assert.throws(
      () => store.applyProbeResult({ provider: 'x', model: 'y', ...toolResult }),
      /HEALTH_INVALID/,
    )
  })

  it('probe events redacted (no secrets in probe event fields)', () => {
    const start = healthProbeStartEvent({ run_id: 'r', provider: 'x', model: 'y' })
    assert.equal(start.job, 'model.health.probe.start')
    const resultEvent = healthProbeResultEvent({
      run_id: 'r', provider: 'x', model: 'y',
      ok: false, health_status: 'AUTH_FAILED', failure_class: 'PROVIDER_AUTH_FAILURE',
      latency_ms: 12, retry_after: 30, attempt: 0, phase: 'ROUTING',
    })
    assert.equal(resultEvent.failure_signature, 'PROBE:PROVIDER_AUTH_FAILURE', 'failure_signature must contain only the class')
    const serialized = JSON.stringify(resultEvent)
    assert.ok(!/bearer|authorization|sk-[a-z0-9]/i.test(serialized), 'probe event must not leak auth header shapes')
    assert.equal(resultEvent.latency_ms, 12)
    assert.equal(resultEvent.retry_after, 30)
  })

  it('usage event has no secret text', () => {
    const parsed = parseUsage({
      type: 'step_finish', tokens: { total: 10, input: 5, output: 5, reasoning: 0, cache: { read: 2, write: 0 } }, cost: 0.001,
    }, { run_id: 'r', phase: 'BUILD', attempt: 0, route_index: 0, provider: 'deepseek', model: 'm' })
    const event = usageEvent({ run_id: 'r', usage: parsed.usage, phase: 'BUILD', attempt: 0 })
    assert.equal(event.job, 'model.usage')
    assert.equal(event.usage_status, 'AVAILABLE')
    assert.equal(event.usage_input_tokens, 5)
    assert.equal(event.usage_output_tokens, 5)
    assert.equal(event.usage_total_tokens, 10)
    assert.equal(event.provider_reported_cost, 0.001)
    for (const key of ['prompt', 'output', 'text', 'content', 'message']) {
      assert.ok(!(key in event) && !JSON.stringify(event).includes(`"${key}"`), `usage event must not carry ${key} text`)
    }
  })

  it('probe provider model never leaks full output (helper contract)', () => {
    // Real spawn is out of scope; the probe helper contract is: an invalid
    // probe result is NEVER promoted to unavailability, and retry-after is
    // never invented.
    assert.equal(statusFromProbeFailure('MODEL_OUTPUT_INVALID'), 'UNKNOWN', 'no false unavailability claim')
    assert.equal(statusFromProbeFailure('PROVIDER_TRANSPORT_FAILURE'), 'UNAVAILABLE')
    assert.equal(parseRetryAfter('no retry header present'), null)
  })

  it('cost abuse bounded: repeated escalation attempts denied after gate', () => {
    const route = { provider: 'deepseek', model: 'deepseek-chat', cost_tier: 'LOW' }
    for (let i = 0; i < 3; i += 1) {
      const decision = decideRouteAction({
        failure_class: 'MODEL_CAPABILITY_INSUFFICIENT',
        route,
        catalog: ESCALATION_CATALOG,
        policy: DEFAULT_ROUTING_POLICY,
        escalation_count: 0,
        provider_fallback_count: 0,
        cost_policy: { allow_cost_escalation: false },
        high_cost_routes_used: 0,
      })
      assert.equal(decision.action, 'TERMINAL', `attempt ${i + 1} must be terminal`)
      assert.equal(decision.reason_code, 'COST_GATE_DENIED', `attempt ${i + 1} must be cost-gated`)
      assert.ok(!decision.next_route, 'no HIGH route may be emitted')
    }
  })

  it('health store TTL prevents permanent blacklist', () => {
    let now = 5000000
    const store = new HealthStore({ clock: () => now })
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'UNAVAILABLE', ttl_seconds: 30 })
    assert.equal(store.get('deepseek', 'm').status, 'UNAVAILABLE')
    now += 31 * 1000
    assert.equal(store.get('deepseek', 'm').status, 'UNKNOWN', 'UNAVAILABLE must expire')
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'HEALTHY', ttl_seconds: 300 })
    assert.equal(store.get('deepseek', 'm').status, 'HEALTHY', 'recovery only via a new valid probe (§107)')
  })
})
