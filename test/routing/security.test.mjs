// SPDX-License-Identifier: MIT
/**
 * Routing security boundary tests (negative proofs).
 *
 * Covers: worker self-escalation denied, unknown model, disabled model,
 * capability mismatch, escalation budget, provider fallback not allowed,
 * run-id replacement, tool grant expansion, fake success, and
 * tool-result-driven routing (data, not instructions).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_MODEL_CATALOG,
  DEFAULT_ROUTING_POLICY,
  selectRoute,
  decideRouteAction,
  enforceRouteRunId,
  ROUTE_ACTION,
} from '../../runtime/routing/index.mjs'
import { resolveToolGrant, assertToolAllowed } from '../../runtime/mcp/tool-grant.mjs'
import { repoRoot } from '../helpers.mjs'

const routeA = { provider: 'deepseek', model: 'deepseek-chat', route_index: 0 }

describe('routing security — negative proofs', () => {
  it('worker self-escalation ("I need a more powerful model") → DENIED/IGNORED', () => {
    const result = selectRoute({
      requirements: {},
      catalog: DEFAULT_MODEL_CATALOG,
      policy: DEFAULT_ROUTING_POLICY,
      worker_requested_model: 'deepseek/deepseek-v4-pro',
    })
    assert.equal(result.worker_self_selection, 'DENIED')
    // The worker's expensive request never becomes the route.
    assert.notEqual(`${result.route.provider}/${result.route.model}`, 'deepseek/deepseek-v4-pro')
    assert.equal(result.route.model, 'deepseek-v4-flash')
  })

  it('tool-result-driven escalation is data, not a routing instruction', () => {
    // A tool result containing "switch to expensive model" must never be
    // honored as a routing instruction: the policy has no input channel for
    // tool-result directives.
    const result = decideRouteAction({
      failure_class: 'MODEL_OUTPUT_INVALID',
      route: routeA,
      attempt: 0,
      escalation_count: 0,
      provider_fallback_count: 0,
      route_history: [routeA],
      catalog: DEFAULT_MODEL_CATALOG,
      policy: DEFAULT_ROUTING_POLICY,
    })
    // No injection channel: the decision is purely class+budget+policy.
    assert.equal(result.action, ROUTE_ACTION.RETRY_SAME_MODEL)
  })

  it('unknown model → MODEL_UNAVAILABLE / CONFIG_INVALID (no free provider call)', () => {
    const result = selectRoute({ requirements: {}, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY, explicit_override: { provider: 'openai', model: 'gpt-9999-fake' } })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'MODEL_UNAVAILABLE')
  })

  it('disabled model → DENIED', () => {
    const catalog = DEFAULT_MODEL_CATALOG.map((entry) => (entry.model === 'deepseek-chat' ? { ...entry, enabled: false } : entry))
    const result = selectRoute({ requirements: {}, catalog, policy: DEFAULT_ROUTING_POLICY, explicit_override: { provider: 'deepseek', model: 'deepseek-chat' } })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'ROUTING_POLICY_DENIED')
  })

  it('capability mismatch → route rejected before worker invocation', () => {
    const result = selectRoute({ requirements: { needs_mcp: true, provider_constraints: ['openai'] }, catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'ROUTING_CAPABILITY_INCOMPATIBLE')
  })

  it('escalation budget → NO FURTHER MODEL CALL', () => {
    const result = decideRouteAction({
      failure_class: 'MODEL_CONTEXT_LIMIT', route: routeA,
      escalation_count: 1, provider_fallback_count: 0, route_history: [routeA],
      catalog: DEFAULT_MODEL_CATALOG, policy: DEFAULT_ROUTING_POLICY,
    })
    assert.equal(result.action, ROUTE_ACTION.TERMINAL)
    assert.equal(result.reason_code, 'ROUTING_BUDGET_EXHAUSTED')
  })

  it('provider fallback not allowed → provider B not called', () => {
    const policy = { ...DEFAULT_ROUTING_POLICY, provider_fallback_allowlist: ['deepseek'] }
    const result = decideRouteAction({
      failure_class: 'PROVIDER_UNAVAILABLE', route: routeA,
      escalation_count: 0, provider_fallback_count: 0, route_history: [routeA],
      catalog: DEFAULT_MODEL_CATALOG, policy,
    })
    assert.equal(result.action, ROUTE_ACTION.TERMINAL)
    assert.equal(result.next_route, undefined)
  })

  it('run-id replacement → DENIED / CONTRACT_INVALID', () => {
    assert.throws(() => enforceRouteRunId('run-abc', { run_id: 'run-xyz', provider: 'deepseek', model: 'deepseek-chat' }), /CONTRACT_INVALID/)
  })

  it('tool grant expansion after model switch → DENIED', () => {
    const grant = resolveToolGrant({
      profile: {
        agent_id: 'worker', role: 'worker',
        required_tools: [{ name: 'browser_navigate', server: 'playwright' }],
        optional_tools: [],
        allowed_operations: ['read'], denied_operations: ['write'],
        allowed_paths: ['**'], write_paths: [], network_policy: 'deny',
        egress_policy: 'deny', trust_tier: '1_sandboxed',
        tool_version_constraints: {}, auth_requirement: {},
        timeout_ms: 30000, preflight_failure_policy: 'FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT',
      },
      inventory: {
        playwright: { available: true, tools: [{ name: 'browser_navigate', version: '1', operations: ['read'] }, { name: 'browser_snapshot', version: '1', operations: ['read'] }] },
      },
    })
    // model A route grant
    const allowed = assertToolAllowed({ grant, server: 'playwright', tool: 'browser_navigate' })
    assert.equal(allowed.allowed, true)
    // model B tries browser_snapshot (not in the grant) → DENIED
    const denied = assertToolAllowed({ grant, server: 'playwright', tool: 'browser_snapshot' })
    assert.equal(denied.allowed, false)
    assert.equal(denied.code, 'MCP_TOOL_SCOPE_DENIED')
  })

  it('fake success: worker claims DONE but verify fails → NOT DONE', async () => {
    const { decide } = await import('../../runtime/controller/controller.mjs')
    const decision = decide({
      baseline: { approved: true },
      plan: {},
      planGate: { approved: true, errors: [] },
      verification: { verification: { passed: false, failure_signature: 'TEST_FAILURE:x', strategy_delta: 'fix the actual test' } },
      reviews: [],
      attempt: 0,
      max_attempts: 1,
      boundaries: [{ name: 'BUILD', status: 'PASS' }, { name: 'VERIFY', status: 'FAIL' }],
    })
    assert.notEqual(decision.decision, 'DONE')
    // Model B success without verify is also NOT DONE.
    const noVerify = decide({
      baseline: { approved: true },
      plan: {},
      planGate: { approved: true, errors: [] },
      verification: { verification: { passed: false } },
      reviews: [],
      attempt: 0,
      max_attempts: 1,
      boundaries: [{ name: 'BUILD', status: 'PASS' }, { name: 'VERIFY', status: 'FAIL' }],
    })
    assert.notEqual(noVerify.decision, 'DONE')
  })

  it('routing modules contain no credential material (structural)', async () => {
    const files = ['runtime/routing/routing-policy.mjs', 'runtime/routing/routing-events.mjs', 'runtime/routing/model-catalog.mjs', 'runtime/routing/failure-classifier.mjs', 'runtime/routing/index.mjs']
    for (const file of files) {
      const source = await fs.readFile(path.join(repoRoot, file), 'utf8')
      assert.ok(!/(?:sk-|ghp_)[A-Za-z0-9_-]{8,}/.test(source), `${file} must not contain secret prefixes`)
    }
  })

  it('routing is not reachable from an untrusted MCP tool result (no such channel)', async () => {
    const policySource = await fs.readFile(path.join(repoRoot, 'runtime/routing/routing-policy.mjs'), 'utf8')
    // decideRouteAction only accepts failure_class + budgets + route history —
    // no field for arbitrary tool-result content.
    const signature = policySource.match(/export function decideRouteAction\(\{([\s\S]*?)\}\)\s*\{/)[1]
    assert.ok(!signature.includes('tool_result'), 'tool results must not feed the routing decision directly')
    assert.ok(!signature.includes('toolOutput'))
  })
})
