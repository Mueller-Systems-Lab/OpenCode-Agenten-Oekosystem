// SPDX-License-Identifier: MIT
/**
 * Retry vs Escalation vs Provider Fallback separation tests.
 *
 * These three transitions must never collapse into a generic "retry":
 *   - RETRY_SAME_MODEL: same provider, same model, new attempt
 *   - ESCALATE: same run, different model, explicit escalation reason
 *   - PROVIDER_FALLBACK: same run, different provider, explicit allowed fallback
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MODEL_CATALOG,
  DEFAULT_ROUTING_POLICY,
  decideRouteAction,
  ROUTE_ACTION,
} from '../../runtime/routing/index.mjs'

const routeA = { provider: 'deepseek', model: 'deepseek-chat', route_index: 0 }
const routeB = { provider: 'deepseek', model: 'deepseek-v4-flash', route_index: 0 }

describe('retry vs escalation separation', () => {
  it('MODEL_OUTPUT_INVALID with budget → RETRY_SAME_MODEL (never escalation)', () => {
    const result = decideRouteAction({
      failure_class: 'MODEL_OUTPUT_INVALID', route: routeA, attempt: 0,
      escalation_count: 0, provider_fallback_count: 0, route_history: [routeA],
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    assert.equal(result.action, ROUTE_ACTION.RETRY_SAME_MODEL)
    assert.equal(result.reason_code, 'RETRY_SAME_MODEL_ALLOWED')
    assert.equal(result.next_route, undefined, 'retry must not carry a new route')
  })

  it('MODEL_CAPABILITY_INSUFFICIENT → ESCALATE with a distinct next route', () => {
    const result = decideRouteAction({
      failure_class: 'MODEL_CAPABILITY_INSUFFICIENT', route: routeA,
      escalation_count: 0, provider_fallback_count: 0, route_history: [routeA],
      requirements: { needs_mcp: true },
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    assert.equal(result.action, ROUTE_ACTION.ESCALATE)
    assert.equal(result.reason_code, 'ESCALATION_ALLOWED')
    assert.equal(result.next_route.model, 'deepseek-v4-flash')
    assert.equal(result.next_route.provider, 'deepseek')
  })

  it('MODEL_UNAVAILABLE prefers a same-provider model escalation first', () => {
    const result = decideRouteAction({
      failure_class: 'MODEL_UNAVAILABLE', route: routeA,
      escalation_count: 0, provider_fallback_count: 0, route_history: [routeA],
      requirements: {},
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    assert.equal(result.action, ROUTE_ACTION.ESCALATE)
    assert.equal(result.next_route.provider, 'deepseek')
    assert.equal(result.next_route.model, 'deepseek-v4-flash')
  })

  it('MODEL_UNAVAILABLE with exhausted same-provider candidates → PROVIDER_FALLBACK (allowlisted)', () => {
    const result = decideRouteAction({
      failure_class: 'MODEL_UNAVAILABLE', route: { provider: 'openai', model: 'gpt-5.4-mini' },
      escalation_count: 0, provider_fallback_count: 0, route_history: [{ provider: 'openai', model: 'gpt-5.4-mini' }],
      requirements: {},
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    assert.equal(result.action, ROUTE_ACTION.PROVIDER_FALLBACK)
    assert.equal(result.reason_code, 'PROVIDER_FALLBACK_ALLOWED')
    assert.equal(result.next_route.provider, 'deepseek')
    assert.equal(result.next_route.model, 'deepseek-v4-flash')
  })

  it('PROVIDER_UNAVAILABLE with allowlisted provider → PROVIDER_FALLBACK', () => {
    const result = decideRouteAction({
      failure_class: 'PROVIDER_UNAVAILABLE', route: routeA,
      escalation_count: 0, provider_fallback_count: 0, route_history: [routeA],
      requirements: {},
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    assert.equal(result.action, ROUTE_ACTION.PROVIDER_FALLBACK)
    assert.equal(result.reason_code, 'PROVIDER_FALLBACK_ALLOWED')
    assert.equal(result.next_route.provider, 'openai')
  })

  it('PROVIDER_AUTH_FAILURE → TERMINAL fail closed (no provider sweep)', () => {
    const result = decideRouteAction({
      failure_class: 'PROVIDER_AUTH_FAILURE', route: routeA,
      escalation_count: 0, provider_fallback_count: 0, route_history: [routeA],
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    assert.equal(result.action, ROUTE_ACTION.TERMINAL)
    assert.equal(result.reason_code, 'AUTH_FAILURE_FAIL_CLOSED')
  })

  it('escalation budget exhausted → TERMINAL, no further model call', () => {
    const result = decideRouteAction({
      failure_class: 'MODEL_CAPABILITY_INSUFFICIENT', route: routeA,
      escalation_count: 1, provider_fallback_count: 0, route_history: [routeA],
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    assert.equal(result.action, ROUTE_ACTION.TERMINAL)
    assert.equal(result.reason_code, 'ROUTING_BUDGET_EXHAUSTED')
  })

  it('provider fallback not allowlisted → provider B never called', () => {
    const policy = { ...DEFAULT_ROUTING_POLICY, provider_fallback_allowlist: ['deepseek'] }
    const result = decideRouteAction({
      failure_class: 'PROVIDER_UNAVAILABLE', route: routeA,
      escalation_count: 0, provider_fallback_count: 0, route_history: [routeA],
      catalog: DEFAULT_MODEL_CATALOG, policy,
    })
    // Only a same-provider model could be chosen; deepseek-chat → none better
    // with requirements {} (primary already the best LOW candidate set) —
    // controlled terminal, provider B (openai) is never selected.
    assert.equal(result.action, ROUTE_ACTION.TERMINAL)
  })

  it('no A→B→C→A loop: routes already tried are never repeated', () => {
    const result = decideRouteAction({
      failure_class: 'MODEL_CAPABILITY_INSUFFICIENT', route: routeA,
      escalation_count: 0, provider_fallback_count: 0,
      route_history: [routeA, routeB],
      requirements: { needs_mcp: true },
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    // v4-flash is in history → no target left.
    assert.equal(result.action, ROUTE_ACTION.TERMINAL)
  })

  it('retry budget exhausted on route → escalation is a distinct next step', () => {
    const result = decideRouteAction({
      failure_class: 'MODEL_OUTPUT_INVALID', route: routeA,
      attempt: 2, escalation_count: 0, provider_fallback_count: 0, route_history: [routeA],
      requirements: { quality_requirement: 'LOW' },
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    assert.equal(result.action, ROUTE_ACTION.ESCALATE)
    assert.equal(result.reason_code, 'ESCALATION_RETRY_BUDGET_EXHAUSTED')
  })

  it('unclassified failure class → TERMINAL controlled', () => {
    const result = decideRouteAction({
      failure_class: 'SOMETHING_ELSE', route: routeA,
      escalation_count: 0, provider_fallback_count: 0, route_history: [routeA],
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    assert.equal(result.action, ROUTE_ACTION.TERMINAL)
    assert.equal(result.reason_code, 'ROUTING_UNCLASSIFIED_FAILURE')
  })

  it('no active route → TERMINAL', () => {
    const result = decideRouteAction({ failure_class: 'MODEL_UNAVAILABLE' })
    assert.equal(result.action, ROUTE_ACTION.TERMINAL)
    assert.equal(result.reason_code, 'ROUTING_NO_ROUTE')
  })
})
