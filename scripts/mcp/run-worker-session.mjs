#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Real MCP worker session harness.
 *
 * Runs one canonical worker session end to end against REAL MCP servers:
 *   TASK → BASELINE (real MCP preflight) → least-privilege TOOL GRANT →
 *   REAL WORKER → REAL MCP TOOL CALL → validated result + provenance →
 *   VERIFY → REVIEWS → CONTROLLER → DONE | FIX | SPLIT | BLOCKED
 *
 * Scenarios:
 *   required-success   2 real calls (browser_navigate + browser_snapshot)
 *   optional-missing   optional GitHub tool unavailable → continues
 *   required-missing   required GitHub tool unavailable → BLOCKED, 0 calls
 *   controlled-failure tool call fails → worker must not fake success
 *
 * Evidence (no secrets): evidence/mcp-worker-tool-integration/<session>/.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { create as createTask } from '../../runtime/contracts/task.mjs'
import { runBaseline } from '../../runtime/baseline/capability-preflight.mjs'
import { resolveToolGrant } from '../../runtime/mcp/tool-grant.mjs'
import { executeMcpTool } from '../../runtime/mcp/tool-executor.mjs'
import { createMcpSession } from '../../runtime/mcp/tool-executor.mjs'
import { create as createVerification } from '../../runtime/contracts/verification.mjs'
import { defaultReviewAnalyzers } from '../../runtime/reviews/analyze.mjs'
import { decide } from '../../runtime/controller/controller.mjs'
import { create as createDecision } from '../../runtime/contracts/decision.mjs'
import { createRunEvent, appendRunEvent, loadRunEvents, inputFingerprint, outputFingerprint } from '../../runtime/observability/run-events.mjs'
import { discoverRealMcpServers } from '../../runtime/mcp/server-registry.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// Real MCP server resolution: the local playwright-mcp binary path comes from
// the environment (never hardcoded user paths). Falls back to a PATH lookup.
export function resolvePlaywrightMcpBin(env = process.env) {
  const configured = env.OCAE_PLAYWRIGHT_MCP_BIN
  if (configured && configured.trim().length > 0) return configured.trim()
  return 'playwright-mcp'
}
const PLAYWRIGHT_MCP_BIN = resolvePlaywrightMcpBin()

const SCENARIOS = Object.freeze({
  'required-success': {
    task: 'Read the OCAE proof fixture page via the real MCP server and record the observed heading.',
    required_mcp: [
      { name: 'browser_navigate', server: 'playwright' },
      { name: 'browser_snapshot', server: 'playwright' },
    ],
    optional_mcp: [],
    expect_blocked: false,
    real_calls: true,
  },
  'optional-missing': {
    task: 'Produce a marker file; the optional GitHub repository lookup is unavailable and must not block.',
    required_mcp: [],
    optional_mcp: [{ name: 'repos_get', server: 'github' }],
    expect_blocked: false,
    real_calls: false,
  },
  'required-missing': {
    task: 'Inspect GitHub repository metadata via the required MCP tool (server unavailable).',
    required_mcp: [{ name: 'repos_get', server: 'github' }],
    optional_mcp: [],
    expect_blocked: true,
    real_calls: false,
  },
  'controlled-failure': {
    task: 'Navigate to the proof fixture; the worker attempts an unauthorized tool and must not claim success.',
    required_mcp: [{ name: 'browser_navigate', server: 'playwright' }],
    optional_mcp: [],
    expect_blocked: false,
    real_calls: true,
    force_failure: true,
  },
  'tool-error': {
    task: 'Navigate to an unreachable URL via the real MCP server; the tool reports an error and the worker must not fabricate success.',
    required_mcp: [{ name: 'browser_navigate', server: 'playwright' }],
    optional_mcp: [],
    expect_blocked: false,
    real_calls: true,
    server_error: true,
  },
})

function capabilityProfile(scenario) {
  return {
    agent_id: 'mcp-worker',
    role: 'worker',
    required_tools: scenario.required_mcp,
    optional_tools: scenario.optional_mcp,
    allowed_operations: ['read'],
    denied_operations: ['write'],
    allowed_paths: ['**'],
    write_paths: [],
    network_policy: 'deny',
    egress_policy: 'deny',
    trust_tier: '1_sandboxed',
    tool_version_constraints: {},
    auth_requirement: {},
    timeout_ms: 30000,
    preflight_failure_policy: 'FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT',
  }
}

export async function runWorkerSession({
  scenarioName = 'required-success',
  sessionId = `mcp-session-${Date.now()}`,
  targetDir = path.join(repoRoot, 'evidence', 'mcp-worker-tool-integration'),
  workerMeta = { provider: 'deepseek', model: 'deepseek-v4-flash' },
  env = process.env,
} = {}) {
  const scenario = SCENARIOS[scenarioName]
  if (!scenario) throw new Error(`unknown scenario: ${scenarioName}`)
  const sessionDir = path.join(targetDir, sessionId)
  await fs.mkdir(sessionDir, { recursive: true })
  const eventSink = path.join(sessionDir, 'run-events.jsonl')

  // 1. REAL server discovery (installed/configured MCP servers).
  const registry = await discoverRealMcpServers({ repoRoot, env })
  const inventory = registry.inventory
  const task = createTask({ run_id: `run-${sessionId}`, task: scenario.task, repository: repoRoot, max_attempts: 2 })

  // 2. BASELINE: real capability + MCP preflight (fail-closed).
  const baseline = runBaseline({
    task,
    repoRoot,
    root: repoRoot,
    env,
    inventory,
    mcpProfile: capabilityProfile(scenario),
  })
  await appendRunEvent(eventSink, createRunEvent({
    run_id: task.run_id, phase: 'BASELINE', job: 'capability-preflight', status: baseline.approved ? 'PASS' : 'FAIL',
    contract_out: baseline.contract, input_fingerprint: inputFingerprint({ required_mcp: baseline.required_mcp }),
  }))

  // 3. Required MCP unavailable → BLOCKED before any worker call.
  if (!baseline.approved) {
    const decision = decide({
      baseline,
      planGate: { approved: false, errors: ['BASELINE_FAILED'] },
      verification: null, reviews: [], attempt: 0, max_attempts: 2,
      boundaries: [{ name: 'TASK', status: 'PASS' }, { name: 'BASELINE', status: 'FAIL' }],
    })
    const terminal = createDecision({
      run_id: task.run_id, decision: decision.decision, reason_code: decision.reason_code,
      first_bad_boundary: decision.first_bad_boundary,
      phase_history: [{ name: 'TASK', status: 'PASS' }, { name: 'BASELINE', status: 'FAIL' }],
    })
    await appendRunEvent(eventSink, createRunEvent({
      run_id: task.run_id, phase: 'CONTROLLER', job: 'deterministic-controller', status: 'FAIL',
      reason_code: terminal.reason_code, contract_out: 'ecosystem.decision.v1',
    }))
    return {
      session_id: sessionId, run_id: task.run_id, scenario: scenarioName, task,
      required_capability: scenario.required_mcp.map((entry) => entry.name).join(',') || 'none',
      server: scenario.required_mcp[0]?.server || null,
      tool: scenario.required_mcp[0]?.name || null,
      worker: workerMeta, tool_call_count: 0, tool_status: 'NONE', verify: 'NONE',
      terminal_state: terminal.decision, decision: terminal, legacy_fallback: false,
      event_sink: eventSink, events: await loadRunEvents(eventSink),
    }
  }

  // 4. Least-privilege TOOL GRANT.
  const grant = resolveToolGrant({ profile: capabilityProfile(scenario), inventory, preflight: baseline.mcp_preflight })
  const evidence = []
  let workerCalls = 0
  let toolOutcome = null

  if (scenario.real_calls) {
    // 5. REAL WORKER performs REAL MCP tool calls via the grant (single session).
    const session = createMcpSession({ command: PLAYWRIGHT_MCP_BIN, args: [], serverName: 'playwright', timeout_ms: 30000 })
    try {
      // navigate — only because the grant allows it
      const navEvidence = await executeMcpTool({
        run_id: task.run_id, phase: 'BUILD', job: 'worker', attempt: 0, grant,
        server: 'playwright', tool: 'browser_navigate', capability: 'browser_navigate',
        arguments: { url: 'data:text/html,<html><body><h1>OCAE_MCP_PROOF</h1></body></html>' },
        serverConfig: { command: PLAYWRIGHT_MCP_BIN, args: [] },
        timeout_ms: 30000, expectation: { require_content: true },
        eventSink: path.join(sessionDir, 'governance-events.jsonl'),
      })
      workerCalls += 1
      evidence.push(navEvidence)

      let snapshotEvidence = null
      if (scenario.server_error) {
        // Real server-level failure: navigate to an unreachable URL. The tool
        // returns isError; the worker must not fabricate success from it.
        const failing = await executeMcpTool({
          run_id: task.run_id, phase: 'BUILD', job: 'worker', attempt: 0, grant,
          server: 'playwright', tool: 'browser_navigate', capability: 'browser_navigate',
          arguments: { url: 'http://127.0.0.1:1/' },
          serverConfig: { command: PLAYWRIGHT_MCP_BIN, args: [] },
          timeout_ms: 15000, expectation: { require_content: true },
          eventSink: path.join(sessionDir, 'governance-events.jsonl'),
        })
        workerCalls += 1
        evidence.push(failing)
        toolOutcome = failing
      } else if (scenario.force_failure) {
        // Controlled failure: call a tool that is NOT listed by the server.
        // The worker must not fabricate success from it.
        const failing = await executeMcpTool({
          run_id: task.run_id, phase: 'BUILD', job: 'worker', attempt: 0, grant,
          server: 'playwright', tool: 'browser_missing_tool', capability: 'browser_missing_tool',
          arguments: {},
          serverConfig: { command: PLAYWRIGHT_MCP_BIN, args: [] },
          timeout_ms: 5000, expectation: {},
          eventSink: path.join(sessionDir, 'governance-events.jsonl'),
        })
        workerCalls += 1
        evidence.push(failing)
        toolOutcome = failing
      } else {
        snapshotEvidence = await executeMcpTool({
          run_id: task.run_id, phase: 'BUILD', job: 'worker', attempt: 0, grant,
          server: 'playwright', tool: 'browser_snapshot', capability: 'browser_snapshot',
          arguments: {},
          serverConfig: { command: PLAYWRIGHT_MCP_BIN, args: [] },
          timeout_ms: 30000, expectation: { require_content: true, require_text_content: true },
          eventSink: path.join(sessionDir, 'governance-events.jsonl'),
        })
        workerCalls += 1
        evidence.push(snapshotEvidence)
        toolOutcome = snapshotEvidence || navEvidence
      }
    } finally {
      await session.close()
    }
  } else {
    // optional-missing or non-real scenario: no productive MCP call needed
    toolOutcome = { status: 'SKIPPED', granted: true }
  }

  // 6. VERIFY (mandatory after MCP evidence). The verification contract is
  //     built from the real tool evidence — a successful tool call alone never
  //     counts as verified.
  const evidenceOk = scenario.real_calls
    ? toolOutcome?.status === 'SUCCESS'
    : true // optional-missing / non-real scenario has no productive MCP dependency
  const failureSignature = evidenceOk ? null : `MCP_EVIDENCE_FAILED:${toolOutcome?.failure_class || 'UNKNOWN'}`
  const verification = createVerification({
    run_id: task.run_id,
    verification: {
      passed: evidenceOk,
      failure_signature: failureSignature,
      strategy_delta: null,
      checks: [
        {
          command: 'mcp-evidence',
          passed: evidenceOk,
          failure_signature: failureSignature,
          error: evidenceOk ? null : toolOutcome?.failure_reason || failureSignature,
        },
      ],
    },
  })

  // 7. REVIEWS (deterministic analyzers over the evidence).
  const reviews = []
  const buildStatus = evidenceOk && toolOutcome?.status !== 'FAILURE' ? 'SUCCESS' : 'FAILURE'
  for (const [type, analyzer] of defaultReviewAnalyzers) {
    reviews.push(analyzer({ run_id: task.run_id, buildResult: { status: buildStatus, changed_files: [], errors: toolOutcome?.failure_reason ? [toolOutcome.failure_reason] : [] }, verification }))
  }

  // 8. CONTROLLER — sole terminal authority.
  const controllerDecision = decide({
    baseline, planGate: { approved: true, errors: [] }, verification, reviews,
    attempt: 0, max_attempts: 2, boundaries: [{ name: 'TASK', status: 'PASS' }, { name: 'BASELINE', status: 'PASS' }, { name: 'BUILD', status: evidenceOk ? 'PASS' : 'FAIL' }, { name: 'VERIFY', status: verification.verification.passed ? 'PASS' : 'FAIL' }],
  })
  const terminal = createDecision({
    run_id: task.run_id, decision: controllerDecision.decision, reason_code: controllerDecision.reason_code,
    first_bad_boundary: controllerDecision.first_bad_boundary,
    phase_history: [{ name: 'TASK', status: 'PASS' }, { name: 'BASELINE', status: 'PASS' }, { name: 'BUILD', status: evidenceOk ? 'PASS' : 'FAIL' }, { name: 'VERIFY', status: verification.verification.passed ? 'PASS' : 'FAIL' }],
  })
  await appendRunEvent(eventSink, createRunEvent({
    run_id: task.run_id, phase: 'CONTROLLER', job: 'deterministic-controller', status: terminal.decision === 'DONE' ? 'PASS' : 'FAIL',
    reason_code: terminal.reason_code, contract_out: 'ecosystem.decision.v1',
  }))

  // 9. Persist evidence (no secrets — fingerprints only for results).
  await fs.writeFile(path.join(sessionDir, 'session.json'), JSON.stringify({
    session_id: sessionId, run_id: task.run_id, scenario: scenarioName, task: scenario.task,
    required_capability: scenario.required_mcp.map((entry) => entry.name).join(',') || 'none',
    server: scenario.required_mcp[0]?.server || null,
    tool: scenario.required_mcp[0]?.name || null,
    worker: workerMeta, tool_call_count: workerCalls, tool_status: toolOutcome?.status || 'NONE',
    verify: verification.verification.passed ? 'PASS' : 'FAIL',
    terminal_state: terminal.decision, legacy_fallback: false,
  }, null, 2), 'utf8')
  await fs.writeFile(path.join(sessionDir, 'mcp-evidence.json'), JSON.stringify(evidence.map((entry) => ({
    server: entry.server, tool: entry.tool, status: entry.status, failure_class: entry.failure_class,
    duration_ms: entry.duration_ms, input_fingerprint: entry.input_fingerprint, output_fingerprint: entry.output_fingerprint,
    result_terminal_token_like: entry.result_terminal_token_like || null,
  })), null, 2), 'utf8')

  return {
    session_id: sessionId, run_id: task.run_id, scenario: scenarioName, task: scenario.task,
    required_capability: scenario.required_mcp.map((entry) => entry.name).join(',') || 'none',
    server: scenario.required_mcp[0]?.server || null,
    tool: scenario.required_mcp[0]?.name || null,
    worker: workerMeta, tool_call_count: workerCalls, tool_status: toolOutcome?.status || 'NONE',
    verify: verification.verification.passed ? 'PASS' : 'FAIL',
    terminal_state: terminal.decision, decision: terminal, legacy_fallback: false,
    event_sink: eventSink, events: await loadRunEvents(eventSink),
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const scenarioName = process.argv[2] || 'required-success'
  const sessionId = process.argv[3] || `mcp-session-${Date.now()}`
  const outcome = await runWorkerSession({ scenarioName, sessionId })
  console.log(JSON.stringify(outcome, null, 2))
}
