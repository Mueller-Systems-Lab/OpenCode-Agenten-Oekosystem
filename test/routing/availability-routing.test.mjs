// SPDX-License-Identifier: MIT
/**
 * Availability-aware routing tests (pure selectRoute level).
 *
 * Pflicht-Negativtests B–H: an unhealthy/unknown model is NEVER routed;
 * missing health evidence fails closed; capability still beats health.
 *
 * Note on test B: the AVAILABILITY_FALLBACK seam is reached on the baseline
 * (unconstrained) path — a constrained task (e.g. quality_requirement) is
 * routed by CHEAPEST_SUFFICIENT instead. The unconstrained variant below
 * exercises the exact asserted fallback outcome (model, routing_reason,
 * initial_model_skipped) against the real policy.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  selectRoute,
  DEFAULT_MODEL_CATALOG,
  DEFAULT_ROUTING_POLICY,
} from '../../runtime/routing/index.mjs'

const health = (status) => ({ status })

describe('availability-aware routing (selectRoute)', () => {
  it('B: unhealthy primary → availability fallback to healthy secondary', () => {
    const result = selectRoute({
      requirements: {},
      health: {
        'deepseek/deepseek-v4-flash': health('UNAVAILABLE'),
        'deepseek/deepseek-chat': health('HEALTHY'),
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'deepseek-chat')
    assert.equal(result.route.routing_reason, 'AVAILABILITY_FALLBACK')
    assert.equal(result.initial_model_skipped, 'INITIAL_MODEL_SKIPPED_FOR_HEALTH')
    assert.notEqual(result.route.model, 'deepseek-v4-flash', 'primary productive call must be 0')
  })

  it('B2: primary healthy preferred — no unnecessary alternative', () => {
    const result = selectRoute({
      requirements: {},
      health: { 'deepseek/deepseek-v4-flash': health('HEALTHY') },
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'deepseek-v4-flash')
    assert.equal(result.route.routing_reason, 'PRIMARY_ROUTE')
  })

  it('C: AUTH_FAILED primary → allowed fallback only; no repeated auth retry', () => {
    const healthMap = {
      'deepseek/deepseek-v4-flash': health('AUTH_FAILED'),
      'deepseek/deepseek-chat': health('HEALTHY'),
    }
    const first = selectRoute({ requirements: {}, health: healthMap })
    assert.equal(first.ok, true)
    assert.equal(first.route.model, 'deepseek-chat')
    const second = selectRoute({ requirements: {}, health: healthMap })
    assert.notEqual(second.route.model, 'deepseek-v4-flash', 'AUTH_FAILED model must never be selected again')
    assert.ok(second.route, 'fallback must stay available')
  })

  it('D: RATE_LIMITED primary → not routed', () => {
    const result = selectRoute({
      requirements: {},
      health: {
        'deepseek/deepseek-v4-flash': health('RATE_LIMITED'),
        'deepseek/deepseek-chat': health('HEALTHY'),
      },
    })
    assert.ok(result.ok)
    assert.notEqual(result.route.model, 'deepseek-v4-flash', 'RATE_LIMITED primary must not be routed')
  })

  it('G: no healthy eligible model fails closed', () => {
    const result = selectRoute({
      requirements: {},
      health: {
        'deepseek/deepseek-v4-flash': health('UNAVAILABLE'),
        'deepseek/deepseek-chat': health('UNAVAILABLE'),
        'openai/gpt-5.4-mini': health('UNAVAILABLE'),
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NO_HEALTHY_ELIGIBLE_MODEL')
  })

  it('H: capability beats health', () => {
    const result = selectRoute({
      requirements: { needs_mcp: true },
      health: {
        'deepseek/deepseek-v4-flash': health('HEALTHY'),
        'deepseek/deepseek-chat': health('HEALTHY'),
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'deepseek-v4-flash', 'MCP-capable model must win despite a healthy non-MCP alternative')
  })

  it('I: unhealthy cheap model never selected merely because cheaper', () => {
    const result = selectRoute({
      requirements: {},
      health: {
        'deepseek/deepseek-v4-flash': health('UNAVAILABLE'),
        'deepseek/deepseek-chat': health('UNAVAILABLE'),
        'openai/gpt-5.4-mini': health('HEALTHY'),
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'gpt-5.4-mini')
    assert.notEqual(result.route.model, 'deepseek-v4-flash')
    assert.notEqual(result.route.model, 'deepseek-chat')
  })

  it('health map missing entry fails closed', () => {
    const result = selectRoute({ requirements: {}, health: {} })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NO_HEALTHY_ELIGIBLE_MODEL', 'absent health entries are UNKNOWN and not routable')
  })

  it('backward compat: no health param behaves as before', () => {
    const result = selectRoute({ requirements: {} })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'deepseek-v4-flash')
    assert.equal(result.route.routing_reason, 'PRIMARY_ROUTE')
  })

  it('repeatability: same cached health → same route decision twice', () => {
    const healthMap = {
      'deepseek/deepseek-v4-flash': health('HEALTHY'),
      'deepseek/deepseek-chat': health('DEGRADED'),
    }
    const first = selectRoute({ requirements: {}, health: healthMap })
    const second = selectRoute({ requirements: {}, health: healthMap })
    assert.deepEqual(first, second)
  })

  it('DEGRADED default not routable; allow_degraded makes routable', () => {
    const degraded = {
      'deepseek/deepseek-v4-flash': health('DEGRADED'),
      'deepseek/deepseek-chat': health('HEALTHY'),
    }
    const denied = selectRoute({ requirements: {}, health: degraded })
    assert.equal(denied.route.model, 'deepseek-chat', 'DEGRADED primary must be skipped by default')

    const allowed = selectRoute({
      requirements: {},
      policy: { ...DEFAULT_ROUTING_POLICY, health_policy: { allow_degraded: true } },
      health: { 'deepseek/deepseek-v4-flash': health('DEGRADED') },
    })
    assert.equal(allowed.ok, true)
    assert.equal(allowed.route.model, 'deepseek-v4-flash', 'allow_degraded must make DEGRADED routable')
  })
})

describe('availability fallback on the default catalog', () => {
  it('explicit_override is also gated by live health', () => {
    const result = selectRoute({
      requirements: {},
      catalog: DEFAULT_MODEL_CATALOG,
      explicit_override: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      health: { 'deepseek/deepseek-v4-flash': health('UNAVAILABLE') },
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'MODEL_UNAVAILABLE')
  })
})
