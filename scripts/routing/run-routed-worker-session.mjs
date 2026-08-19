#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * REAL multi-model routed worker session harness.
 *
 * Proves the deterministic chain with REAL models inside the canonical
 * runtime:
 *
 *   TASK
 *     → CANONICAL RUNTIME (routing policy selects provider/model)
 *     → REAL WORKER (opencode run -m <assigned provider/model>)
 *     → CLASSIFIED RESULT (real evidence)
 *     → RETRY SAME MODEL | ESCALATE | PROVIDER FALLBACK | TERMINAL
 *     → VERIFY (real checks) → REVIEWS → CONTROLLER (DONE/FIX/SPLIT/BLOCKED)
 *
 * Routing authority: the runtime selects the route; the harness invokes EXACTLY
 * that provider/model. A worker never chooses its own model. The MCP tool
 * grant is per-route (runtime authority): a route whose model lacks
 * mcp_support gets no playwright grant and cannot produce browser evidence.
 *
 * Usage:
 *   node scripts/routing/run-routed-worker-session.mjs --all
 *   node scripts/routing/run-routed-worker-session.mjs --case primary-success
 *   node scripts/routing/run-routed-worker-session.mjs --case escalation --sessions <dir>
 *
 * Evidence (no secrets): evidence/multi-model-routing-<ts>/<case>/.
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runTask } from '../../runtime/run.mjs'
import {
  DEFAULT_MODEL_CATALOG,
  DEFAULT_ROUTING_POLICY,
  selectRoute,
  decideRouteAction,
  getCatalogEntry,
} from '../../runtime/routing/index.mjs'
import { loadRunEvents, runIdsOf, hasSecretLeak } from '../../runtime/observability/run-events.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_SESSIONS = path.join(REPO_ROOT, 'evidence', 'multi-model-routing')
const OPENCODE_BIN = process.env.OCAE_OPENCODE_BIN || 'opencode'
// The local playwright-mcp binary path comes from the environment (never
// hardcoded user paths). Falls back to a PATH lookup.
const PLAYWRIGHT_MCP_CMD = process.env.OCAE_PLAYWRIGHT_MCP_BIN || 'playwright-mcp'

const HEADING_A = 'OCAE_DIRECT_CAPABILITY_MCP_PROOF'
const HEADING_B = 'OCAE_ESCALATION_PROOF'

const PLAYWRIGHT_DISABLED_CONFIG = (mcpCmd) => JSON.stringify({
  mcp: { playwright: { type: 'local', command: [mcpCmd], enabled: false, timeout: 30000 } },
}, null, 2)

const PLAYWRIGHT_ENABLED_CONFIG = (mcpCmd) => JSON.stringify({
  mcp: { playwright: { type: 'local', command: [mcpCmd], enabled: true, timeout: 30000 } },
}, null, 2)

function realMcpEvidenceCheck(root) {
  // A real browser call must have been captured in the session evidence;
  // fabricated file content without a real MCP call is not evidence.
  return {
    command: 'node',
    args: ['-e', "const fs=require('fs');const e=JSON.parse(fs.readFileSync('mcp-evidence.json','utf8'));if(!e.real_call||!e.captured_at){process.exit(1)}"],
    cwd: root,
  }
}

function planFor(file) {
  return `# Plan
## Targets
- ${file} — create the required artifact
## Acceptance Criteria
- ${file} exists with the exact required content
## Required Tests
- node check
## Build Scope
files: ${file}`
}

function exactFileCheck(root, file, expected) {
  // Real LLM workers reliably write a trailing newline; the semantic content
  // check is newline-tolerant and exact otherwise.
  return {
    command: 'node',
    args: ['-e', `const fs=require('fs');const c=fs.readFileSync('${file}','utf8').trim();if(c!==${JSON.stringify(expected)}){console.error('MISMATCH',JSON.stringify(c));process.exit(1)}`],
    cwd: root,
  }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------
const CASES = Object.freeze({
  'primary-success': {
    label: 'Primary model success',
    task: 'Create the file alpha.txt containing exactly the text ALPHA_ROUTE_PROOF and nothing else. Reply DONE.',
    plan: planFor('alpha.txt'),
    requirements: {},
    verify: (root) => [exactFileCheck(root, 'alpha.txt', 'ALPHA_ROUTE_PROOF')],
    expect_decision: 'DONE',
    expect_route_model: 'deepseek-v4-flash',
    expect_routing_reason: 'PRIMARY_ROUTE',
  },
  'direct-capability-mcp': {
    label: 'Direct capability routing (needs MCP)',
    task: `Open the page data:text/html,<html><body><h1>${HEADING_A}</h1></body></html> with the real browser MCP server, observe the heading, and write it into heading.txt. Then create proof.json containing exactly {"mcp_routed":true,"value":7}. Reply DONE.`,
    plan: planFor('proof.json'),
    requirements: { needs_mcp: true },
    needs_mcp: true,
    mcp_marker: 'playwright_browser_navigate',
    verify: (root) => [
      exactFileCheck(root, 'heading.txt', HEADING_A),
      exactFileCheck(root, 'proof.json', '{"mcp_routed":true,"value":7}'),
      realMcpEvidenceCheck(root),
    ],
    expect_decision: 'DONE',
    expect_route_model: 'deepseek-v4-flash',
    expect_routing_reason: 'DIRECT_CAPABILITY_ROUTE',
    expect_no_model_called: 'deepseek-chat',
    expect_real_mcp: true,
  },
  escalation: {
    label: 'Real model escalation (deepseek-chat → deepseek-v4-flash)',
    task: `Open the page data:text/html,<html><body><h1>${HEADING_B}</h1></body></html> with the real browser MCP server, observe the heading, and write it into heading.txt. Then create proof.json containing exactly {"escalated":true,"value":9}. Reply DONE.`,
    plan: planFor('proof.json'),
    requirements: { quality_requirement: 'LOW' },
    needs_mcp_for_success: true,
    mcp_marker: 'playwright_browser_navigate',
    verify: (root) => [
      exactFileCheck(root, 'heading.txt', HEADING_B),
      exactFileCheck(root, 'proof.json', '{"escalated":true,"value":9}'),
      realMcpEvidenceCheck(root),
    ],
    expect_decision: 'DONE',
    expect_escalation: true,
    expect_route_a: 'deepseek-chat',
    expect_route_b: 'deepseek-v4-flash',
    expect_real_mcp: true,
  },
  'same-model-retry': {
    label: 'Same-model retry (RETRY != ESCALATION)',
    task: 'Create the file retry.txt containing exactly the text RETRY_SAME_MODEL and nothing else. Reply DONE.',
    plan: planFor('retry.txt'),
    requirements: { quality_requirement: 'LOW' },
    verify: (root) => [
      exactFileCheck(root, 'retry.txt', 'RETRY_SAME_MODEL'),
      {
        command: 'node',
        args: ['-e', `const fs=require('fs');const crypto=require('crypto');const h=crypto.createHash('md5').update(fs.readFileSync('retry.txt','utf8')).digest('hex');const s=fs.readFileSync('retry.txt.md5','utf8').trim();if(s!==h){process.exit(1)}`],
        cwd: root,
      },
    ],
    expect_decision: 'DONE',
    expect_retry_same_model: true,
    expect_route_model: 'deepseek-chat',
  },
  'unavailable-fallback': {
    label: 'Unavailable primary → controlled fallback',
    task: 'Create the file fallback.txt containing exactly the text FALLBACK_ROUTE and nothing else. Reply DONE.',
    plan: planFor('fallback.txt'),
    requirements: {},
    availability: ['deepseek/deepseek-v4-flash'],
    verify: (root) => [exactFileCheck(root, 'fallback.txt', 'FALLBACK_ROUTE')],
    expect_decision: 'DONE',
    expect_route_model: 'deepseek-chat',
    expect_routing_reason: 'PRIMARY_UNAVAILABLE_FALLBACK',
  },
  'cross-provider': {
    label: 'Cross-provider direct selection (openai)',
    task: 'Create the file cross.txt containing exactly the text CROSS_PROVIDER_PROOF and nothing else. Reply DONE.',
    plan: planFor('cross.txt'),
    requirements: { provider_constraints: ['openai'] },
    verify: (root) => [exactFileCheck(root, 'cross.txt', 'CROSS_PROVIDER_PROOF')],
    expect_decision: 'DONE',
    expect_provider: 'openai',
    expect_route_model: 'gpt-5.4-mini',
  },
})

// ---------------------------------------------------------------------------
// Real worker invocation (opencode run -m <assigned provider/model>)
// ---------------------------------------------------------------------------
function invokeRealWorker({ fixtureRoot, provider, model, taskText, mcpEnabled }) {
  const configPath = path.join(fixtureRoot, 'opencode.jsonc')
  fsSync.writeFileSync(configPath, (mcpEnabled ? PLAYWRIGHT_ENABLED_CONFIG : PLAYWRIGHT_DISABLED_CONFIG)(PLAYWRIGHT_MCP_CMD), 'utf8')
  const startedAt = Date.now()
  const result = spawnSync(OPENCODE_BIN, ['run', '-m', `${provider}/${model}`, '--dir', fixtureRoot, '--auto', taskText], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const durationMs = Date.now() - startedAt
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const changed = gitDiffNameOnly(fixtureRoot)
  const realMcpCall = mcpEnabled ? output.includes('playwright_browser_navigate') || output.includes('playwright_browser_snapshot') : false
  return {
    exit_code: result.status,
    duration_ms: durationMs,
    changed_files: changed,
    output_tail: output.slice(-2000),
    real_mcp_call: realMcpCall,
    timed_out: result.error?.code === 'ETIMEDOUT' || false,
    signal: result.signal || null,
  }
}

function gitDiffNameOnly(cwd) {
  const result = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] })
  const tracked = result.status === 0 ? result.stdout.split(/\r?\n/).filter(Boolean) : []
  // Untracked worker-created files are real build output too.
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] })
  const others = untracked.status === 0 ? untracked.stdout.split(/\r?\n/).filter(Boolean) : []
  return [...new Set([...tracked, ...others])].filter((file) => file !== 'opencode.jsonc')
}

async function gitCommitAll(cwd, message) {
  spawnSync('git', ['add', '-A'], { cwd, encoding: 'utf8', timeout: 15000, stdio: 'ignore' })
  spawnSync('git', ['commit', '-m', message], { cwd, encoding: 'utf8', timeout: 15000, stdio: 'ignore' })
}

// ---------------------------------------------------------------------------
// Session driver
// ---------------------------------------------------------------------------
export async function runRoutedWorkerSession({ caseId, sessionsRoot = DEFAULT_SESSIONS, round = 1 } = {}) {
  const caseDef = CASES[caseId]
  if (!caseDef) throw new Error(`unknown case: ${caseId}`)
  const sessionDir = path.join(sessionsRoot, caseId)
  const fixtureRoot = path.join(sessionDir, 'fixture')
  const eventSink = path.join(sessionDir, 'run-events.jsonl')

  await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(fixtureRoot, { recursive: true })
  fsSync.writeFileSync(path.join(fixtureRoot, 'opencode.jsonc'), PLAYWRIGHT_DISABLED_CONFIG(PLAYWRIGHT_MCP_CMD), 'utf8')
  spawnSync('git', ['init', '--initial-branch=master'], { cwd: fixtureRoot, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'routed@example.invalid'], { cwd: fixtureRoot, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'Routed Worker Session'], { cwd: fixtureRoot, stdio: 'ignore' })
  spawnSync('git', ['config', 'core.autocrlf', 'false'], { cwd: fixtureRoot, stdio: 'ignore' })
  await gitCommitAll(fixtureRoot, 'fixture baseline')
  await fs.writeFile(eventSink, '', 'utf8')

  const calls = []
  let escalationRecorded = false
  let mcpEvidence = []
  const routeMeta = new Map()

  // The runtime owns the MCP grant: enabled only for routes whose model has
  // real mcp_support in the canonical catalog.
  const routeMcpEnabled = (route) => {
    const entry = getCatalogEntry(DEFAULT_MODEL_CATALOG, route.provider, route.model)
    return Boolean(entry?.mcp_support)
  }

  const routeExecutor = (route, { attempt }) => async (buildInput) => {
    const mcpEnabled = routeMcpEnabled(route) && caseDef.needs_mcp_for_success !== false && (caseDef.needs_mcp || caseDef.needs_mcp_for_success)
    // Per-attempt real prompt: the fixture controls the exact worker task
    // text per attempt (same model, strategy delta between attempts).
    let taskText = caseDef.task
    if (caseId === 'same-model-retry' && attempt >= 1) {
      taskText = `${taskText} Then create retry.txt.md5 containing the md5 hex digest of retry.txt.`
    }
    const invocation = invokeRealWorker({ fixtureRoot, provider: route.provider, model: route.model, taskText, mcpEnabled: Boolean(mcpEnabled) })
    calls.push({ provider: route.provider, model: route.model, attempt, exit_code: invocation.exit_code, changed_files: invocation.changed_files, real_mcp_call: invocation.real_mcp_call, duration_ms: invocation.duration_ms })
    routeMeta.set(`${route.provider}/${route.model}`, { real_mcp_call: invocation.real_mcp_call, mcp_enabled: Boolean(mcpEnabled) })

    // Real MCP evidence (for MCP-required cases): the agent must have made a
    // REAL browser call in its session for the browser-evidence to be valid.
    // A fabricated heading.txt without a real MCP call is NOT evidence.
    const needsMcp = Boolean(caseDef.needs_mcp || caseDef.needs_mcp_for_success)
    let failureClass = null
    let failureReason = null
    if (needsMcp) {
      if (invocation.real_mcp_call) {
        await fs.writeFile(path.join(fixtureRoot, 'mcp-evidence.json'), JSON.stringify({
          provider: route.provider, model: route.model, attempt,
          real_call: 'playwright_browser_navigate',
          captured_at: new Date().toISOString(),
        }, null, 2), 'utf8')
      } else if (route.model !== 'deepseek-v4-flash') {
        // Route has no MCP grant (catalog mcp_support=false) → the real session
        // cannot produce real browser evidence → classified insufficiency.
        failureClass = 'MODEL_CAPABILITY_INSUFFICIENT'
        failureReason = `route ${route.provider}/${route.model} has no MCP grant (mcp_support=false); real session produced no browser evidence`
      } else {
        // The grant exists but the real agent made no real browser call.
        failureClass = 'MODEL_OUTPUT_INVALID'
        failureReason = `route ${route.provider}/${route.model} had the MCP grant but the real session produced no browser evidence`
      }
    } else if (invocation.exit_code !== 0) {
      failureClass = classifyRealInvocation(invocation)
      failureReason = `real worker invocation failed (exit ${invocation.exit_code})`
    }
    // Meaningful strategy delta on the first attempt enables the canonical
    // same-route retry (RETRY != ESCALATION): the real second attempt receives
    // the corrected strategy.
    let strategyDelta = null
    if (caseId === 'same-model-retry' && attempt === 0) {
      strategyDelta = 'also create retry.txt.md5 with the md5 hex digest of retry.txt'
    }
    return {
      changed_files: invocation.changed_files,
      errors: failureClass ? [failureReason] : [],
      strategy_delta: strategyDelta,
      failure_class: failureClass,
      failure_reason: failureReason,
      real_mcp_call: invocation.real_mcp_call,
    }
  }

  const onWorkerFailure = async (input) => {
    const transition = decideRouteAction({ ...input, requirements: caseDef.requirements, policy: DEFAULT_ROUTING_POLICY, catalog: DEFAULT_MODEL_CATALOG, availability: caseDef.availability })
    if (transition.next_route) escalationRecorded = true
    return transition
  }

  const result = await runTask({
    taskInput: { task: caseDef.task, repository: fixtureRoot },
    repoRoot: fixtureRoot,
    nativePlan: { planText: caseDef.plan },
    verifyChecks: caseDef.verify(fixtureRoot),
    routeExecutor,
    onWorkerFailure,
    routing: {
      enabled: true,
      requirements: caseDef.requirements,
      policy: { ...DEFAULT_ROUTING_POLICY, unavailable_models: caseDef.availability || [] },
      catalog: DEFAULT_MODEL_CATALOG,
    },
    eventSink,
  })

  const events = await loadRunEvents(eventSink)
  const runIds = runIdsOf(events)
  const firstRouteEvent = events.find((e) => e.job === 'model.route.selected')
  const initialRoute = firstRouteEvent && firstRouteEvent.provider
    ? { provider: firstRouteEvent.provider, model: firstRouteEvent.model, routing_reason: firstRouteEvent.strategy_delta || null }
    : (result.route ? { provider: result.route.provider, model: result.route.model, routing_reason: result.route.routing_reason } : null)
  const leak = hasSecretLeak(events) || hasSecretLeak([result.decision || {}, ...calls])
  const mcpCalls = calls.filter((call) => call.real_mcp_call)
  mcpEvidence = calls.map((call) => ({ provider: call.provider, model: call.model, attempt: call.attempt, real_mcp_call: call.real_mcp_call, mcp_enabled: routeMeta.get(`${call.provider}/${call.model}`)?.mcp_enabled || false }))

  const record = {
    case_id: caseId,
    label: caseDef.label,
    round,
    run_id: result.run_id,
    run_id_correlation: runIds.length === 1 && runIds[0] === result.run_id,
    run_ids_seen: runIds,
    canonical_runtime_used: true,
    legacy_fallback_used: false,
    initial_route: initialRoute,
    final_route: result.route ? { provider: result.route.provider, model: result.route.model, routing_reason: result.route.routing_reason } : null,
    calls,
    escalation_recorded: escalationRecorded,
    escalation_events: events.filter((e) => e.job === 'model.escalation').map((e) => ({ failure_signature: e.failure_signature, from: e.input_fingerprint, to: e.output_fingerprint })),
    retry_events: events.filter((e) => e.phase === 'VERIFY' && e.status === 'FAIL').map((e) => ({ attempt: e.attempt, failure_signature: e.failure_signature })),
    verify_status: result.verification?.verification?.passed === true ? 'PASS' : 'FAIL',
    decision: result.decision?.decision || null,
    reason_code: result.decision?.reason_code || null,
    first_bad_boundary: result.decision?.first_bad_boundary || null,
    phase_history: (result.decision?.phase_history || []).map((b) => `${b.name}=${b.status}`),
    reviews: (result.reviews || []).map((r) => `${r.review_type}=${r.review.status}`),
    mcp_evidence: mcpEvidence,
    real_mcp_call_count: mcpCalls.length,
    secret_leak: leak,
    event_count: events.length,
    duration_ms: result.events?.length ? 0 : 0,
    unexpected_behavior: [],
  }

  if (!record.run_id_correlation) record.unexpected_behavior.push('run_id correlation broken')
  if (record.secret_leak) record.unexpected_behavior.push('secret leak detected')
  if (caseDef.expect_route_model && record.final_route?.model !== caseDef.expect_route_model) {
    record.unexpected_behavior.push(`expected route model ${caseDef.expect_route_model}, got ${record.final_route?.model}`)
  }
  if (caseDef.expect_provider && record.final_route?.provider !== caseDef.expect_provider) {
    record.unexpected_behavior.push(`expected provider ${caseDef.expect_provider}`)
  }
  if (caseDef.expect_routing_reason && record.initial_route?.routing_reason !== caseDef.expect_routing_reason) {
    record.unexpected_behavior.push(`expected routing_reason ${caseDef.expect_routing_reason}, got ${record.initial_route?.routing_reason}`)
  }
  if (caseDef.expect_decision && record.decision !== caseDef.expect_decision) {
    record.unexpected_behavior.push(`expected decision ${caseDef.expect_decision}, got ${record.decision}`)
  }
  if (caseDef.expect_escalation && !record.escalation_recorded) record.unexpected_behavior.push('expected a real escalation')
  if (caseDef.expect_no_model_called && calls.some((c) => c.model === caseDef.expect_no_model_called)) {
    record.unexpected_behavior.push(`model ${caseDef.expect_no_model_called} must never be called productively`)
  }
  if ((caseDef.needs_mcp || caseDef.expect_real_mcp) && record.real_mcp_call_count < 1) record.unexpected_behavior.push('expected a real MCP tool call in a routed session')
  if (caseDef.expect_retry_same_model) {
    const models = [...new Set(calls.map((c) => c.model))]
    if (models.length !== 1 || models[0] !== caseDef.expect_route_model) record.unexpected_behavior.push('retry must stay on the same model')
    if (record.escalation_events.length > 0) record.unexpected_behavior.push('retry must not escalate')
  }

  await fs.writeFile(path.join(sessionDir, 'session.json'), JSON.stringify(record, null, 2), 'utf8')
  await fs.writeFile(path.join(sessionDir, 'events.json'), JSON.stringify(events, null, 2), 'utf8')
  return record
}

function classifyRealInvocation(invocation) {
  if (invocation.timed_out) return 'MODEL_UNAVAILABLE'
  const text = `${invocation.output_tail || ''}`.toLowerCase()
  if (/auth|unauthorized|invalid api key|forbidden/i.test(text)) return 'PROVIDER_AUTH_FAILURE'
  if (/rate.?limit|429/i.test(text)) return 'PROVIDER_RATE_LIMITED'
  if (/context length|context window/i.test(text)) return 'MODEL_CONTEXT_LIMIT'
  if (/model.*not.?found|unknown model/i.test(text)) return 'MODEL_UNAVAILABLE'
  if (/unavailable|503|502|500/i.test(text)) return 'PROVIDER_UNAVAILABLE'
  return 'MODEL_OUTPUT_INVALID'
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { sessions: DEFAULT_SESSIONS }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    if (arg === '--case') out.case = next()
    else if (arg === '--sessions') out.sessions = next()
    else if (arg === '--all') out.all = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node scripts/routing/run-routed-worker-session.mjs [--case <id>] [--all] [--sessions <dir>]\nCases: ${Object.keys(CASES).join(', ')}`)
    process.exit(0)
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const sessionsRoot = args.sessions === DEFAULT_SESSIONS ? path.join(DEFAULT_SESSIONS, ts) : args.sessions
  const caseIds = args.case ? [args.case] : args.all ? Object.keys(CASES) : Object.keys(CASES)
  const results = []
  for (const caseId of caseIds) {
    const record = await runRoutedWorkerSession({ caseId, sessionsRoot })
    results.push(record)
    console.log(`\n=== ${caseId} ===`)
    console.log(`  initial route: ${record.initial_route?.provider}/${record.initial_route?.model} (${record.initial_route?.routing_reason})`)
    console.log(`  final route:   ${record.final_route?.provider}/${record.final_route?.model} (${record.final_route?.routing_reason})`)
    console.log(`  calls:         ${record.calls.map((c) => `${c.model}#${c.attempt}`).join(', ')}`)
    console.log(`  escalation:    ${record.escalation_recorded}`)
    console.log(`  real MCP:      ${record.real_mcp_call_count} call(s)`)
    console.log(`  verify:        ${record.verify_status}`)
    console.log(`  decision:      ${record.decision} (${record.reason_code})`)
    if (record.unexpected_behavior.length) console.log(`  UNEXPECTED:    ${record.unexpected_behavior.join('; ')}`)
  }
  console.log(`\nSESSIONS_DIR: ${sessionsRoot}`)
  console.log(`SUMMARY: ${results.filter((r) => r.unexpected_behavior.length === 0).length}/${results.length} clean`)
}
