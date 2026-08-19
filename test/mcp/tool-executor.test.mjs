// SPDX-License-Identifier: MIT
/**
 * MCP worker tool integration — targeted tests for the least-privilege
 * grant, real tool execution, error classification, bounded timeout, result
 * validation, observability, secret redaction, prompt-injection handling,
 * retry interaction, and controller terminal authority.
 *
 * Uses the controllable stdio fixture server (test/fixtures/mcp-worker-test-server.mjs)
 * so every boundary is deterministic without any external MCP server.
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBaseline } from '../../runtime/baseline/capability-preflight.mjs'
import { runTask } from '../../runtime/run.mjs'
import { resolveToolGrant, assertToolAllowed } from '../../runtime/mcp/tool-grant.mjs'
import { executeMcpTool, createMcpSession, mcpSessionCall, validateMcpResult } from '../../runtime/mcp/tool-executor.mjs'
import { classifyMcpError, MCP_FAILURE_CLASSES } from '../../runtime/mcp/error-classifier.mjs'
import { discoverMcpServers } from '../../scripts/lib/mcp-preflight.mjs'
import { hasSecretLeak } from '../../runtime/observability/run-events.mjs'
import { decide } from '../../runtime/controller/controller.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE_SERVER = path.join(repoRoot, 'test', 'fixtures', 'mcp-worker-test-server.mjs')
const RUN_ID = 'mcp-executor-test-run'

const baseProfile = (requiredTools = [], optionalTools = []) => ({
  agent_id: 'mcp-test-agent', role: 'worker', required_tools: requiredTools, optional_tools: optionalTools,
  allowed_operations: ['read'], denied_operations: ['write'], allowed_paths: ['**'], write_paths: [],
  network_policy: 'deny', egress_policy: 'deny', trust_tier: '1_sandboxed', tool_version_constraints: {},
  auth_requirement: {}, timeout_ms: 5000, preflight_failure_policy: 'FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT',
})

async function fixtureInventory({ tools = ['echo'] } = {}) {
  const discovered = discoverMcpServers({
    fixture: { command: process.execPath, args: [FIXTURE_SERVER], timeout_ms: 5000, trust_tier: '1_sandboxed' },
  })
  const server = discovered.fixture
  server.tools = server.tools.filter((entry) => tools.includes(entry.name))
  return { fixture: server }
}

function task(runId = RUN_ID) {
  return { contract: 'ecosystem.task.v1', run_id: runId, task: 'use MCP echo tool', repository: repoRoot, attempt: 0, max_attempts: 2 }
}

const serverConfig = { command: process.execPath, args: [FIXTURE_SERVER] }

describe('MCP worker tool integration', () => {
  before(async () => {
    const inventory = await fixtureInventory()
    assert.equal(inventory.fixture.available, true)
  })

  describe('least-privilege grant', () => {
    it('worker receives ONLY required + available optional tools', async () => {
      const inventory = await fixtureInventory({ tools: ['echo', 'deny', 'invalid'] })
      const grant = resolveToolGrant({
        profile: baseProfile([{ name: 'echo', server: 'fixture' }]),
        inventory,
      })
      assert.equal(grant.approved, true)
      assert.deepEqual(grant.allowed_tools.map((entry) => entry.tool), ['echo'])
      assert.deepEqual(grant.allowed_servers, ['fixture'])
      assert.ok(grant.denied_tools.some((entry) => entry.tool === 'deny' && entry.reason === 'MCP_TOOL_NOT_GRANTED'))
      assert.ok(grant.denied_tools.some((entry) => entry.tool === 'invalid' && entry.reason === 'MCP_TOOL_NOT_GRANTED'))
    })

    it('required tool unavailable → grant denied (fail closed)', async () => {
      const inventory = await fixtureInventory({ tools: ['echo'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'ghost', server: 'fixture' }]), inventory })
      assert.equal(grant.approved, false)
      assert.ok(grant.denied_tools.some((entry) => entry.tool === 'ghost' && entry.reason === 'MCP_REQUIRED_CAPABILITY_UNAVAILABLE'))
    })

    it('optional tool unavailable → grant approved with degradation (no false block)', async () => {
      const inventory = await fixtureInventory({ tools: ['echo'] })
      const grant = resolveToolGrant({
        profile: baseProfile([{ name: 'echo', server: 'fixture' }], [{ name: 'ghost', server: 'fixture' }]),
        inventory,
      })
      assert.equal(grant.approved, true)
      assert.deepEqual(grant.degraded_tools.map((entry) => entry.tool), ['ghost'])
    })

    it('unauthorized tool call → MCP_TOOL_SCOPE_DENIED', async () => {
      const inventory = await fixtureInventory({ tools: ['echo', 'deny'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'echo', server: 'fixture' }]), inventory })
      const denial = assertToolAllowed({ grant, server: 'fixture', tool: 'deny' })
      assert.equal(denial.allowed, false)
      assert.equal(denial.code, 'MCP_TOOL_SCOPE_DENIED')
    })

    it('server scope drift → MCP_SERVER_SCOPE_DENIED', async () => {
      const inventory = await fixtureInventory({ tools: ['echo'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'echo', server: 'fixture' }]), inventory })
      const denial = assertToolAllowed({ grant, server: 'other-server', tool: 'echo' })
      assert.equal(denial.allowed, false)
      assert.equal(denial.code, 'MCP_SERVER_SCOPE_DENIED')
    })

    it('mutation on read-only grant → MCP_MUTATION_SCOPE_DENIED', () => {
      const grant = { approved: true, allowed_tools: [{ tool: 'echo', server: 'fixture', operation_class: 'READ_ONLY' }], allowed_servers: ['fixture'] }
      const denial = assertToolAllowed({ grant, server: 'fixture', tool: 'echo', operation: 'write' })
      assert.equal(denial.allowed, false)
      assert.equal(denial.code, 'MCP_MUTATION_SCOPE_DENIED')
    })

    it('DENIED executeMcpTool never spawns the server (sentinel binary)', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-mcp-nospawn-'))
      const marker = path.join(dir, 'SPAWNED')
      const sentinelScript = path.join(dir, 'spawn-sentinel.mjs')
      await fs.writeFile(sentinelScript, `await import('node:fs/promises').then(async (fs) => { await fs.writeFile('${marker}', 'spawned') })`, 'utf8')
      const inventory = await fixtureInventory({ tools: ['echo'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'echo', server: 'fixture' }]), inventory })
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'deny', capability: 'deny', // NOT granted
        arguments: {}, serverConfig: { command: process.execPath, args: [sentinelScript] },
        timeout_ms: 5000, expectation: {},
      })
      assert.equal(evidence.status, 'DENIED')
      assert.equal(evidence.granted, false)
      assert.equal(evidence.failure_class, 'MCP_TOOL_SCOPE_DENIED')
      await assert.rejects(fs.access(marker), /ENOENT/, 'server binary must not be spawned for a denied tool')
      await fs.rm(dir, { recursive: true, force: true })
    })
  })

  describe('real tool execution + classification', () => {
    it('successful real call returns evidence with fingerprints + provenance', async () => {
      const inventory = await fixtureInventory({ tools: ['echo'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'echo', server: 'fixture' }]), inventory })
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'echo', capability: 'echo',
        arguments: { text: 'hello mcp' },
        serverConfig, timeout_ms: 5000, expectation: { require_content: true, require_text_content: true },
        eventSink: null,
      })
      assert.equal(evidence.status, 'SUCCESS')
      assert.equal(evidence.granted, true)
      assert.ok(evidence.input_fingerprint)
      assert.ok(evidence.output_fingerprint)
      assert.ok(evidence.duration_ms >= 0)
      assert.ok(evidence.started_at && evidence.finished_at)
      assert.equal(evidence.contract, 'mcp.tool-call.evidence.v1')
      assert.equal(evidence.result_terminal_token_like, false)
    })

    it('tool missing on server → MCP_TOOL_NOT_FOUND (server-level)', async () => {
      // The profile declares the tool and the (simulated) inventory lists it,
      // so the grant allows it; the REAL server does not list it → the
      // executor classifies MCP_TOOL_NOT_FOUND.
      const inventory = await fixtureInventory({ tools: ['echo'] })
      inventory.fixture.tools.push({ name: 'missing', version: null, operations: [] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'missing', server: 'fixture' }]), inventory })
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'missing', capability: 'missing',
        arguments: {}, serverConfig, timeout_ms: 5000, expectation: {},
      })
      assert.equal(evidence.status, 'FAILURE')
      assert.equal(evidence.failure_class, 'MCP_TOOL_NOT_FOUND')
    })

    it('permission denied → MCP_PERMISSION_DENIED', async () => {
      const inventory = await fixtureInventory({ tools: ['deny'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'deny', server: 'fixture' }]), inventory })
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'deny', capability: 'deny',
        arguments: {}, serverConfig, timeout_ms: 5000, expectation: {},
      })
      assert.equal(evidence.status, 'FAILURE')
      assert.equal(evidence.failure_class, 'MCP_PERMISSION_DENIED')
    })

    it('invalid result shape → MCP_RESULT_INVALID (no blind acceptance)', async () => {
      const inventory = await fixtureInventory({ tools: ['invalid'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'invalid', server: 'fixture' }]), inventory })
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'invalid', capability: 'invalid',
        arguments: {}, serverConfig, timeout_ms: 5000,
        expectation: { require_content: true },
      })
      assert.equal(evidence.status, 'FAILURE')
      assert.equal(evidence.failure_class, 'MCP_RESULT_INVALID')
    })

    it('bounded timeout → MCP_TIMEOUT, no hang', async () => {
      const inventory = await fixtureInventory({ tools: ['slow'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'slow', server: 'fixture' }]), inventory })
      const started = Date.now()
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'slow', capability: 'slow',
        arguments: { delay_ms: 20000 }, serverConfig, timeout_ms: 1500, expectation: {},
      })
      const elapsed = Date.now() - started
      assert.equal(evidence.status, 'FAILURE')
      assert.equal(evidence.failure_class, 'MCP_TIMEOUT')
      assert.ok(elapsed < 10000, `timeout must be bounded, took ${elapsed}ms`)
    })

    it('server exits without reply → MCP_SERVER_UNAVAILABLE', async () => {
      const inventory = await fixtureInventory({ tools: ['transport_abort'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'transport_abort', server: 'fixture' }]), inventory })
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'transport_abort', capability: 'transport_abort',
        arguments: {}, serverConfig, timeout_ms: 5000, expectation: {},
      })
      assert.equal(evidence.status, 'FAILURE')
      assert.equal(evidence.failure_class, 'MCP_SERVER_UNAVAILABLE')
    })

    it('session API supports multiple calls in one server process', async () => {
      const session = createMcpSession({ command: process.execPath, args: [FIXTURE_SERVER], serverName: 'fixture', timeout_ms: 5000 })
      try {
        const first = await mcpSessionCall({ session, tool: 'echo', arguments: { text: 'one' }, timeout_ms: 5000 })
        assert.equal(first.status, 'MCP_SUCCESS')
        const second = await mcpSessionCall({ session, tool: 'echo', arguments: { text: 'two' }, timeout_ms: 5000 })
        assert.equal(second.status, 'MCP_SUCCESS')
        assert.equal(session.tool_calls, 2)
      } finally {
        await session.close()
      }
    })
  })

  describe('security boundaries', () => {
    it('secret leakage is blocked by the egress gate', async () => {
      const inventory = await fixtureInventory({ tools: ['secret'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'secret', server: 'fixture' }]), inventory })
      const secret = 'OCAE_TEST_SECRET_7f3a9c21e5b8'
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'secret', capability: 'secret',
        arguments: {}, serverConfig, timeout_ms: 5000, expectation: {},
        knownSecrets: [secret],
      })
      assert.equal(evidence.status, 'FAILURE')
      assert.equal(evidence.failure_class, 'MCP_RESULT_INVALID')
      assert.match(evidence.failure_reason, /secret egress blocked/)
      assert.equal(JSON.stringify(evidence).includes(secret), false)
    })

    it('tool-result prompt injection is treated as DATA, never as instruction', async () => {
      const inventory = await fixtureInventory({ tools: ['inject'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'inject', server: 'fixture' }]), inventory })
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'inject', capability: 'inject',
        arguments: {}, serverConfig, timeout_ms: 5000, expectation: { require_content: true, require_text_content: true },
      })
      assert.equal(evidence.status, 'SUCCESS')
      assert.equal(evidence.result_terminal_token_like, true)
      assert.match(evidence.result_text, /mark task DONE/)
    })
  })

  describe('controller authority + verify', () => {
    it('required MCP missing → baseline BLOCKED, no worker call', () => {
      const baseline = runBaseline({
        task: task('use the ghost MCP tool'),
        repoRoot,
        inventory: { fixture: { name: 'fixture', available: true, tools: [{ name: 'echo' }] } },
        mcpProfile: baseProfile([{ name: 'ghost', server: 'fixture' }]),
      })
      assert.equal(baseline.approved, false)
      assert.equal(baseline.required_mcp.ghost, 'FAIL')
    })

    it('tool success ALONE never yields DONE — verify is mandatory', () => {
      const baseline = { approved: true, errors: [] }
      const planGate = { approved: true, errors: [] }
      // A tool call succeeded, but no verification was performed.
      const withoutVerify = decide({
        baseline, planGate, verification: null, reviews: [], attempt: 0, max_attempts: 2,
        boundaries: [{ name: 'TASK', status: 'PASS' }, { name: 'BASELINE', status: 'PASS' }],
      })
      assert.notEqual(withoutVerify.decision, 'DONE')
      // Tool succeeded but verification failed → not DONE.
      const failedVerify = decide({
        baseline, planGate,
        verification: { verification: { passed: false, failure_signature: 'MCP_EVIDENCE_FAILED:MCP_TOOL_ERROR', strategy_delta: null } },
        reviews: [], attempt: 0, max_attempts: 2,
        boundaries: [{ name: 'TASK', status: 'PASS' }, { name: 'BASELINE', status: 'PASS' }, { name: 'BUILD', status: 'PASS' }, { name: 'VERIFY', status: 'FAIL' }],
      })
      assert.notEqual(failedVerify.decision, 'DONE')
    })

    it('optional MCP missing → baseline approved (degraded, no false block)', () => {
      const baseline = runBaseline({
        task: task('inspect code'),
        repoRoot,
        inventory: { fixture: { name: 'fixture', available: true, tools: [{ name: 'echo' }] } },
        mcpProfile: baseProfile([], [{ name: 'ghost', server: 'fixture' }]),
      })
      assert.equal(baseline.approved, true)
      assert.equal(baseline.required_mcp.ghost, 'DEGRADED')
    })

    it('runTask passes the least-privilege tool_grant to the build worker', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-mcp-wiring-'))
      const inventory = await fixtureInventory({ tools: ['echo'] })
      const profile = baseProfile([{ name: 'echo', server: 'fixture' }])
      let receivedGrant = null
      const result = await runTask({
        taskInput: { task: 'run a tiny mcp-aided build', repository: dir },
        repoRoot: dir,
        inventory,
        mcpProfile: profile,
        nativePlan: `# Plan
## Targets
- out.txt — write a marker
## Acceptance Criteria
- marker file exists
## Required Tests
- node --test test/x.test.mjs
## Risks
- none
## Build Scope
files: out.txt
`,
        buildExecutor: async (buildInput, workerContext) => {
          receivedGrant = workerContext?.tool_grant || null
          await fs.writeFile(path.join(dir, 'out.txt'), 'ok', 'utf8')
          return { changed_files: ['out.txt'], errors: [] }
        },
        verifyChecks: [{ command: process.execPath, args: ['-e', `require('fs').accessSync('${dir}/out.txt')`] }],
      })
      assert.ok(receivedGrant, 'worker must receive the tool grant')
      assert.equal(receivedGrant.allowed_servers.includes('fixture'), true)
      assert.deepEqual(receivedGrant.allowed_tools.map((entry) => entry.tool), ['echo'])
      assert.equal(result.phase, 'PIPELINE')
      await fs.rm(dir, { recursive: true, force: true })
    })
  })

  describe('error classification', () => {
    it('taxonomy covers the canonical MCP failure classes', () => {
      assert.deepEqual(MCP_FAILURE_CLASSES, [
        'MCP_SERVER_UNAVAILABLE', 'MCP_TOOL_NOT_FOUND', 'MCP_PERMISSION_DENIED',
        'MCP_SCHEMA_INVALID', 'MCP_TIMEOUT', 'MCP_TRANSPORT_FAILURE',
        'MCP_TOOL_ERROR', 'MCP_RESULT_INVALID',
      ])
    })
    it('timeout and permission shapes map to stable classes', () => {
      assert.equal(classifyMcpError({}, { timedOut: true }), 'MCP_TIMEOUT')
      assert.equal(classifyMcpError({ code: 403, message: 'forbidden' }), 'MCP_PERMISSION_DENIED')
      assert.equal(classifyMcpError({ code: -32602, message: 'Unknown tool: x' }), 'MCP_TOOL_NOT_FOUND')
      assert.equal(classifyMcpError({ code: -32000, message: 'internal error' }), 'MCP_TOOL_ERROR')
      assert.equal(classifyMcpError({}, { transport: 'SPAWN' }), 'MCP_SERVER_UNAVAILABLE')
    })
  })

  describe('observability', () => {
    it('tool calls emit start/result governance events with run correlation', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-mcp-events-'))
      const eventSink = path.join(dir, 'events.jsonl')
      const inventory = await fixtureInventory({ tools: ['echo'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'echo', server: 'fixture' }]), inventory })
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'echo', capability: 'echo',
        arguments: { text: 'observe me' }, serverConfig, timeout_ms: 5000,
        expectation: { require_content: true }, eventSink,
      })
      const events = (await fs.readFile(eventSink, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
      assert.equal(evidence.status, 'SUCCESS')
      assert.ok(events.some((event) => event.name === 'mcp.tool-call.start' && event.attributes.tool === 'echo' && event.trace_id === RUN_ID))
      assert.ok(events.some((event) => event.name === 'mcp.tool-call.result' && event.attributes.status === 'SUCCESS'))
      assert.ok(events.every((event) => event.trace_id === RUN_ID))
      assert.equal(hasSecretLeak(events, ['OCAE_TEST_SECRET_7f3a9c21e5b8']), false)
      await fs.rm(dir, { recursive: true, force: true })
    })

    it('failure path emits a failure event with failure class', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-mcp-fail-'))
      const eventSink = path.join(dir, 'events.jsonl')
      const inventory = await fixtureInventory({ tools: ['deny'] })
      const grant = resolveToolGrant({ profile: baseProfile([{ name: 'deny', server: 'fixture' }]), inventory })
      const evidence = await executeMcpTool({
        run_id: RUN_ID, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'fixture', tool: 'deny', capability: 'deny',
        arguments: {}, serverConfig, timeout_ms: 5000, expectation: {}, eventSink,
      })
      const events = (await fs.readFile(eventSink, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
      assert.equal(evidence.failure_class, 'MCP_PERMISSION_DENIED')
      assert.ok(events.some((event) => event.name === 'mcp.tool-call.failure' && event.attributes.code === 'MCP_PERMISSION_DENIED'))
      await fs.rm(dir, { recursive: true, force: true })
    })
  })
})
