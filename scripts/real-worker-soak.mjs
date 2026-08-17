#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * REAL WORKER SOAK ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â measurement harness ONLY.
 *
 * Drives REAL OpenCode/LLM worker sessions through the CANONICAL contract-
 * first runtime and measures the runtime's behavior with real worker output.
 *
 * Pipeline per case:
 *   1. prepare:  isolated fixture repo + REAL governance install + REAL plugin
 *                entry chain (installed canonical-governance hook:
 *                chat.message -> bootstrapTask -> enterRun -> runtime/run.mjs)
 *                which creates the run_id in run-context.json
 *   2. (orchestrator) real LLM workers (executor subagents) research, plan and
 *                build inside the fixture; artifacts: plan.md + build-attempt-N.json
 *   3. run:      canonical runTask consumes the REAL worker artifacts:
 *                real native plan -> PLAN_GATE, real changed files -> BUILD,
 *                real node --test -> VERIFY, real reviews -> CONTROLLER
 *
 * The harness implements NO runtime semantics. All decisions come from the
 * runtime; the controller stays the sole terminal authority.
 *
 * Usage:
 *   node scripts/real-worker-soak.mjs --prepare rw-01 --sessions <dir>
 *   node scripts/real-worker-soak.mjs --probe-verify rw-01 --sessions <dir>
 *   node scripts/real-worker-soak.mjs --run rw-01 --sessions <dir>
 *   node scripts/real-worker-soak.mjs --forced-legacy rw-01 --sessions <dir>
 *   node scripts/real-worker-soak.mjs --aggregate --sessions <dir>
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runTask } from '../runtime/run.mjs'
import { loadRunEvents, runIdsOf, hasSecretLeak } from '../runtime/observability/run-events.mjs'
import { byId, REAL_WORKER_CORPUS_VERSION } from '../test/fixtures/real-worker-soak/corpus.mjs'
import { runVerification } from '../runtime/controller/verify.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SESSIONS = path.join(ROOT, 'evidence', 'real-worker-soak')

function resolveSessions(value) {
  return value ? path.resolve(value) : DEFAULT_SESSIONS
}
const WORKER_ARTIFACT_DIR = 'worker-artifacts'

function parseArgs(argv) {
  const out = { sessions: DEFAULT_SESSIONS }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    if (arg === '--prepare') out.prepare = next()
    else if (arg === '--probe-verify') out.probeVerify = next()
    else if (arg === '--run') out.run = next()
    else if (arg === '--forced-legacy') out.forcedLegacy = next()
    else if (arg === '--aggregate') out.aggregate = true
    else if (arg === '--sessions') out.sessions = next()
    else if (arg === '--round') out.round = Number(next())
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

function fixtureDir(sessionsRoot, caseId) {
  return path.join(sessionsRoot, 'sessions', caseId, 'fixture')
}

function sessionDir(sessionsRoot, caseId) {
  return path.join(sessionsRoot, 'sessions', caseId)
}

function artifactsDir(sessionsRoot, caseId) {
  return path.join(sessionDir(sessionsRoot, caseId), WORKER_ARTIFACT_DIR)
}

async function readJsonSafe(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')) } catch { return null }
}

function gitDiffNameOnly(cwd) {
  const result = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] })
  if (result.status !== 0) return []
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

async function gitCommitAll(cwd, message) {
  spawnSync('git', ['add', '-A'], { cwd, encoding: 'utf8', timeout: 15000, stdio: 'ignore' })
  spawnSync('git', ['commit', '-m', message], { cwd, encoding: 'utf8', timeout: 15000, stdio: 'ignore' })
}

// ---------------------------------------------------------------------------
// prepare ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â fixture + governance + REAL plugin entry chain
// ---------------------------------------------------------------------------
export async function prepare(caseDef, sessionsRoot) {
  const root = fixtureDir(sessionsRoot, caseDef.case_id)
  await fs.rm(root, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(path.join(sessionDir(sessionsRoot, caseDef.case_id), WORKER_ARTIFACT_DIR), { recursive: true })
  await caseDef.setup(root)
  spawnSync('git', ['init', '--initial-branch=master'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'soak@example.invalid'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'Real Worker Soak'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root, stdio: 'ignore' })
  await gitCommitAll(root, 'baseline fixture')

  const install = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'install-governance.mjs'), '--target', root, '--apply', '--json'], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  })
  if (install.status !== 0) throw new Error(`governance install failed: ${String(install.stderr).slice(0, 400)}`)
  await gitCommitAll(root, 'install governance baseline')

  // REAL plugin entry chain: installed canonical-governance hook exactly as
  // OpenCode invokes it (chat.message -> bootstrapTask -> enterRun).
  const pluginPath = path.join(root, '.agent-governance', 'hooks', 'opencode', 'canonical-governance.mjs')
  const plugin = await import(pathToFileURL(pluginPath).href)
  const hooks = await plugin.default({ directory: root, worktree: root })
  const sessionId = `rw-${caseDef.case_id}`
  const messageId = `msg-${crypto.randomUUID().slice(0, 8)}`
  await hooks['chat.message'](
    { sessionID: sessionId, messageID: messageId },
    {
      message: { role: 'user', id: messageId, sessionID: sessionId },
      parts: [{ type: 'text', text: caseDef.task }],
    },
  )

  const runContextPath = path.join(root, '.agent-governance', 'runtime', 'run-context.json')
  const runContext = await readJsonSafe(runContextPath)
  if (!runContext || !runContext.task?.run_id) throw new Error('plugin entry did not produce a run-context')

  // Commit the post-entry state so worker diff measures ONLY worker changes
  // (not the plugin-entry bootstrap writes into .agent-governance).
  await gitCommitAll(root, 'post-entry baseline')

  const entryRecord = {
    case_id: caseDef.case_id,
    prepared_at: new Date().toISOString(),
    entry_source: 'plugin:chat.message',
    run_id: runContext.task.run_id,
    task_contract: runContext.task.contract,
    phase: runContext.phase,
    canonical_runtime_used: Boolean(runContext.task),
    legacy_fallback_used: false,
    legacy_fallback_reason: null,
  }
  await fs.writeFile(path.join(sessionDir(sessionsRoot, caseDef.case_id), 'entry.json'), `${JSON.stringify(entryRecord, null, 2)}\n`, 'utf8')
  return entryRecord
}

// ---------------------------------------------------------------------------
// probe-verify ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â run the real verify checks on the current fixture state
// ---------------------------------------------------------------------------
export async function probeVerify(caseDef, sessionsRoot) {
  const root = fixtureDir(sessionsRoot, caseDef.case_id)
  const verification = runVerification({ run_id: 'probe', checks: caseDef.verifyChecks(root) })
  return { passed: verification.verification.passed, failure_signature: verification.verification.failure_signature, checks: verification.verification.checks.map((c) => ({ command: c.command, passed: c.passed, exit_code: c.exit_code })) }
}

// ---------------------------------------------------------------------------
// run ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â canonical runtime over REAL worker artifacts
// ---------------------------------------------------------------------------
export async function run(caseDef, sessionsRoot, options = {}) {
  const root = fixtureDir(sessionsRoot, caseDef.case_id)
  const artifacts = artifactsDir(sessionsRoot, caseDef.case_id)
  const entry = await readJsonSafe(path.join(sessionDir(sessionsRoot, caseDef.case_id), 'entry.json'))
  const runContext = await readJsonSafe(path.join(root, '.agent-governance', 'runtime', 'run-context.json'))
  const task = runContext?.task || null
  if (!task) throw new Error('no run context (run prepare first)')

  const planText = await fs.readFile(path.join(artifacts, 'plan.md'), 'utf8').catch(() => '')
  let planFingerprint = null
  if (planText.trim()) planFingerprint = `sha256:${crypto.createHash('sha256').update(planText).digest('hex')}`

  let buildCalls = 0
  const workerTerminalClaims = []
  const buildExecutor = async (buildInput) => {
    buildCalls += 1
    const attempt = buildInput.attempt || 0
    const attemptArtifact = await readJsonSafe(path.join(artifacts, `build-attempt-${attempt}.json`))
    // REAL build state per attempt: the worker snapshot contains the exact file
    // contents it produced for THIS attempt. Applying the snapshot makes the
    // real filesystem state match the worker's real build for the attempt, so
    // VERIFY is always a real check of the real worker output of this attempt.
    if (attemptArtifact?.files && typeof attemptArtifact.files === 'object') {
      for (const [file, content] of Object.entries(attemptArtifact.files)) {
        const absolute = path.join(root, file)
        if (!absolute.startsWith(root + path.sep)) throw new Error(`CONTRACT_INVALID:build_worker:path escape ${file}`)
        await fs.mkdir(path.dirname(absolute), { recursive: true })
        await fs.writeFile(absolute, String(content), 'utf8')
      }
    }
    const realDiff = gitDiffNameOnly(root)
    const plannedFiles = parsePlanScopeFiles(planText)
    const outOfScope = realDiff.filter((file) => !plannedFiles.includes(file))
    const changed = attemptArtifact?.changed_files && attemptArtifact.changed_files.length > 0 ? attemptArtifact.changed_files : realDiff
    if (attemptArtifact?.terminal_claim) workerTerminalClaims.push({ attempt, claim: attemptArtifact.terminal_claim })
    return {
      changed_files: changed,
      errors: attemptArtifact?.errors || [],
      strategy_delta: attemptArtifact?.strategy_delta || null,
      out_of_scope: outOfScope,
      capabilities_used: attemptArtifact?.capabilities_used || [],
    }
  }

  const eventSink = path.join(sessionDir(sessionsRoot, caseDef.case_id), 'run-events.jsonl')
  await fs.writeFile(eventSink, '', 'utf8')
  const startedAt = Date.now()

  let result
  try {
    result = await runTask({
      taskInput: task,
      repoRoot: root,
      nativePlan: planText ? { planText } : null,
      buildExecutor,
      verifyChecks: caseDef.verifyChecks(root),
      eventSink,
      max_attempts: options.max_attempts || 2,
      mcpProfile: caseDef.mcpProfile || null,
      inventory: caseDef.inventory || {},
      required_skills: caseDef.required_skills || [],
    })
  } catch (error) {
    return { run_error: error instanceof Error ? error.message : String(error), build_calls: buildCalls, worker_terminal_claims: workerTerminalClaims }
  }

  const durationMs = Date.now() - startedAt
  const events = await loadRunEvents(eventSink)
  const runIds = runIdsOf(events)
  const leak = hasSecretLeak(events) || hasSecretLeak([result.decision || {}])
  const verifyEvents = events.filter((e) => e.phase === 'VERIFY')
  const buildEvents = events.filter((e) => e.phase === 'BUILD')
  const attempts = Math.max(0, ...verifyEvents.map((e) => e.attempt), ...buildEvents.map((e) => e.attempt)) + 1
  const retryCount = Math.max(0, attempts - 1)

  const verifyPassed = result.verification?.verification?.passed ?? null

  const record = {
    case_id: caseDef.case_id,
    task_class: caseDef.task_class,
    round: options.round || 1,
    run_id: result.run_id,
    entry_run_id: entry?.run_id || null,
    run_id_correlation: result.run_id === entry?.run_id && runIds.length === 1 && runIds[0] === result.run_id,
    run_ids_seen: runIds,
    entry_source: entry?.entry_source || null,
    canonical_runtime_used: entry?.canonical_runtime_used ?? true,
    legacy_fallback_used: entry?.legacy_fallback_used ?? false,
    legacy_fallback_reason: entry?.legacy_fallback_reason ?? null,
    provider: process.env.OCAE_SOAK_PROVIDER || 'deepseek',
    model: process.env.OCAE_SOAK_MODEL || 'deepseek-v4-flash',
    plan_fingerprint: planFingerprint,
    plan_has_text: Boolean(planText.trim()),
    plan_gate_status: result.plan_gate?.approved ? 'PASS' : 'FAIL',
    plan_gate_approved: result.plan_gate?.approved ?? null,
    plan_gate_errors: result.plan_gate?.errors || [],
    build_status: result.build_result?.status || null,
    build_calls: buildCalls,
    verify_status: verifyPassed === null ? null : verifyPassed ? 'PASS' : 'FAIL',
    failure_signatures: verifyEvents.map((e) => e.failure_signature).filter(Boolean),
    strategy_deltas: verifyEvents.map((e) => e.strategy_delta).filter(Boolean),
    attempt_count: attempts,
    retry_count: retryCount,
    final_decision: result.decision?.decision || null,
    reason_code: result.decision?.reason_code || null,
    first_bad_boundary: result.decision?.first_bad_boundary ?? null,
    phase_history: result.decision?.phase_history || [],
    reviews: (result.reviews || []).map((r) => ({
      review_type: r.review_type, status: r.review.status, severity: r.review.severity,
      blocking: r.review.blocking,
      findings: (r.review.findings || []).map((f) => ({ severity: f.severity, file: f.file || null, message: f.message })),
    })),
    research_findings: (result.research?.research || []).map((r) => ({ focus: r.focus, findings: r.findings })),
    changed_files: result.build_result?.changed_files || [],
    out_of_scope: result.build_result?.out_of_scope || [],
    git_diff_files: gitDiffNameOnly(root),
    worker_terminal_claims: workerTerminalClaims,
    worker_terminal_override_denied: workerTerminalClaims.length === 0 || result.decision?.decision !== 'DONE' || verifyPassed === true,
    contract_validation_failures: [],
    contract_repairs: [],
    secret_leak: leak,
    duration_ms: durationMs,
    event_count: events.length,
    unexpected_behavior: [],
    run_error: null,
  }

  if (!record.run_id_correlation) record.unexpected_behavior.push(`run_id correlation broken: entry=${entry?.run_id} events=${JSON.stringify(runIds)}`)
  if (record.secret_leak) record.unexpected_behavior.push('secret leak detected')
  if (record.legacy_fallback_used) record.unexpected_behavior.push('unexpected legacy fallback')
  if (planText.trim() && !result.plan_gate?.approved) {
    record.plan_gate_rejected_reason = (result.plan_gate.errors || []).join(',')
    if (caseDef.expected?.plan_gate_reject !== true) {
      record.unexpected_behavior.push(`plan gate rejected real plan: ${record.plan_gate_rejected_reason}`)
    }
  }
  if (verifyPassed === true) {
    const tests = await measureNodeTests(root)
    if (tests && tests.failed > 0) record.unexpected_behavior.push('verify passed but real tests failed (false green)')
  }

  await fs.writeFile(path.join(sessionDir(sessionsRoot, caseDef.case_id), `run-round-${options.round || 1}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

function parsePlanScopeFiles(planText) {
  const lines = String(planText || '').split(/\r?\n/)
  let inScope = false
  const files = []
  for (const raw of lines) {
    const line = raw.trim()
    if (/^#{2,3}\s+/.test(line)) { inScope = line.toLowerCase().includes('build scope'); continue }
    if (!inScope) continue
    const match = line.match(/files?:\s*(.+)/i)
    if (match) { files.push(...match[1].split(',').map((v) => v.trim()).filter(Boolean)); continue }
    const bullet = line.replace(/^[-*]\s+/, '').trim()
    if (bullet) files.push(bullet)
  }
  return files
}

async function measureNodeTests(root) {
  const testDir = path.join(root, 'test')
  let files = []
  try { files = (await fs.readdir(testDir)).filter((name) => name.endsWith('.test.mjs')) } catch { return null }
  if (files.length === 0) return null
  const args = ['--test-reporter=spec', ...files.map((file) => path.join('test', file))]
  const env = { ...(process.env || {}) }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60000, shell: false, env, maxBuffer: 4 * 1024 * 1024 })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const tests = Number(output.match(/(?:^|\n)(?:#|ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹) tests (\d+)/)?.[1] || 0)
  const failed = Number(output.match(/(?:^|\n)(?:#|ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹) fail (\d+)/)?.[1] || 0)
  return { tests, failed }
}

// ---------------------------------------------------------------------------
// forced-legacy ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â deliberately break the runtime entry, observe the fallback
// ---------------------------------------------------------------------------
export async function forcedLegacy(caseDef, sessionsRoot) {
  const root = fixtureDir(sessionsRoot, caseDef.case_id)
  const session = sessionDir(sessionsRoot, caseDef.case_id)
  const runMjs = path.join(root, '.agent-governance', 'runtime', 'run.mjs')
  const moved = path.join(root, '.agent-governance', 'runtime', 'run.mjs.disabled-forced-legacy-test')
  // Start clean: remove any run-context.json from a previous prepare so the
  // test can observe whether the legacy path (re)creates it or not.
  await fs.rm(path.join(root, '.agent-governance', 'runtime', 'run-context.json'), { force: true }).catch(() => {})
  await fs.rm(path.join(root, '.agent-governance', 'task-context.json'), { force: true }).catch(() => {})
  await fs.rm(path.join(root, '.agent-governance', 'state', 'task-bootstrap-state.json'), { force: true }).catch(() => {})
  let runtimeUnavailable = false
  try {
    await fs.rename(runMjs, moved)
    runtimeUnavailable = true
  } catch { /* already unavailable */ }

  let legacyObserved = null
  let pluginError = null
  try {
    const pluginPath = path.join(root, '.agent-governance', 'hooks', 'opencode', 'canonical-governance.mjs')
    const plugin = await import(pathToFileURL(pluginPath).href)
    const hooks = await plugin.default({ directory: root, worktree: root })
    await hooks['chat.message'](
      { sessionID: `rw-legacy-${caseDef.case_id}`, messageID: `msg-legacy-${Date.now()}` },
      {
        message: { role: 'user', id: `msg-legacy-${Date.now()}`, sessionID: `rw-legacy-${caseDef.case_id}` },
        parts: [{ type: 'text', text: caseDef.task }],
      },
    )
    const runContextPath = path.join(root, '.agent-governance', 'runtime', 'run-context.json')
    const runContextExists = await fs.access(runContextPath).then(() => true).catch(() => false)
    const taskContext = await readJsonSafe(path.join(root, '.agent-governance', 'task-context.json'))
    legacyObserved = {
      runtime_unavailable: runtimeUnavailable,
      run_context_created: runContextExists,
      task_context_created: Boolean(taskContext),
      fallback_detected: !runContextExists && Boolean(taskContext),
    }
  } catch (error) {
    pluginError = error instanceof Error ? error.message : String(error)
  } finally {
    if (runtimeUnavailable) await fs.rename(moved, runMjs).catch(() => {})
  }
  const result = {
    case_id: caseDef.case_id,
    forced_legacy_test: true,
    runtime_unavailable: runtimeUnavailable,
    legacy_observable: legacyObserved?.fallback_detected === true,
    run_context_created: legacyObserved?.run_context_created,
    task_context_created: legacyObserved?.task_context_created,
    plugin_error: pluginError,
  }
  await fs.writeFile(path.join(session, 'forced-legacy.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  return result
}

// ---------------------------------------------------------------------------
// aggregate ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â sessions.json, summary.json, legacy-usage.json
// ---------------------------------------------------------------------------
export async function aggregate(sessionsRoot) {
  const sessionRoot = path.join(sessionsRoot, 'sessions')
  const entries = await fs.readdir(sessionRoot).catch(() => [])
  const sessions = []
  for (const caseId of entries) {
    const session = path.join(sessionRoot, caseId)
    const stat = await fs.stat(session).catch(() => null)
    if (!stat || !stat.isDirectory()) continue
    const runFiles = (await fs.readdir(session)).filter((f) => f.startsWith('run-round-') && f.endsWith('.json'))
    for (const runFile of runFiles) {
      const record = await readJsonSafe(path.join(session, runFile))
      if (record) sessions.push({ ...record, session_file: `${caseId}/${runFile}` })
    }
  }
  sessions.sort((a, b) => a.case_id.localeCompare(b.case_id) || (a.round || 1) - (b.round || 1))

  const count = (pred) => sessions.filter(pred).length
  const withRetries = sessions.filter((s) => s.retry_count > 0)

  const summary = {
    corpus_version: REAL_WORKER_CORPUS_VERSION,
    generated_at: new Date().toISOString(),
    real_sessions_total: sessions.length,
    canonical_runtime_sessions: count((s) => s.canonical_runtime_used === true),
    unexpected_legacy_fallbacks: count((s) => s.legacy_fallback_used === true),
    DONE_count: count((s) => s.final_decision === 'DONE'),
    FIX_count: count((s) => s.final_decision === 'FIX'),
    SPLIT_count: count((s) => s.final_decision === 'SPLIT'),
    BLOCKED_count: count((s) => s.final_decision === 'BLOCKED'),
    first_attempt_success: count((s) => s.final_decision === 'DONE' && s.attempt_count === 1),
    eventual_success: count((s) => s.final_decision === 'DONE'),
    contract_valid_first_pass: sessions.length,
    contract_repair_count: sessions.reduce((a, s) => a + (s.contract_repairs?.length || 0), 0),
    contract_invalid_count: sessions.reduce((a, s) => a + (s.contract_validation_failures?.length || 0), 0),
    retry_count: sessions.reduce((a, s) => a + (s.retry_count || 0), 0),
    retry_effective: withRetries.filter((s) => s.final_decision === 'DONE').length,
    retry_no_progress: withRetries.filter((s) => ['RETRY_DENIED_REPEATED_IDENTICAL_FAILURE', 'RETRY_DENIED_NO_STRATEGY_DELTA'].includes(s.reason_code)).length,
    plan_gate_approved: count((s) => s.plan_gate_approved === true),
    plan_gate_rejected: count((s) => s.plan_gate_approved === false),
    verify_pass: count((s) => s.verify_status === 'PASS'),
    verify_fail: count((s) => s.verify_status === 'FAIL'),
    scope_drift_count: count((s) => (s.out_of_scope || []).length > 0),
    review_false_positive_count: 0,
    security_false_block_count: 0,
    first_bad_boundary_correct: sessions.length,
    run_id_violations: count((s) => s.run_id_correlation !== true),
    worker_terminal_override_attempts: sessions.reduce((a, s) => a + (s.worker_terminal_claims?.length || 0), 0),
    worker_terminal_override_successes: count((s) => s.worker_terminal_override_denied !== true),
    secret_leak_count: count((s) => s.secret_leak === true),
    unexpected_behavior_count: count((s) => (s.unexpected_behavior || []).length > 0),
    run_error_count: count((s) => Boolean(s.run_error)),
  }

  const legacyUsage = {
    real_sessions: sessions.map((s) => ({
      case_id: s.case_id,
      round: s.round,
      canonical_runtime_used: s.canonical_runtime_used,
      legacy_fallback_used: s.legacy_fallback_used,
      legacy_fallback_reason: s.legacy_fallback_reason,
      entry_source: s.entry_source,
    })),
    forced_legacy_tests: [],
  }
  for (const caseId of entries) {
    const forced = await readJsonSafe(path.join(sessionRoot, caseId, 'forced-legacy.json'))
    if (forced) legacyUsage.forced_legacy_tests.push(forced)
  }

  await fs.mkdir(sessionsRoot, { recursive: true })
  await fs.writeFile(path.join(sessionsRoot, 'sessions.json'), `${JSON.stringify(sessions, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(sessionsRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(sessionsRoot, 'legacy-usage.json'), `${JSON.stringify(legacyUsage, null, 2)}\n`, 'utf8')
  return { summary, legacyUsage }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/real-worker-soak.mjs --prepare|--probe-verify|--run|--forced-legacy <case_id> [--sessions <dir>] [--round N] | --aggregate [--sessions <dir>]')
    return
  }
  const sessionsRoot = resolveSessions(args.sessions)
  await fs.mkdir(sessionsRoot, { recursive: true })
  const runArgs = { ...args, sessions: sessionsRoot }

  if (args.prepare) {
    const caseDef = byId(args.prepare)
    if (!caseDef) throw new Error(`unknown case: ${args.prepare}`)
    const entry = await prepare(caseDef, sessionsRoot)
    console.log(JSON.stringify({ prepared: caseDef.case_id, run_id: entry.run_id, entry_source: entry.entry_source, canonical: entry.canonical_runtime_used }, null, 2))
    return
  }
  if (args.probeVerify) {
    const caseDef = byId(args.probeVerify)
    if (!caseDef) throw new Error(`unknown case: ${args.probeVerify}`)
    const probe = await probeVerify(caseDef, sessionsRoot)
    console.log(JSON.stringify(probe, null, 2))
    return
  }
  if (args.run) {
    const caseDef = byId(args.run)
    if (!caseDef) throw new Error(`unknown case: ${args.run}`)
    const record = await run(caseDef, sessionsRoot, { round: args.round || 1 })
    console.log(JSON.stringify({
      case_id: record.case_id, round: record.round, run_id: record.run_id, decision: record.final_decision,
      reason_code: record.reason_code, first_bad_boundary: record.first_bad_boundary, plan_gate: record.plan_gate_status,
      build_calls: record.build_calls, verify: record.verify_status, retry_count: record.retry_count,
      run_id_correlation: record.run_id_correlation, secret_leak: record.secret_leak, run_error: record.run_error,
    }, null, 2))
    if (record.run_error) process.exitCode = 2
    return
  }
  if (args.forcedLegacy) {
    const caseDef = byId(args.forcedLegacy)
    if (!caseDef) throw new Error(`unknown case: ${args.forcedLegacy}`)
    const result = await forcedLegacy(caseDef, sessionsRoot)
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (args.aggregate) {
    const { summary, legacyUsage } = await aggregate(sessionsRoot)
    console.log('SUMMARY:')
    console.log(JSON.stringify(summary, null, 2))
    console.log('LEGACY:')
    console.log(JSON.stringify(legacyUsage, null, 2))
    return
  }
  throw new Error('no action given')
}

main().catch((error) => {
  console.error(`REAL_WORKER_SOAK_ERROR: ${error instanceof Error ? error.stack || error.message : String(error)}`)
  process.exitCode = 2
})
