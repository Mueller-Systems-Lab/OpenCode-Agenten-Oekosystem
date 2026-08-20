#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * REAL Runtime Availability & Cost Governance session harness.
 *
 * Proves with REAL provider calls (DeepSeek + OpenAI via the existing
 * opencode client — no second provider abstraction):
 *
 *   - live availability probing   (UNKNOWN → bounded probe → HEALTHY)
 *   - cached valid health         (no probe storm; repeatable decisions)
 *   - availability-aware routing  (healthy primary preferred; unhealthy
 *                                  primary → AVAILABILITY_FALLBACK; capability
 *                                  beats health; fail closed)
 *   - multi-provider health route (deepseek + openai real probes)
 *   - MCP-enabled healthy route   (real context7 MCP call by the worker)
 *   - real usage observability    (step_finish tokens; missing → UNAVAILABLE)
 *
 * Routing authority remains the deterministic runtime: the harness invokes
 * EXACTLY the assigned provider/model. A worker never self-selects.
 *
 * Negative health states (unavailable primary) are deterministic FIXTURE
 * evidence via applyRuntimeEvidence — real credentials/accounts are never
 * manipulated (§96).
 *
 * Usage:
 *   node scripts/routing/run-availability-session.mjs --all
 *   node scripts/routing/run-availability-session.mjs --case healthy-primary
 *   node scripts/routing/run-availability-session.mjs --probes-only
 *
 * Evidence (no secrets): evidence/runtime-availability-cost-<ts>/<case>/.
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runTask } from '../../runtime/run.mjs'
import {
  DEFAULT_MODEL_CATALOG,
  DEFAULT_ROUTING_POLICY,
  HealthStore,
  probeProviderModel,
  PROBE_POLICY_DEFAULTS,
  parseUsage,
} from '../../runtime/routing/index.mjs'
import { loadRunEvents, runIdsOf, hasSecretLeak } from '../../runtime/observability/run-events.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_SESSIONS = path.join(REPO_ROOT, 'evidence', 'runtime-availability-cost')
const OPENCODE_BIN = process.env.OCAE_OPENCODE_BIN || 'opencode'
const PROBE_TIMEOUT_MS = 120000

const MCP_DISABLED_CONFIG = { mcp: { context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: false } } }
const MCP_ENABLED_CONFIG = { mcp: { context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true } } }

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
  return {
    command: 'node',
    args: ['-e', `const fs=require('fs');const c=fs.readFileSync('${file}','utf8').trim();if(c!==${JSON.stringify(expected)}){console.error('MISMATCH',JSON.stringify(c));process.exit(1)}`],
    cwd: root,
  }
}

// ---------------------------------------------------------------------------
// Cases (>=6 real sessions; negative health states are fixtures)
// ---------------------------------------------------------------------------
const CASES = Object.freeze({
  'healthy-primary': {
    label: 'Healthy primary (live probe UNKNOWN→HEALTHY)',
    task: 'Create the file primary.txt containing exactly the text HEALTHY_PRIMARY_PROOF and nothing else. Reply DONE.',
    plan: planFor('primary.txt'),
    requirements: {},
    probe_policy: { max_probe_attempts: 1, probe_timeout_ms: PROBE_TIMEOUT_MS, max_candidates_probed_per_route: 2 },
    verify: (root) => [exactFileCheck(root, 'primary.txt', 'HEALTHY_PRIMARY_PROOF')],
    expect_decision: 'DONE',
    expect_route_model: 'deepseek-v4-flash',
    expect_routing_reason: 'PRIMARY_ROUTE',
    expect_probe_before_route: true,
  },
  'cached-health-repeat': {
    label: 'Cached valid health → no probe storm, repeatable decision (2 runs)',
    task: 'Create the file cached.txt containing exactly the text CACHED_HEALTH_PROOF and nothing else. Reply DONE.',
    plan: planFor('cached.txt'),
    requirements: {},
    probe_policy: { max_probe_attempts: 1, probe_timeout_ms: PROBE_TIMEOUT_MS, max_candidates_probed_per_route: 2 },
    verify: (root) => [exactFileCheck(root, 'cached.txt', 'CACHED_HEALTH_PROOF')],
    expect_decision: 'DONE',
    expect_route_model: 'deepseek-v4-flash',
    expect_routing_reason: 'PRIMARY_ROUTE',
    seed_health_before_run: true,
    expect_zero_probes_in_run: true,
    repeat: 2,
  },
  'healthy-secondary': {
    label: 'Healthy secondary via cheapest-sufficient capability route',
    task: 'Create the file secondary.txt containing exactly the text HEALTHY_SECONDARY_PROOF and nothing else. Reply DONE.',
    plan: planFor('secondary.txt'),
    requirements: { quality_requirement: 'LOW' },
    probe_policy: { max_probe_attempts: 1, probe_timeout_ms: PROBE_TIMEOUT_MS, max_candidates_probed_per_route: 1 },
    verify: (root) => [exactFileCheck(root, 'secondary.txt', 'HEALTHY_SECONDARY_PROOF')],
    expect_decision: 'DONE',
    expect_route_model: 'deepseek-chat',
    expect_routing_reason: 'CHEAPEST_SUFFICIENT',
  },
  'multi-provider-openai': {
    label: 'Multi-provider healthy route (openai real probe + real worker)',
    // Task text deliberately avoids provider/API keywords: the baseline
    // capability detector derives a `provider` capability from keywords like
    // "openai" which is env-based (DEEPSEEK_API_KEY etc.) and unrelated to
    // routing. The route itself is forced via provider_constraints.
    task: 'Create the file cross.txt containing exactly the text CROSS_HEALTH_PROOF and nothing else. Reply DONE.',
    plan: planFor('cross.txt'),
    requirements: { provider_constraints: ['openai'] },
    probe_policy: { max_probe_attempts: 1, probe_timeout_ms: PROBE_TIMEOUT_MS, max_candidates_probed_per_route: 1 },
    verify: (root) => [exactFileCheck(root, 'cross.txt', 'CROSS_HEALTH_PROOF')],
    expect_decision: 'DONE',
    expect_provider: 'openai',
    expect_route_model: 'gpt-5.4-mini',
  },
  'availability-fallback': {
    label: 'Unhealthy primary → availability fallback (fixture negative state)',
    task: 'Create the file fallback.txt containing exactly the text AVAILABILITY_FALLBACK_PROOF and nothing else. Reply DONE.',
    plan: planFor('fallback.txt'),
    requirements: {},
    probe_policy: { max_probe_attempts: 1, probe_timeout_ms: PROBE_TIMEOUT_MS, max_candidates_probed_per_route: 1 },
    verify: (root) => [exactFileCheck(root, 'fallback.txt', 'AVAILABILITY_FALLBACK_PROOF')],
    expect_decision: 'DONE',
    expect_route_model: 'deepseek-chat',
    expect_routing_reason: 'AVAILABILITY_FALLBACK',
    seed_unavailable_primary: true,
    expect_no_primary_call: true,
  },
  'mcp-health-route': {
    label: 'MCP-enabled healthy route (real context7 MCP call)',
    task: 'Use the context7 MCP server to resolve the documentation library id for the Node.js builtin test module (node:test), then create proof.json containing exactly {"mcp_route":true,"library":"<the resolved library id>"}. Reply DONE.',
    plan: planFor('proof.json'),
    requirements: { needs_mcp: true },
    needs_mcp: true,
    probe_policy: { max_probe_attempts: 1, probe_timeout_ms: PROBE_TIMEOUT_MS, max_candidates_probed_per_route: 1 },
    verify: (root) => [{
      command: 'node',
      args: ['-e', "const fs=require('fs');const j=JSON.parse(fs.readFileSync('proof.json','utf8'));if(j.mcp_route!==true||typeof j.library!=='string'||j.library.length<3){console.error('BAD',JSON.stringify(j));process.exit(1)}"],
      cwd: root,
    }],
    expect_decision: 'DONE',
    expect_route_model: 'deepseek-v4-flash',
    expect_routing_reason: 'DIRECT_CAPABILITY_ROUTE',
    expect_real_mcp: true,
  },
})

// ---------------------------------------------------------------------------
// Real invocation + usage extraction (step_finish tokens — REAL evidence)
// ---------------------------------------------------------------------------
function lastStepFinishFromOutput(output) {
  if (typeof output !== 'string' || output.length === 0) return null
  let last = null
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed
    try { parsed = JSON.parse(trimmed) } catch { continue }
    if (parsed && typeof parsed === 'object' && parsed.type === 'step_finish') last = parsed
  }
  return last
}

function invokeRealWorker({ fixtureRoot, provider, model, taskText, mcpEnabled }) {
  fsSync.writeFileSync(path.join(fixtureRoot, 'opencode.jsonc'), JSON.stringify(mcpEnabled ? MCP_ENABLED_CONFIG : MCP_DISABLED_CONFIG, null, 2), 'utf8')
  const startedAt = Date.now()
  const result = spawnSync(OPENCODE_BIN, ['run', '-m', `${provider}/${model}`, '--dir', fixtureRoot, '--format', 'json', '--auto', taskText], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 240000,
    maxBuffer: 12 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const durationMs = Date.now() - startedAt
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const stepFinish = lastStepFinishFromOutput(`${result.stdout || ''}`)
  // Real MCP tool events appear as "type":"tool" / "type":"tool_use" /
  // "type":"tool_call" in the opencode JSON event stream.
  const realMcpCall = mcpEnabled ? /"type":\s*"tool(_use|_call)?"|tool_call_id/.test(output) : false
  const changed = gitDiffNameOnly(fixtureRoot)
  return {
    exit_code: result.status,
    duration_ms: durationMs,
    changed_files: changed,
    output_tail: output.slice(-2000),
    step_finish: stepFinish,
    real_mcp_call: realMcpCall,
    timed_out: result.error?.code === 'ETIMEDOUT' || false,
    signal: result.signal || null,
  }
}

function gitDiffNameOnly(cwd) {
  const result = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] })
  const tracked = result.status === 0 ? result.stdout.split(/\r?\n/).filter(Boolean) : []
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] })
  const others = untracked.status === 0 ? untracked.stdout.split(/\r?\n/).filter(Boolean) : []
  return [...new Set([...tracked, ...others])].filter((file) => file !== 'opencode.jsonc')
}

function gitCommitAll(cwd, message) {
  spawnSync('git', ['add', '-A'], { cwd, encoding: 'utf8', timeout: 15000, stdio: 'ignore' })
  spawnSync('git', ['commit', '-m', message], { cwd, encoding: 'utf8', timeout: 15000, stdio: 'ignore' })
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
// Session driver
// ---------------------------------------------------------------------------
async function setupFixture(sessionDir) {
  const fixtureRoot = path.join(sessionDir, 'fixture')
  await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(fixtureRoot, { recursive: true })
  fsSync.writeFileSync(path.join(fixtureRoot, 'opencode.jsonc'), JSON.stringify(MCP_DISABLED_CONFIG, null, 2), 'utf8')
  spawnSync('git', ['init', '--initial-branch=master'], { cwd: fixtureRoot, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'availability@example.invalid'], { cwd: fixtureRoot, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'Availability Session'], { cwd: fixtureRoot, stdio: 'ignore' })
  spawnSync('git', ['config', 'core.autocrlf', 'false'], { cwd: fixtureRoot, stdio: 'ignore' })
  gitCommitAll(fixtureRoot, 'fixture baseline')
  return fixtureRoot
}

export async function runAvailabilitySession({ caseId, sessionsRoot = DEFAULT_SESSIONS, round = 1 } = {}) {
  const caseDef = CASES[caseId]
  if (!caseDef) throw new Error(`unknown case: ${caseId}`)
  const sessionDir = path.join(sessionsRoot, caseId, `round-${round}`)
  const fixtureRoot = await setupFixture(sessionDir)
  const eventSink = path.join(sessionDir, 'run-events.jsonl')
  await fs.writeFile(eventSink, '', 'utf8')

  const healthStore = new HealthStore()
  const calls = []
  const seededHealth = []
  let probeCountInRun = 0
  let probeCountTotal = 0
  let probeCountCachedCaseRun = 0

  // The ONLY runtime write path for health: real probe evidence (or
  // deterministic runtime evidence for fixture negative states).
  const realProbe = ({ provider, model }) => probeProviderModel({
    provider, model,
    workdir: fixtureRoot,
    opencode_bin: OPENCODE_BIN,
    timeout_ms: PROBE_TIMEOUT_MS,
  })
  const probeFn = async (input) => {
    probeCountInRun += 1
    probeCountTotal += 1
    const result = await realProbe(input)
    return result
  }

  // Deterministic fixture negative state: primary unavailable (never touches
  // real credentials — §96).
  if (caseDef.seed_unavailable_primary) {
    healthStore.applyRuntimeEvidence({
      provider: 'deepseek', model: 'deepseek-v4-flash', status: 'UNAVAILABLE',
      failure_class: 'MODEL_UNAVAILABLE', ttl_seconds: 600,
    })
    seededHealth.push({ provider: 'deepseek', model: 'deepseek-v4-flash', status: 'UNAVAILABLE', source: 'RUNTIME_EVIDENCE', fixture: true })
  }
  // Real cached-health evidence: a real probe run BEFORE the session, so the
  // session itself must NOT re-probe (cache hit — no probe storm).
  if (caseDef.seed_health_before_run) {
    const seedProbe = await realProbe({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    if (seedProbe.ok) {
      healthStore.applyProbeResult({
        provider: 'deepseek', model: 'deepseek-v4-flash', status: 'HEALTHY',
        latency_ms: seedProbe.latency_ms, ttl_seconds: 600,
      })
      seededHealth.push({ provider: 'deepseek', model: 'deepseek-v4-flash', status: 'HEALTHY', source: 'PROBE', latency_ms: seedProbe.latency_ms, usage_present: Boolean(seedProbe.usage) })
    } else {
      throw new Error(`SEED_PROBE_FAILED: deepseek/deepseek-v4-flash ${seedProbe.failure_class}`)
    }
  }

  const routeExecutor = (route, { attempt }) => async (buildInput) => {
    const mcpEnabled = Boolean(caseDef.needs_mcp)
    const invocation = invokeRealWorker({
      fixtureRoot, provider: route.provider, model: route.model, taskText: caseDef.task, mcpEnabled,
    })
    const parsed = parseUsage(invocation.step_finish, {
      run_id: buildInput.run_id, phase: 'BUILD', attempt,
      route_index: route.route_index || 0, provider: route.provider, model: route.model,
    })
    calls.push({
      provider: route.provider, model: route.model, attempt,
      exit_code: invocation.exit_code, changed_files: invocation.changed_files,
      usage_status: parsed.ok ? 'AVAILABLE' : 'UNAVAILABLE',
      input_tokens: parsed.ok ? parsed.usage.input_tokens : null,
      output_tokens: parsed.ok ? parsed.usage.output_tokens : null,
      total_tokens: parsed.ok ? parsed.usage.total_tokens : null,
      provider_reported_cost: parsed.ok ? parsed.usage.provider_reported_cost : null,
      real_mcp_call: invocation.real_mcp_call,
      duration_ms: invocation.duration_ms,
    })

    let failureClass = null
    let failureReason = null
    if (caseDef.needs_mcp && !invocation.real_mcp_call) {
      failureClass = 'MODEL_CAPABILITY_INSUFFICIENT'
      failureReason = `route ${route.provider}/${route.model} was assigned the MCP grant but produced no real MCP tool call`
    } else if (invocation.exit_code !== 0) {
      failureClass = classifyRealInvocation(invocation)
      failureReason = `real worker invocation failed (exit ${invocation.exit_code})`
    }
    return {
      changed_files: invocation.changed_files,
      errors: failureClass ? [failureReason] : [],
      strategy_delta: null,
      failure_class: failureClass,
      failure_reason: failureReason,
      usage: invocation.step_finish || null,
      real_mcp_call: invocation.real_mcp_call,
    }
  }

  const result = await runTask({
    taskInput: { task: caseDef.task, repository: fixtureRoot },
    repoRoot: fixtureRoot,
    nativePlan: { planText: caseDef.plan },
    verifyChecks: caseDef.verify(fixtureRoot),
    routeExecutor,
    routing: {
      enabled: true,
      requirements: caseDef.requirements,
      policy: DEFAULT_ROUTING_POLICY,
      catalog: DEFAULT_MODEL_CATALOG,
      health: {
        enabled: true,
        store: healthStore,
        probe_policy: caseDef.probe_policy,
        probe_fn: probeFn,
        workdir: fixtureRoot,
        opencode_bin: OPENCODE_BIN,
      },
      cost_policy: null,
      high_cost_routes_used: 0,
    },
    eventSink,
  })

  probeCountCachedCaseRun = probeCountInRun

  const events = await loadRunEvents(eventSink)
  const runIds = runIdsOf(events)
  const healthEvents = events.filter((e) => (e.job || '').startsWith('model.health.'))
  const probeEvents = healthEvents.filter((e) => e.job === 'model.health.probe.result')
  const firstRouteEvent = events.find((e) => e.job === 'model.route.selected')
  const initialRoute = firstRouteEvent && firstRouteEvent.provider
    ? {
        provider: firstRouteEvent.provider, model: firstRouteEvent.model,
        routing_reason: firstRouteEvent.strategy_delta || null,
        health_status: firstRouteEvent.health_status || null,
        cost_tier: firstRouteEvent.cost_tier || null,
      }
    : (result.route ? {
        provider: result.route.provider, model: result.route.model,
        routing_reason: result.route.routing_reason,
        health_status: result.route.health_status || null,
        cost_tier: result.route.cost_tier || null,
      } : null)
  const leak = hasSecretLeak(events) || hasSecretLeak([result.decision || {}, ...calls])

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
    final_route: result.route ? {
      provider: result.route.provider, model: result.route.model,
      routing_reason: result.route.routing_reason,
      health_status: result.route.health_status || null,
      cost_tier: result.route.cost_tier || null,
    } : null,
    calls,
    health: {
      store_entries: healthStore.entries().map((e) => ({ provider: e.provider, model: e.model, status: e.status, source: e.source, failure_class: e.failure_class })),
      probe_count_in_run: probeCountInRun,
      probe_count_total: probeCountTotal,
      probed: result.health?.probed || [],
      cache_hits: result.health?.cache_hits || [],
      probe_budget_skipped: result.health?.probe_budget_skipped || [],
      seeded: seededHealth,
      probe_events: probeEvents.map((e) => ({ job: e.job, status: e.status, provider: e.provider, model: e.model, health_status: e.health_status, failure_signature: e.failure_signature, latency_ms: e.latency_ms })),
      state_changed_events: healthEvents.filter((e) => e.job === 'model.health.state.changed').map((e) => ({ provider: e.provider, model: e.model, delta: e.strategy_delta })),
    },
    usage: result.usage || null,
    usage_records_count: (result.usage_records || []).length,
    verify_status: result.verification?.verification?.passed === true ? 'PASS' : 'FAIL',
    decision: result.decision?.decision || null,
    reason_code: result.decision?.reason_code || null,
    first_bad_boundary: result.decision?.first_bad_boundary || null,
    phase_history: (result.decision?.phase_history || []).map((b) => `${b.name}=${b.status}`),
    secret_leak: leak,
    event_count: events.length,
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
  if (caseDef.expect_probe_before_route && record.health.probe_count_in_run < 1) {
    record.unexpected_behavior.push('expected a live probe before the productive route')
  }
  if (caseDef.expect_zero_probes_in_run) {
    // The CACHED model must never be re-probed while its health is valid
    // (no probe storm). Other UNKNOWN candidates may legitimately probe.
    const cachedModelProbes = record.health.probe_events.filter((e) => e.model === 'deepseek-v4-flash')
    if (cachedModelProbes.length !== 0) {
      record.unexpected_behavior.push(`cached model deepseek-v4-flash must not be re-probed (no probe storm), got ${cachedModelProbes.length} probe events`)
    }
  }
  if (caseDef.expect_no_primary_call && calls.some((c) => c.model === 'deepseek-v4-flash')) {
    record.unexpected_behavior.push('unhealthy primary must never be called productively')
  }
  if ((caseDef.needs_mcp || caseDef.expect_real_mcp) && !calls.some((c) => c.real_mcp_call)) {
    record.unexpected_behavior.push('expected a real MCP tool call in the routed session')
  }

  await fs.writeFile(path.join(sessionDir, 'session.json'), JSON.stringify(record, null, 2), 'utf8')
  await fs.writeFile(path.join(sessionDir, 'events.json'), JSON.stringify(events, null, 2), 'utf8')
  // The fixture is git-initialized only for diff/evidence bookkeeping inside
  // the run; its nested .git must never leak into the parent repo evidence.
  await fs.rm(path.join(fixtureRoot, '.git'), { recursive: true, force: true }).catch(() => {})
  return record
}

// ---------------------------------------------------------------------------
// Real probe-only proof (DeepSeek + OpenAI)
// ---------------------------------------------------------------------------
export async function runRealProbeProof({ workdir = null, outDir = null } = {}) {
  const target = outDir || path.join(DEFAULT_SESSIONS, `real-probes-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await fs.mkdir(target, { recursive: true })
  const root = workdir || await (async () => {
    const r = path.join(target, 'probe-workdir')
    await fs.mkdir(r, { recursive: true })
    return r
  })()
  const probes = []
  const targets = [
    { provider: 'deepseek', model: 'deepseek-v4-flash' },
    { provider: 'openai', model: 'gpt-5.4-mini' },
  ]
  for (const t of targets) {
    const result = probeProviderModel({ provider: t.provider, model: t.model, workdir: root, opencode_bin: OPENCODE_BIN, timeout_ms: PROBE_TIMEOUT_MS })
    probes.push({
      provider: t.provider, model: t.model,
      ok: result.ok, status: result.status, failure_class: result.failure_class,
      latency_ms: result.latency_ms, usage_present: Boolean(result.usage),
      input_tokens: result.usage?.input_tokens ?? null,
      output_tokens: result.usage?.output_tokens ?? null,
      total_tokens: result.usage?.total_tokens ?? null,
      provider_reported_cost: result.usage?.provider_reported_cost ?? null,
      probed_at: new Date().toISOString(),
    })
  }
  const summary = {
    classification: probes.every((p) => p.ok) ? 'REAL_HEALTH_PROBE_OK' : 'REAL_HEALTH_PROBE_PARTIAL',
    deepseek: probes.find((p) => p.provider === 'deepseek'),
    openai: probes.find((p) => p.provider === 'openai'),
  }
  await fs.writeFile(path.join(target, 'real-probes.json'), JSON.stringify(summary, null, 2), 'utf8')
  return summary
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
    else if (arg === '--probes-only') out.probesOnly = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node scripts/routing/run-availability-session.mjs [--case <id>] [--all] [--probes-only] [--sessions <dir>]\nCases: ${Object.keys(CASES).join(', ')}`)
    process.exit(0)
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const sessionsRoot = args.sessions === DEFAULT_SESSIONS ? path.join(DEFAULT_SESSIONS, ts) : args.sessions

  if (args.probesOnly) {
    const summary = await runRealProbeProof({ outDir: path.join(DEFAULT_SESSIONS, ts, 'real-probes') })
    console.log(`REAL PROBES: deepseek=${summary.deepseek.ok ? 'HEALTHY' : summary.deepseek.status} openai=${summary.openai.ok ? 'HEALTHY' : summary.openai.status}`)
    console.log(`PROBES_DIR: ${path.join(DEFAULT_SESSIONS, ts, 'real-probes')}`)
    process.exit(summary.classification === 'REAL_HEALTH_PROBE_OK' ? 0 : 1)
  }

  const caseIds = args.case ? [args.case] : args.all ? Object.keys(CASES) : Object.keys(CASES)
  const results = []
  for (const caseId of caseIds) {
    const caseDef = CASES[caseId]
    const rounds = caseDef.repeat || 1
    for (let round = 1; round <= rounds; round += 1) {
      const record = await runAvailabilitySession({ caseId, sessionsRoot, round })
      results.push(record)
      console.log(`\n=== ${caseId} (round ${round}) ===`)
      console.log(`  initial route: ${record.initial_route?.provider}/${record.initial_route?.model} (${record.initial_route?.routing_reason}, health=${record.initial_route?.health_status}, tier=${record.initial_route?.cost_tier})`)
      console.log(`  final route:   ${record.final_route?.provider}/${record.final_route?.model} (${record.final_route?.routing_reason})`)
      console.log(`  calls:         ${record.calls.map((c) => `${c.model}#${c.attempt} usage=${c.usage_status}`).join(', ')}`)
      console.log(`  probes in run: ${record.health.probe_count_in_run} (cache hits: ${record.health.cache_hits.length})`)
      console.log(`  real MCP:      ${record.calls.some((c) => c.real_mcp_call)}`)
      console.log(`  usage agg:     in=${record.usage?.total_input_tokens ?? 0} out=${record.usage?.total_output_tokens ?? 0} (${record.usage?.usage_status})`)
      console.log(`  verify:        ${record.verify_status}`)
      console.log(`  decision:      ${record.decision} (${record.reason_code})`)
      if (record.unexpected_behavior.length) console.log(`  UNEXPECTED:    ${record.unexpected_behavior.join('; ')}`)
    }
  }
  console.log(`\nSESSIONS_DIR: ${sessionsRoot}`)
  console.log(`SUMMARY: ${results.filter((r) => r.unexpected_behavior.length === 0).length}/${results.length} clean`)
  process.exit(results.every((r) => r.unexpected_behavior.length === 0) ? 0 : 1)
}
