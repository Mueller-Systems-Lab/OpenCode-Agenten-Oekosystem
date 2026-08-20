// SPDX-License-Identifier: MIT
/**
 * DEGRADED routing ranking tests (pure selectRoute level).
 *
 * Proven semantics:
 *   - HEALTHY candidates win over DEGRADED candidates when both are routable
 *   - the ranking is deterministic and array-order-independent
 *   - DEGRADED never bypasses capability or cost gates
 *   - health null / allow_degraded=false behave exactly as before
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  selectRoute,
  DEFAULT_MODEL_CATALOG,
  DEFAULT_ROUTING_POLICY,
} from '../../runtime/routing/index.mjs'

const health = (status) => ({ status })

// Custom two-model catalog (no default_primary) so constrained selection goes
// through the CHEAPEST_SUFFICIENT / DIRECT_CAPABILITY_ROUTE path.
function catalog(lowModel = 'low', mediumModel = 'medium', order = ['low', 'medium']) {
  const entries = {
    low: {
      provider: 'test', model: lowModel, enabled: true, availability: 'reachable',
      tool_support: true, mcp_support: false, structured_output: 'NONE',
      cost_tier: 'LOW', quality_tier: 'LOW', context_tier: 'LOW', capabilities: ['tools'],
    },
    medium: {
      provider: 'test', model: mediumModel, enabled: true, availability: 'reachable',
      tool_support: true, mcp_support: false, structured_output: 'NONE',
      cost_tier: 'MEDIUM', quality_tier: 'MEDIUM', context_tier: 'MEDIUM', capabilities: ['tools'],
    },
    mcp: {
      provider: 'test', model: 'mcp-model', enabled: true, availability: 'reachable',
      tool_support: true, mcp_support: true, structured_output: 'NONE',
      cost_tier: 'HIGH', quality_tier: 'HIGH', context_tier: 'HIGH', capabilities: ['tools', 'mcp'],
    },
  }
  const base = {
    ...DEFAULT_ROUTING_POLICY,
    allowed_providers: ['test'],
    provider_fallback_allowlist: ['test'],
    health_policy: { allow_degraded: true },
  }
  return { catalog: order.map((key) => entries[key]), basePolicy: base }
}

function degradedPolicy(basePolicy) {
  return { ...basePolicy, health_policy: { allow_degraded: true } }
}

// Policy that allows the 'test' provider but keeps allow_degraded=false
// (the DEFAULT_ROUTING_POLICY default) — for fail-closed tests.
function defaultDenyPolicy() {
  return {
    ...DEFAULT_ROUTING_POLICY,
    allowed_providers: ['test'],
    provider_fallback_allowlist: ['test'],
  }
}

describe('degraded ranking — HEALTHY wins over DEGRADED (order-independent)', () => {
  it('conflict: LOW+DEGRADED vs MEDIUM+HEALTHY with allow_degraded=true → MEDIUM+HEALTHY wins', () => {
    const { catalog: cat, basePolicy } = catalog()
    const healthMap = {
      'test/low': health('DEGRADED'),
      'test/medium': health('HEALTHY'),
    }
    const result = selectRoute({
      requirements: { quality_requirement: 'LOW' },
      catalog: cat,
      policy: degradedPolicy(basePolicy),
      health: healthMap,
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'medium', 'HEALTHY candidate must beat a DEGRADED cheaper one')
    assert.equal(result.route.health_status, 'HEALTHY')
    assert.equal(result.route.degraded, false)
  })

  it('same conflict in REVERSE array order → identical result (order-independent)', () => {
    const { catalog: catForward, basePolicy } = catalog()
    const { catalog: catReverse } = catalog('low', 'medium', ['medium', 'low'])
    const healthMap = {
      'test/low': health('DEGRADED'),
      'test/medium': health('HEALTHY'),
    }
    const forward = selectRoute({ requirements: { quality_requirement: 'LOW' }, catalog: catForward, policy: degradedPolicy(basePolicy), health: healthMap })
    const reverse = selectRoute({ requirements: { quality_requirement: 'LOW' }, catalog: catReverse, policy: degradedPolicy(basePolicy), health: healthMap })
    assert.equal(forward.ok, true)
    assert.equal(reverse.ok, true)
    assert.deepEqual({ model: forward.route.model, reason: forward.route.routing_reason }, { model: reverse.route.model, reason: reverse.route.routing_reason })
    assert.equal(reverse.route.model, 'medium')
  })

  it('both DEGRADED → cheaper wins (cost-first within DEGRADED)', () => {
    const { catalog: cat, basePolicy } = catalog()
    const result = selectRoute({
      requirements: { quality_requirement: 'LOW' },
      catalog: cat,
      policy: degradedPolicy(basePolicy),
      health: { 'test/low': health('DEGRADED'), 'test/medium': health('DEGRADED') },
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'low', 'among DEGRADED candidates the cheaper one wins')
    assert.equal(result.route.health_status, 'DEGRADED')
    assert.equal(result.route.degraded, true)
  })

  it('both HEALTHY → unchanged cost-first ordering (regression)', () => {
    const { catalog: cat, basePolicy } = catalog()
    const result = selectRoute({
      requirements: { quality_requirement: 'LOW' },
      catalog: cat,
      policy: degradedPolicy(basePolicy),
      health: { 'test/low': health('HEALTHY'), 'test/medium': health('HEALTHY') },
    })
    assert.equal(result.route.model, 'low')
    assert.equal(result.route.routing_reason, 'CHEAPEST_SUFFICIENT')
  })
})

describe('degraded routing — single-candidate and denial paths', () => {
  it('only DEGRADED + allow_degraded=true → routed, DEGRADED_ROUTE_SELECTED, degraded:true', () => {
    const { catalog: cat, basePolicy } = catalog('low')
    const result = selectRoute({
      requirements: { quality_requirement: 'LOW' },
      catalog: cat,
      policy: degradedPolicy(basePolicy),
      health: { 'test/low': health('DEGRADED') },
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'low')
    assert.equal(result.route.routing_reason, 'DEGRADED_ROUTE_SELECTED')
    assert.equal(result.route.degraded, true)
    assert.equal(result.route.health_status, 'DEGRADED')
  })

  it('only DEGRADED + allow_degraded=false (default) → DEGRADED_ROUTE_DENIED (fail closed)', () => {
    const { catalog: cat } = catalog('low')
    const result = selectRoute({
      requirements: { quality_requirement: 'LOW' },
      catalog: cat,
      policy: defaultDenyPolicy(),
      health: { 'test/low': health('DEGRADED') },
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'DEGRADED_ROUTE_DENIED')
    assert.ok(!result.route)
  })

  it('UNKNOWN candidates keep NO_HEALTHY_ELIGIBLE_MODEL (not DEGRADED_ROUTE_DENIED)', () => {
    const { catalog: cat, basePolicy } = catalog()
    const result = selectRoute({
      requirements: { quality_requirement: 'LOW' },
      catalog: cat,
      policy: degradedPolicy(basePolicy),
      health: {},
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NO_HEALTHY_ELIGIBLE_MODEL')
  })

  it('UNAVAILABLE candidates keep NO_HEALTHY_ELIGIBLE_MODEL (not DEGRADED_ROUTE_DENIED)', () => {
    const { catalog: cat, basePolicy } = catalog()
    const result = selectRoute({
      requirements: { quality_requirement: 'LOW' },
      catalog: cat,
      policy: degradedPolicy(basePolicy),
      health: { 'test/low': health('UNAVAILABLE'), 'test/medium': health('UNAVAILABLE') },
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NO_HEALTHY_ELIGIBLE_MODEL')
  })
})

describe('degraded does NOT bypass capability or cost gates', () => {
  it('DEGRADED model lacking needs_mcp is never selected despite allow_degraded=true', () => {
    const { catalog: cat, basePolicy } = catalog('low', 'medium', ['low', 'medium', 'mcp'])
    const healthMap = {
      'test/low': health('DEGRADED'),
      'test/medium': health('DEGRADED'),
      'test/mcp-model': health('DEGRADED'),
    }
    const result = selectRoute({
      requirements: { needs_mcp: true },
      catalog: cat,
      policy: degradedPolicy(basePolicy),
      health: healthMap,
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'mcp-model', 'only the MCP-capable candidate is eligible')
    // A DEGRADED model without MCP must never win an MCP task.
    const onlyNoMcp = catalog('low')
    const result2 = selectRoute({
      requirements: { needs_mcp: true },
      catalog: onlyNoMcp.catalog,
      policy: degradedPolicy(onlyNoMcp.basePolicy),
      health: { 'test/low': health('DEGRADED') },
    })
    assert.equal(result2.ok, false)
    assert.equal(result2.code, 'ROUTING_CAPABILITY_INCOMPATIBLE')
  })

  it('DEGRADED does NOT bypass the phase cost ceiling → COST_GATE_DENIED', () => {
    const { catalog: cat, basePolicy } = catalog('medium')
    const result = selectRoute({
      phase: 'RESEARCH',
      requirements: { quality_requirement: 'MEDIUM' },
      catalog: cat,
      policy: degradedPolicy(basePolicy),
      health: { 'test/medium': health('DEGRADED') },
      cost_policy: { phase_cost_ceilings: { RESEARCH: 'LOW', BUILD: 'MEDIUM' } },
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'COST_GATE_DENIED', 'health dimension never bypasses cost')
  })

  it('HIGH-cost DEGRADED candidate + max_high_cost_routes=0 → denied by cost', () => {
    const { catalog: cat, basePolicy } = catalog('low', 'medium', ['mcp'])
    const result = selectRoute({
      requirements: { quality_requirement: 'MEDIUM' },
      catalog: cat,
      policy: degradedPolicy(basePolicy),
      health: { 'test/mcp-model': health('DEGRADED') },
      cost_policy: { max_high_cost_routes: 0, allow_high_cost_escalation: false },
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'COST_GATE_DENIED')
  })
})

describe('degraded ranking — regressions', () => {
  it('health null → identical to pre-change behavior (all candidates rank 0)', () => {
    const { catalog: cat } = catalog()
    const result = selectRoute({ requirements: { quality_requirement: 'LOW' }, catalog: cat, policy: { ...DEFAULT_ROUTING_POLICY, allowed_providers: ['test'] } })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'low', 'cost-first ordering unchanged without health')
    assert.equal(result.route.degraded, false)
    // Default catalog baseline without health → primary route unchanged.
    const baseline = selectRoute({ requirements: {}, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY })
    assert.equal(baseline.route.model, 'deepseek-v4-flash')
    assert.equal(baseline.route.routing_reason, 'PRIMARY_ROUTE')
  })

  it('allow_degraded=false default: DEGRADED primary is skipped, HEALTHY secondary wins', () => {
    const result = selectRoute({
      requirements: {},
      health: {
        'deepseek/deepseek-v4-flash': health('DEGRADED'),
        'deepseek/deepseek-chat': health('HEALTHY'),
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'deepseek-chat')
    assert.equal(result.route.routing_reason, 'AVAILABILITY_FALLBACK')
    assert.equal(result.route.degraded, false)
  })

  it('baseline PRIMARY kept when primary is DEGRADED and allow_degraded=true (degraded:true, reason PRIMARY_ROUTE)', () => {
    const result = selectRoute({
      requirements: {},
      policy: { ...DEFAULT_ROUTING_POLICY, health_policy: { allow_degraded: true } },
      health: { 'deepseek/deepseek-v4-flash': health('DEGRADED') },
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'deepseek-v4-flash')
    assert.equal(result.route.routing_reason, 'PRIMARY_ROUTE')
    assert.equal(result.route.degraded, true)
    assert.equal(result.route.health_status, 'DEGRADED')
  })

  it('repeatability: same state twice → identical route', () => {
    const { catalog: cat, basePolicy } = catalog()
    const healthMap = {
      'test/low': health('DEGRADED'),
      'test/medium': health('HEALTHY'),
    }
    const input = { requirements: { quality_requirement: 'LOW' }, catalog: cat, policy: degradedPolicy(basePolicy), health: healthMap }
    const first = selectRoute(input)
    const second = selectRoute(input)
    assert.deepEqual(first, second)
    assert.equal(first.route.model, 'medium')
  })
})
