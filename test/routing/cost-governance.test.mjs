// SPDX-License-Identifier: MIT
/**
 * Cost governance tests (Pflicht-Negativtests J–L + §41-49 semantics).
 *
 * The cost gate is a RUNTIME gate: worker self-escalation is impossible and
 * high-cost routes are only permitted when the policy explicitly allows them.
 *
 * Note on test J: against the implemented policy, the high-cost gate binds on
 * first selection via the consumed high-cost budget
 * (high_cost_routes_used >= max_high_cost_routes) — a prior HIGH route in the
 * same run already consumed the budget, so the additional HIGH invocation is
 * denied even though a HIGH candidate exists.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  selectRoute,
  decideRouteAction,
  costGateAllows,
  DEFAULT_ROUTING_POLICY,
} from '../../runtime/routing/index.mjs'

// Only the HIGH-cost model satisfies needs_mcp (the cheap LOW model cannot).
const HIGH_ONLY_MCP_CATALOG = [
  {
    provider: 'deepseek', model: 'cheap', enabled: true, availability: 'reachable',
    tool_support: true, mcp_support: false, structured_output: 'NONE',
    cost_tier: 'LOW', quality_tier: 'LOW', context_tier: 'LOW', capabilities: ['tools'],
  },
  {
    provider: 'deepseek', model: 'mcp-high', enabled: true, availability: 'reachable',
    tool_support: true, mcp_support: true, structured_output: 'NONE',
    cost_tier: 'HIGH', quality_tier: 'HIGH', context_tier: 'HIGH', capabilities: ['tools', 'mcp'],
  },
]

const MEDIUM_ONLY_CATALOG = [
  {
    provider: 'deepseek', model: 'm1', enabled: true, availability: 'reachable',
    tool_support: true, mcp_support: false, structured_output: 'NONE',
    cost_tier: 'MEDIUM', quality_tier: 'MEDIUM', context_tier: 'MEDIUM', capabilities: ['tools'],
  },
]

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
  {
    provider: 'openai', model: 'gpt-5.4-mini', enabled: true, availability: 'reachable',
    tool_support: true, mcp_support: false, structured_output: 'NONE',
    cost_tier: 'MEDIUM', quality_tier: 'MEDIUM', context_tier: 'HIGH', capabilities: [],
  },
]

describe('cost governance (selectRoute)', () => {
  it('J: LOW fails, HIGH candidate exists, policy denies HIGH → COST_GATE_DENIED, HIGH not called', () => {
    const result = selectRoute({
      requirements: { needs_mcp: true },
      catalog: HIGH_ONLY_MCP_CATALOG,
      cost_policy: { max_high_cost_routes: 1, allow_high_cost_escalation: false },
      high_cost_routes_used: 1,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'COST_GATE_DENIED')
    assert.ok(!result.route, 'denied route must never invoke the HIGH model')
  })

  it('K: HIGH allowed when policy permits + budget available', () => {
    const result = selectRoute({
      requirements: { needs_mcp: true },
      catalog: HIGH_ONLY_MCP_CATALOG,
      cost_policy: { allow_high_cost_escalation: true, allow_cost_escalation: true, max_high_cost_routes: 2 },
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'mcp-high')
    assert.equal(result.route.cost_tier, 'HIGH')
  })

  it('L: budget exhausted → no additional HIGH invocation', () => {
    const result = selectRoute({
      requirements: { needs_mcp: true },
      catalog: HIGH_ONLY_MCP_CATALOG,
      cost_policy: { max_high_cost_routes: 1 },
      high_cost_routes_used: 1,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'COST_GATE_DENIED')
  })

  it('phase cost ceiling: RESEARCH LOW blocks MEDIUM', () => {
    const policy = { phase_cost_ceilings: { RESEARCH: 'LOW', BUILD: 'MEDIUM' } }
    const research = selectRoute({
      phase: 'RESEARCH',
      requirements: { quality_requirement: 'MEDIUM' },
      catalog: MEDIUM_ONLY_CATALOG,
      cost_policy: policy,
    })
    assert.equal(research.ok, false)
    assert.equal(research.code, 'COST_GATE_DENIED', 'MEDIUM candidate must be phase-gated in RESEARCH')
    const build = selectRoute({
      phase: 'BUILD',
      requirements: { quality_requirement: 'MEDIUM' },
      catalog: MEDIUM_ONLY_CATALOG,
      cost_policy: policy,
    })
    assert.equal(build.ok, true)
    assert.equal(build.route.model, 'm1', 'BUILD ceiling MEDIUM must allow the MEDIUM candidate')
  })
})

describe('cost gate unit semantics (§41-49)', () => {
  it('costGateAllows: no policy → allowed (backward compat)', () => {
    assert.equal(costGateAllows({ entry: { cost_tier: 'HIGH' } }), true)
    assert.equal(costGateAllows({ entry: { cost_tier: 'HIGH' }, current_tier: 'LOW' }), true)
  })

  it('costGateAllows: tier increase denied without allow_cost_escalation', () => {
    assert.equal(costGateAllows({ entry: { cost_tier: 'MEDIUM' }, current_tier: 'LOW', cost_policy: {} }), false)
    assert.equal(
      costGateAllows({ entry: { cost_tier: 'MEDIUM' }, current_tier: 'LOW', cost_policy: { allow_cost_escalation: true } }),
      true,
    )
    assert.equal(
      costGateAllows({
        entry: { cost_tier: 'HIGH' }, current_tier: 'LOW',
        cost_policy: { allow_cost_escalation: true, allow_high_cost_escalation: false },
      }),
      false,
      'into HIGH additionally requires allow_high_cost_escalation',
    )
    assert.equal(
      costGateAllows({
        entry: { cost_tier: 'HIGH' }, current_tier: 'LOW',
        cost_policy: { allow_cost_escalation: true, allow_high_cost_escalation: true, max_high_cost_routes: 2 },
      }),
      true,
    )
  })

  it('decideRouteAction: LOW→HIGH escalation gated', () => {
    const decision = decideRouteAction({
      failure_class: 'MODEL_CAPABILITY_INSUFFICIENT',
      route: { provider: 'deepseek', model: 'deepseek-chat', cost_tier: 'LOW' },
      catalog: ESCALATION_CATALOG,
      policy: DEFAULT_ROUTING_POLICY,
      escalation_count: 0,
      provider_fallback_count: 0,
      cost_policy: { allow_cost_escalation: false, max_high_cost_routes: 1 },
      high_cost_routes_used: 0,
    })
    assert.equal(decision.action, 'TERMINAL')
    assert.equal(decision.reason_code, 'COST_GATE_DENIED')
    assert.ok(!decision.next_route, 'gated escalation must not emit a HIGH route')
  })

  it('decideRouteAction: escalation allowed when policy permits', () => {
    const decision = decideRouteAction({
      failure_class: 'MODEL_CAPABILITY_INSUFFICIENT',
      route: { provider: 'deepseek', model: 'deepseek-chat', cost_tier: 'LOW' },
      catalog: ESCALATION_CATALOG,
      policy: DEFAULT_ROUTING_POLICY,
      escalation_count: 0,
      provider_fallback_count: 0,
      cost_policy: { allow_cost_escalation: true, allow_high_cost_escalation: true, max_high_cost_routes: 2 },
      high_cost_routes_used: 0,
    })
    assert.equal(decision.action, 'ESCALATE')
    assert.equal(decision.reason_code, 'ESCALATION_ALLOWED')
    assert.equal(decision.next_route.model, 'deepseek-v4-pro')
  })

  it('availability fallback ≠ quality escalation (transition_reason)', () => {
    const availability = decideRouteAction({
      failure_class: 'PROVIDER_UNAVAILABLE',
      route: { provider: 'deepseek', model: 'deepseek-v4-flash', cost_tier: 'LOW' },
      catalog: ESCALATION_CATALOG,
      policy: DEFAULT_ROUTING_POLICY,
      escalation_count: 0,
      provider_fallback_count: 0,
    })
    assert.equal(availability.action, 'PROVIDER_FALLBACK')
    assert.equal(availability.transition_reason, 'AVAILABILITY_FALLBACK')

    const quality = decideRouteAction({
      failure_class: 'MODEL_QUALITY_GATE_REJECTED',
      route: { provider: 'deepseek', model: 'deepseek-chat', cost_tier: 'LOW' },
      catalog: ESCALATION_CATALOG,
      policy: DEFAULT_ROUTING_POLICY,
      escalation_count: 0,
      provider_fallback_count: 0,
    })
    assert.equal(quality.action, 'ESCALATE')
    assert.equal(quality.transition_reason, 'QUALITY_ESCALATION')
  })

  it('retry stays same model same tier', () => {
    const decision = decideRouteAction({
      failure_class: 'PROVIDER_RATE_LIMITED',
      route: { provider: 'deepseek', model: 'deepseek-chat', cost_tier: 'LOW' },
      catalog: ESCALATION_CATALOG,
      policy: DEFAULT_ROUTING_POLICY,
      attempt: 0,
      escalation_count: 0,
      provider_fallback_count: 0,
    })
    assert.equal(decision.action, 'RETRY_SAME_MODEL')
    assert.equal(decision.reason_code, 'RETRY_SAME_MODEL_ALLOWED')
    assert.ok(!decision.next_route, 'retry must not change model or cost tier')
  })
})
