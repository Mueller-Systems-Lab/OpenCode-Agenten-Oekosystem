// SPDX-License-Identifier: MIT
/**
 * Deterministic routing policy tests — selection, capability routing,
 * denial paths, budgets, run-id stability, and MCP grant stability.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MODEL_CATALOG,
  DEFAULT_ROUTING_POLICY,
  selectRoute,
  decideRouteAction,
  enforceRouteRunId,
  assertGrantStableAcrossRoute,
  modelMeetsRequirements,
  ROUTE_ACTION,
  MODEL_SELECTION_AUTHORITY,
} from '../../runtime/routing/index.mjs'

describe('model routing policy — selection authority', () => {
  it('MODEL_SELECTION_AUTHORITY is the deterministic runtime policy', () => {
    assert.equal(MODEL_SELECTION_AUTHORITY, 'DETERMINISTIC_RUNTIME_POLICY')
  })

  it('baseline task routes deterministically to the primary route', () => {
    const a = selectRoute({ requirements: {}, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY })
    const b = selectRoute({ requirements: {}, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY })
    assert.equal(a.route.provider, 'deepseek')
    assert.equal(a.route.model, 'deepseek-v4-flash')
    assert.equal(a.route.routing_reason, 'PRIMARY_ROUTE')
    assert.deepEqual({ p: a.route.provider, m: a.route.model }, { p: b.route.provider, m: b.route.model }, 'repeatability: same conditions → same route')
  })

  it('direct capability routing: needs_mcp selects the MCP-proven model, model A never eligible', () => {
    const result = selectRoute({ requirements: { needs_mcp: true }, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY })
    assert.equal(result.ok, true)
    assert.equal(result.route.provider, 'deepseek')
    assert.equal(result.route.model, 'deepseek-v4-flash')
    assert.equal(result.route.routing_reason, 'DIRECT_CAPABILITY_ROUTE')
    // deepseek-chat has no MCP support → must never be selected for MCP tasks.
    assert.equal(modelMeetsRequirements(getEntry('deepseek', 'deepseek-chat'), { needs_mcp: true }), false)
  })

  it('capability mismatch is rejected before worker invocation', () => {
    const result = selectRoute({ requirements: { needs_mcp: true }, catalog: [getEntry('deepseek', 'deepseek-chat')], policy: DEFAULT_ROUTING_POLICY })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'ROUTING_CAPABILITY_INCOMPATIBLE')
  })

  it('provider constraint routes cross-provider to the cheapest sufficient model', () => {
    const result = selectRoute({ requirements: { provider_constraints: ['openai'] }, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY })
    assert.equal(result.route.provider, 'openai')
    assert.equal(result.route.model, 'gpt-5.4-mini')
    assert.equal(result.route.routing_reason, 'DIRECT_CAPABILITY_ROUTE')
  })

  it('cheapest sufficient model wins among equal-capability candidates', () => {
    // deepseek-chat (LOW/LOW) is cheaper than deepseek-v4-flash (LOW/MEDIUM)
    // for a plain LOW-quality task.
    const result = selectRoute({ requirements: { quality_requirement: 'LOW' }, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY })
    assert.equal(result.route.model, 'deepseek-chat')
    assert.equal(result.route.routing_reason, 'CHEAPEST_SUFFICIENT')
  })

  it('cost ceiling blocks over-budget models', () => {
    const result = selectRoute({ requirements: { cost_ceiling: 'LOW', needs_mcp: true }, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY })
    // Only deepseek-v4-flash has MCP and LOW cost → still selected.
    assert.equal(result.route.model, 'deepseek-v4-flash')
    const openaiOnly = selectRoute({ requirements: { cost_ceiling: 'LOW', provider_constraints: ['openai'] }, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY })
    assert.equal(openaiOnly.ok, false)
  })

  it('unknown model → MODEL_UNAVAILABLE, no free provider call', () => {
    const result = selectRoute({ requirements: {}, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY, explicit_override: { provider: 'deepseek', model: 'does-not-exist' } })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'MODEL_UNAVAILABLE')
  })

  it('disabled model → DENIED', () => {
    const disabledCatalog = DEFAULT_MODEL_CATALOG.map((entry) => (entry.model === 'deepseek-chat' ? { ...entry, enabled: false } : entry))
    const result = selectRoute({ requirements: {}, catalog: disabledCatalog, policy: DEFAULT_ROUTING_POLICY, explicit_override: { provider: 'deepseek', model: 'deepseek-chat' } })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'ROUTING_POLICY_DENIED')
  })

  it('worker self-selection is DENIED/IGNORED — runtime policy stays authority', () => {
    const result = selectRoute({
      requirements: {},
      catalog: DEFAULT_MODEL_CATALOG,
      policy: DEFAULT_ROUTING_POLICY,
      worker_requested_model: 'openai/gpt-5.5',
    })
    assert.equal(result.worker_self_selection, 'DENIED')
    // Policy selection unchanged: still the primary route.
    assert.equal(result.route.model, 'deepseek-v4-flash')
  })

  it('explicit admin override is policy-validated and distinguishable', () => {
    const result = selectRoute({
      requirements: {},
      catalog: DEFAULT_MODEL_CATALOG,
      policy: DEFAULT_ROUTING_POLICY,
      explicit_override: { provider: 'openai', model: 'gpt-5.4-mini' },
    })
    assert.equal(result.ok, true)
    assert.equal(result.override_used, true)
    assert.equal(result.route.routing_reason, 'EXPLICIT_OVERRIDE_VALIDATED')
    // Capability-incompatible override is denied.
    const bad = selectRoute({
      requirements: { needs_mcp: true },
      catalog: DEFAULT_MODEL_CATALOG,
      policy: DEFAULT_ROUTING_POLICY,
      explicit_override: { provider: 'openai', model: 'gpt-5.4-mini' },
    })
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'ROUTING_CAPABILITY_INCOMPATIBLE')
  })

  it('provider allowlist is enforced — non-allowlisted provider never selected', () => {
    const policy = { ...DEFAULT_ROUTING_POLICY, allowed_providers: ['deepseek'] }
    const result = selectRoute({ requirements: { provider_constraints: ['openai'] }, catalog: DEFAULT_MODEL_CATALOG, policy })
    assert.equal(result.ok, false)
  })
})

describe('model routing policy — live availability', () => {
  it('unavailable primary falls back deterministically to the cheapest sufficient model', () => {
    const result = selectRoute({
      requirements: {}, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
      availability: ['deepseek/deepseek-v4-flash'],
    })
    assert.equal(result.ok, true)
    assert.equal(result.route.model, 'deepseek-chat')
    assert.equal(result.route.routing_reason, 'PRIMARY_UNAVAILABLE_FALLBACK')
  })

  it('override to a live-unavailable model → MODEL_UNAVAILABLE', () => {
    const result = selectRoute({
      requirements: {}, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
      explicit_override: { provider: 'openai', model: 'gpt-5.4-mini' },
      availability: ['openai/gpt-5.4-mini'],
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'MODEL_UNAVAILABLE')
  })

  it('all candidates unavailable → controlled denial (no hallucination path)', () => {
    const result = selectRoute({
      requirements: {}, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
      availability: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-chat', 'openai/gpt-5.4-mini'],
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'ROUTING_CAPABILITY_INCOMPATIBLE')
  })
})

describe('model routing policy — run identity and grant stability', () => {
  it('run_id guard rejects a route with a replaced run_id (CONTRACT_INVALID)', () => {
    assert.throws(
      () => enforceRouteRunId('run-1', { run_id: 'run-2', provider: 'deepseek', model: 'deepseek-chat' }, 'routing-route'),
      /CONTRACT_INVALID/,
    )
  })

  it('run_id guard accepts a route without run_id and with the same run_id', () => {
    const route = { provider: 'deepseek', model: 'deepseek-chat' }
    assert.equal(enforceRouteRunId('run-1', route, 'routing-route'), route)
    const same = { ...route, run_id: 'run-1' }
    assert.equal(enforceRouteRunId('run-1', same, 'routing-route'), same)
  })

  it('MCP grant stays stable across a model route change', () => {
    const grant = { allowed_tools: [{ tool: 'browser_navigate', server: 'playwright' }], allowed_servers: ['playwright'] }
    const check = assertGrantStableAcrossRoute(grant, { provider: 'deepseek', model: 'deepseek-v4-flash' })
    assert.equal(check.allowed, true)
    assert.equal(check.code, 'MCP_GRANT_STABLE_ACROSS_MODEL_ROUTE')
    assert.equal(assertGrantStableAcrossRoute(null, {}).allowed, false)
  })

  it('routing policy never accepts or creates a run_id (module-level invariant)', async () => {
    // The policy source must not contain a run_id generator.
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(new URL('../../runtime/routing/routing-policy.mjs', import.meta.url), 'utf8')
    assert.ok(!source.includes('randomUUID'), 'routing policy must not create run identities')
  })
})

function getEntry(provider, model) {
  const entry = DEFAULT_MODEL_CATALOG.find((item) => item.provider === provider && item.model === model)
  assert.ok(entry, `${provider}/${model}`)
  return entry
}
