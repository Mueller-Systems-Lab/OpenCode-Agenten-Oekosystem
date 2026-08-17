#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Soak runner — measurement harness ONLY.
 *
 * For every corpus case it:
 *   1. creates an isolated temp fixture repo (setup)
 *   2. runs the case through the CANONICAL entry (runtime/run.mjs runTask,
 *      or the CLI scripts/run-task.mjs for cli:true cases)
 *   3. collects the real terminal decision, phase contracts and run events
 *   4. classifies calibration metrics and aggregates over the corpus
 *   5. writes evidence/runtime-soak/results.json and per-case event files
 *
 * It implements NO runtime semantics: no controller, no gates, no retry
 * authorization. All decisions come from the runtime.
 *
 * Usage:
 *   node scripts/runtime-soak.mjs [--round 1|2] [--out evidence/runtime-soak/results.json]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runTask } from '../runtime/run.mjs'
import { loadRunEvents, runIdsOf, hasSecretLeak } from '../runtime/observability/run-events.mjs'
import { CORPUS, SOAK_CORPUS_VERSION } from '../test/fixtures/runtime-soak/corpus.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EVENT_DIR = path.join(ROOT, 'evidence', 'runtime-soak', 'events')
const DEFAULT_OUT = path.join(ROOT, 'evidence', 'runtime-soak', 'results.json')

function parseArgs(argv) {
  const out = { round: 1, out: DEFAULT_OUT }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    if (arg === '--round') out.round = Number(next())
    else if (arg === '--out') out.out = next()
    else if (arg === '--help' || arg === '-h') { out.help = true }
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

function classifyBoundary(expected, actual) {
  if (expected === undefined || expected === null && actual === null) return 'BOUNDARY_CORRECT'
  if (expected === actual) return 'BOUNDARY_CORRECT'
  if (expected === null || actual === null) return 'BOUNDARY_AMBIGUOUS'
  return 'BOUNDARY_INCORRECT'
}

export function classifyResearch(expected, research, runInfo = {}) {
  if (!expected) return 'RESEARCH_NOT_ASSESSED'
  if (!research) {
    const phaseHistory = runInfo.phase_history || []
    const phases = phaseHistory.map((b) => b && (b.name || b.phase))
    if (phases.length && !phases.includes('RESEARCH')) return 'RESEARCH_NOT_RUN'
    return runInfo.cli ? 'RESEARCH_NOT_MEASURED' : 'RESEARCH_MISS'
  }
  const code = (research.find((r) => r.focus === 'code')?.findings) || []
  const docs = (research.find((r) => r.focus === 'docs')?.findings) || []
  const tests = (research.find((r) => r.focus === 'tests')?.findings) || []
  const all = new Set([...code, ...docs, ...tests])
  const missing = expected.filter((file) => !all.has(file))
  if (missing.length === 0) return 'RESEARCH_COMPLETE'
  if (expected.length - missing.length > 0) return 'RESEARCH_PARTIAL'
  return 'RESEARCH_MISS'
}

async function measureTests(fixtureRoot) {
  // Independent real test measurement (not runtime semantics): run node --test
  // on the fixture and parse the summary so skipped/empty runs cannot count
  // as success.
  const testDir = path.join(fixtureRoot, 'test')
  let files = []
  try { files = (await fs.readdir(testDir)).filter((name) => name.endsWith('.test.mjs')) } catch { return null }
  if (files.length === 0) return null
  const args = ['--test-reporter=spec']
  for (const file of files) args.push(path.join('test', file))
  const env = { ...(process.env || {}) }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, args, { cwd: fixtureRoot, encoding: 'utf8', timeout: 60000, shell: false, env, maxBuffer: 4 * 1024 * 1024 })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const tests = Number(output.match(/(?:^|\n)(?:#|ℹ) tests (\d+)/)?.[1] || 0)
  const pass = Number(output.match(/(?:^|\n)(?:#|ℹ) pass (\d+)/)?.[1] || 0)
  const fail = Number(output.match(/(?:^|\n)(?:#|ℹ) fail (\d+)/)?.[1] || 0)
  const skipped = Number(output.match(/(?:^|\n)(?:#|ℹ) skipped (\d+)/)?.[1] || 0)
  return { tests, passed: pass, failed: fail, skipped: skipped, executed: pass + fail, exit_code: result.status }
}

async function runOneCase(caseDef, round) {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), `ocae-soak-${caseDef.case_id}-`))
  const eventFile = path.join(EVENT_DIR, `${caseDef.case_id}-r${round}.jsonl`)
  await fs.mkdir(path.dirname(eventFile), { recursive: true, mode: 0o700 })
  await fs.writeFile(eventFile, '', 'utf8')
  const startedAt = Date.now()
  let workerCalled = false
  let result = null
  let runError = null
  try {
    await caseDef.setup(fixtureRoot)
    const env = { ...(process.env || {}) }
    for (const key of caseDef.env_remove || []) delete env[key]

    if (caseDef.cli) {
      // Canonical CLI entry (scripts/run-task.mjs), same path normal tasks use.
      const planFile = path.join(fixtureRoot, 'plan.md')
      await fs.writeFile(planFile, caseDef.planText, 'utf8')
      const executorFile = path.join(fixtureRoot, 'executor.mjs')
      await fs.writeFile(executorFile, caseDef.executorSource, 'utf8')
      const verifyArg = `"${process.execPath}" --test test/calc3.test.mjs`
      const cliArgs = [
        path.join(ROOT, 'scripts', 'run-task.mjs'),
        '--task', caseDef.task,
        '--repo', fixtureRoot,
        '--plan-file', 'plan.md',
        '--verify', verifyArg,
        '--exec', executorFile,
        '--event-sink', eventFile,
        '--max-attempts', String(caseDef.max_attempts || 2),
        '--json',
      ]
      const spawn = spawnSync(process.execPath, cliArgs, { cwd: ROOT, encoding: 'utf8', timeout: 120000, shell: false, env, maxBuffer: 8 * 1024 * 1024 })
      workerCalled = true
      if (spawn.status === 0 && spawn.stdout) {
        const parsed = JSON.parse(spawn.stdout)
        result = {
          phase: parsed.phase,
          run_id: parsed.run_id,
          task: { contract: parsed.task_contract, repository: fixtureRoot },
          baseline: parsed.baseline ? {
            approved: parsed.baseline.approved,
            required_capabilities: parsed.baseline.required_capabilities || {},
            errors: parsed.baseline.errors || [],
            required_capability_list: Object.keys(parsed.baseline.required_capabilities || {}),
          } : null,
          plan_gate: parsed.decision ? { approved: parsed.decision.reason_code !== 'ACCEPTANCE_CRITERIA_MISSING' && parsed.decision.reason_code !== 'BUILD_SCOPE_MISSING' && parsed.decision.reason_code !== 'REQUIRED_TESTS_INVALID' && parsed.decision.reason_code !== 'TARGETS_INVALID' && parsed.decision.reason_code !== 'PLAN_MISSING' } : null,
          build_result: parsed.build_status ? { status: parsed.build_status } : null,
          verification: parsed.verification ? { verification: parsed.verification } : null,
          reviews: (parsed.reviews || []).map((r) => ({ review_type: r.review_type, review: { status: r.status, severity: r.severity } })),
          decision: parsed.decision,
          events: [],
        }
      } else {
        runError = `CLI exited ${spawn.status}: ${String(spawn.stderr || spawn.error || '').slice(0, 500)}`
      }
    } else {
      // Canonical entry: runTask from runtime/run.mjs (same function the CLI wraps).
      const executor = caseDef.buildExecutor()
      const wrapped = async (buildInput) => {
        workerCalled = true
        return executor(buildInput)
      }
      result = await runTask({
        taskInput: { task: caseDef.task, repository: fixtureRoot },
        repoRoot: fixtureRoot,
        env,
        nativePlan: { planText: caseDef.planText },
        buildExecutor: wrapped,
        verifyChecks: caseDef.verifyChecks(fixtureRoot),
        eventSink: eventFile,
        max_attempts: caseDef.max_attempts || 2,
        required_skills: caseDef.required_skills || [],
        capability_status: caseDef.capability_status || {},
        mcpProfile: caseDef.mcpProfile || null,
        inventory: caseDef.inventory || {},
      })
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error)
  }
  const durationMs = Date.now() - startedAt

  const events = await loadRunEvents(eventFile)
  const runIds = runIdsOf(events)
  const leak = hasSecretLeak(events) || (result && hasSecretLeak([result.decision || {}]))

  const decision = result?.decision || null
  const expected = caseDef.expected || {}
  const boundaryExpected = expected.first_bad_boundary ?? null
  const boundaryActual = decision?.first_bad_boundary ?? null

  const buildStatus = result?.build_result?.status || null
  const verifyPassed = result?.verification?.verification?.passed ?? null
  const reviews = result?.reviews || []

  const verifyEvents = events.filter((e) => e.phase === 'VERIFY')
  const buildEvents = events.filter((e) => e.phase === 'BUILD')
  const attempts = Math.max(0, ...verifyEvents.map((e) => e.attempt), ...buildEvents.map((e) => e.attempt)) + 1
  const retryCount = Math.max(0, attempts - 1)

  const failureSignatures = verifyEvents.map((e) => e.failure_signature).filter(Boolean)
  const strategyDeltas = verifyEvents.map((e) => e.strategy_delta).filter(Boolean)

  const securityReview = reviews.find((r) => r.review_type === 'security')
  const correctnessReview = reviews.find((r) => r.review_type === 'correctness')
  const qualityReview = reviews.find((r) => r.review_type === 'quality')

  const record = {
    round,
    case_id: caseDef.case_id,
    task_class: caseDef.task_class,
    run_id: result?.run_id || decision?.run_id || null,
    final_decision: decision?.decision || 'NO_DECISION',
    reason_code: decision?.reason_code || null,
    first_bad_boundary: boundaryActual,
    boundary_expected: boundaryExpected,
    boundary_classification: runError ? 'BOUNDARY_AMBIGUOUS' : classifyBoundary(boundaryExpected, boundaryActual),
    required_capabilities: result?.baseline?.required_capability_list || [],
    missing_required_capabilities: (result?.baseline?.errors || []).filter((e) => String(e).startsWith('required capability')),
    missing_optional_capabilities: (result?.baseline?.optional_degradations || []),
    research_status: classifyResearch(expected.research_expected, result?.research?.research, { phase_history: decision?.phase_history, cli: Boolean(caseDef.cli) }),
    plan_gate_status: result?.plan_gate ? (result.plan_gate.approved ? 'PASS' : 'FAIL') : null,
    plan_gate_expected: expected.plan_gate_approved ?? null,
    build_status: buildStatus,
    verify_status: verifyPassed === null ? null : (verifyPassed ? 'PASS' : 'FAIL'),
    attempt_count: attempts,
    retry_count: retryCount,
    failure_signatures: failureSignatures,
    strategy_deltas: strategyDeltas,
    review_correctness: correctnessReview?.review?.status || null,
    review_security: securityReview?.review?.status || null,
    review_quality: qualityReview?.review?.status || null,
    security_blocking: securityReview?.review?.blocking ?? null,
    duration_ms: durationMs,
    provider: 'fixture',
    model: 'deterministic-executor',
    cost_status: 'COST_NOT_AVAILABLE',
    tests: await measureTests(fixtureRoot),
    run_id_correlation: runIds.length === 1 && runIds[0] === (result?.run_id || decision?.run_id),
    run_ids_seen: runIds,
    secret_leak: leak,
    worker_called: workerCalled,
    canonical_runtime_used: true,
    legacy_fallback_used: false,
    legacy_fallback_reason: null,
    run_error: runError,
    unexpected_behavior: [],
    expected_match: (() => {
      if (runError) return false
      const checks = [
        decision?.decision === expected.decision,
        expected.reason_code ? decision?.reason_code === expected.reason_code : true,
        boundaryExpected !== undefined ? classifyBoundary(boundaryExpected, boundaryActual) === 'BOUNDARY_CORRECT' : true,
      ]
      if (expected.worker_called !== undefined) checks.push(workerCalled === expected.worker_called)
      if (expected.baseline_approved !== undefined) checks.push((result?.baseline?.approved ?? null) === expected.baseline_approved)
      if (expected.plan_gate_approved !== undefined) checks.push((result?.plan_gate?.approved ?? null) === expected.plan_gate_approved)
      if (expected.build_status !== undefined) checks.push(buildStatus === expected.build_status)
      if (expected.verify_passed !== undefined) checks.push(verifyPassed === expected.verify_passed)
      if (expected.attempt_count !== undefined) checks.push(attempts === expected.attempt_count)
      if (expected.retry_count !== undefined) checks.push(retryCount === expected.retry_count)
      if (expected.phase !== undefined) checks.push(result?.phase === expected.phase)
      return checks.every(Boolean)
    })(),
  }

  // Calibration classifications (data-driven, from recorded fields only).
  record.retry_classification = (() => {
    if ((record.retry_count || 0) === 0) return 'NO_RETRY'
    if (record.final_decision === 'DONE') return 'RETRY_EFFECTIVE'
    if (record.reason_code === 'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE') return 'RETRY_NO_PROGRESS'
    if (record.reason_code === 'RETRY_DENIED_NO_STRATEGY_DELTA') return 'RETRY_SHOULD_HAVE_SPLIT'
    return 'RETRY_CHANGED_FAILURE'
  })()
  record.split_classification = record.final_decision === 'SPLIT'
    ? (record.reason_code === 'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE' || record.reason_code === 'RETRY_DENIED_NO_STRATEGY_DELTA' ? 'CORRECT_SPLIT' : 'SPLIT_OBSERVED')
    : 'NO_SPLIT'
  record.blocked_classification = record.final_decision === 'BLOCKED' ? 'CORRECT_BLOCK' : 'NO_BLOCK'
  record.security_classification = (() => {
    if (record.final_decision === 'BLOCKED' && record.reason_code === 'BLOCKING_HIGH_OR_CRITICAL_FINDING') return 'SECURITY_TRUE_BLOCK'
    if (['FIX', 'DONE'].includes(record.final_decision) && (record.review_security === 'PASS' || record.review_security === 'FAIL')) return 'SECURITY_NO_FALSE_BLOCK'
    return 'NOT_PROVEN'
  })()
  record.capability_classification = (() => {
    const expectedRequired = expected.required_expected || []
    if (expectedRequired.length === 0 && !(record.required_capabilities || []).length) return 'CAPABILITY_NOT_ASSESSED'
    const actual = record.required_capabilities || []
    const BASE = ['repository', 'filesystem', 'runtime']
    const missed = expectedRequired.filter((cap) => !actual.includes(cap))
    const falseRequired = actual.filter((cap) => !expectedRequired.includes(cap) && !BASE.includes(cap))
    if (missed.length > 0) return `CAPABILITY_MISSED_REQUIRED:${missed.join(',')}`
    if (falseRequired.length > 0) return `CAPABILITY_FALSE_REQUIRED:${falseRequired.join(',')}`
    return 'CAPABILITY_DETECTION_CORRECT'
  })()
  record.review_classification = (() => {
    const securityFindings = (result?.reviews || []).find((r) => r.review_type === 'security')?.review?.findings || []
    if (securityFindings.length > 0 && record.final_decision === 'BLOCKED') return 'REVIEW_SECURITY_ACTIONABLE_TRUE'
    if (securityFindings.length === 0 && record.final_decision === 'DONE' && record.review_security === 'PASS') return 'REVIEW_SECURITY_TRUE_NEGATIVE'
    if (record.final_decision === 'FIX' && record.reason_code === 'NON_BLOCKING_REVIEW_FINDINGS') return 'REVIEW_NON_BLOCKING_NOT_BLOCKED'
    return 'REVIEW_OBSERVED'
  })()

  if (!record.run_id_correlation) record.unexpected_behavior.push(`run_id correlation broken: ${JSON.stringify(runIds)}`)
  if (record.secret_leak) record.unexpected_behavior.push('secret leak detected in events/decision')
  if (record.legacy_fallback_used) record.unexpected_behavior.push('unexpected legacy fallback used')
  if (verifyPassed === true && record.tests && record.tests.tests === 0) record.unexpected_behavior.push('verify passed but zero tests executed (false green)')
  if (runError) record.unexpected_behavior.push(`run error: ${runError}`)

  try { await fs.rm(fixtureRoot, { recursive: true, force: true }) } catch { /* best effort */ }
  return record
}

function aggregate(records) {
  const total = records.length
  const count = (pred) => records.filter(pred).length
  const done = count((r) => r.final_decision === 'DONE')
  const fix = count((r) => r.final_decision === 'FIX')
  const split = count((r) => r.final_decision === 'SPLIT')
  const blocked = count((r) => r.final_decision === 'BLOCKED')
  const firstAttemptDone = count((r) => r.final_decision === 'DONE' && r.attempt_count === 1)
  const pipelineCases = count((r) => r.canonical_runtime_used)
  const withRetries = records.filter((r) => r.retry_count > 0)
  const retryEffective = withRetries.filter((r) => r.final_decision === 'DONE')
  const retryNoProgress = withRetries.filter((r) => r.reason_code === 'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE' || r.reason_code === 'RETRY_DENIED_NO_STRATEGY_DELTA')
  const boundaryCorrect = count((r) => r.boundary_classification === 'BOUNDARY_CORRECT')
  const boundaryAmbiguous = count((r) => r.boundary_classification === 'BOUNDARY_AMBIGUOUS')
  const boundaryAssessed = records.filter((r) => r.boundary_expected !== undefined && r.boundary_classification !== 'BOUNDARY_AMBIGUOUS')

  return {
    corpus_version: SOAK_CORPUS_VERSION,
    total_cases: total,
    DONE_count: done,
    FIX_count: fix,
    SPLIT_count: split,
    BLOCKED_count: blocked,
    first_attempt_success_rate: pipelineCases ? +(firstAttemptDone / pipelineCases).toFixed(3) : 'NOT_PROVEN',
    eventual_success_rate: total ? +(done / total).toFixed(3) : 'NOT_PROVEN',
    retry_rate: pipelineCases ? +(withRetries.length / pipelineCases).toFixed(3) : 'NOT_PROVEN',
    retry_success_rate: withRetries.length ? +(retryEffective.length / withRetries.length).toFixed(3) : 'NOT_PROVEN',
    retry_no_progress_rate: withRetries.length ? +(retryNoProgress.length / withRetries.length).toFixed(3) : 'NOT_PROVEN',
    repeated_failure_rate: withRetries.length ? +(count((r) => r.reason_code === 'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE') / withRetries.length).toFixed(3) : 'NOT_PROVEN',
    plan_gate_false_accept: count((r) => r.plan_gate_status === 'PASS' && r.plan_gate_expected === false),
    plan_gate_false_reject: count((r) => r.plan_gate_status === 'FAIL' && r.plan_gate_expected !== false),
    security_true_block: count((r) => r.final_decision === 'BLOCKED' && r.reason_code === 'BLOCKING_HIGH_OR_CRITICAL_FINDING'),
    security_false_block: count((r) => r.final_decision === 'BLOCKED' && r.reason_code === 'BLOCKING_HIGH_OR_CRITICAL_FINDING' && r.task_class !== 'security_hard_block'),
    first_bad_boundary_accuracy: boundaryAssessed.length ? +(boundaryCorrect / boundaryAssessed.length).toFixed(3) : 'NOT_PROVEN',
    boundary_ambiguous_count: boundaryAmbiguous,
    expected_match_count: count((r) => r.expected_match === true),
    unexpected_behavior_count: count((r) => r.unexpected_behavior.length > 0),
    secret_leak_count: count((r) => r.secret_leak === true),
    legacy_fallback_count: count((r) => r.legacy_fallback_used === true),
    average_attempts: total ? +(records.reduce((a, r) => a + (r.attempt_count || 0), 0) / total).toFixed(2) : 0,
    average_runtime: total ? Math.round(records.reduce((a, r) => a + (r.duration_ms || 0), 0) / total) : 0,
    capability_detection_correct: count((r) => r.capability_classification === 'CAPABILITY_DETECTION_CORRECT'),
    capability_missed_required: count((r) => (r.capability_classification || '').startsWith('CAPABILITY_MISSED_REQUIRED')),
    capability_false_required: count((r) => (r.capability_classification || '').startsWith('CAPABILITY_FALSE_REQUIRED')),
    split_correct: count((r) => r.split_classification === 'CORRECT_SPLIT'),
    split_suspect: count((r) => r.split_classification === 'SPLIT_OBSERVED'),
    blocked_correct: count((r) => r.blocked_classification === 'CORRECT_BLOCK'),
    blocked_suspect: count((r) => r.final_decision === 'BLOCKED' && r.blocked_classification !== 'CORRECT_BLOCK'),
    security_true_block: count((r) => r.security_classification === 'SECURITY_TRUE_BLOCK'),
    security_false_block: count((r) => r.final_decision === 'BLOCKED' && r.reason_code === 'BLOCKING_HIGH_OR_CRITICAL_FINDING' && r.task_class !== 'security_hard_block'),
    retry_effective: count((r) => r.retry_classification === 'RETRY_EFFECTIVE'),
    retry_no_progress: count((r) => r.retry_classification === 'RETRY_NO_PROGRESS'),
    retry_should_have_split: count((r) => r.retry_classification === 'RETRY_SHOULD_HAVE_SPLIT'),
    repeat_prevented: count((r) => r.reason_code === 'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE'),
    review_security_actionable_true: count((r) => r.review_classification === 'REVIEW_SECURITY_ACTIONABLE_TRUE'),
    review_security_true_negative: count((r) => r.review_classification === 'REVIEW_SECURITY_TRUE_NEGATIVE'),
    review_non_blocking_not_blocked: count((r) => r.review_classification === 'REVIEW_NON_BLOCKING_NOT_BLOCKED'),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/runtime-soak.mjs [--round 1|2] [--out <path>]')
    process.exit(0)
  }
  const records = []
  for (const caseDef of CORPUS) {
    const record = await runOneCase(caseDef, args.round)
    records.push(record)
  }
  const report = { round: args.round, generated_at: new Date().toISOString(), aggregate: aggregate(records), cases: records }
  await fs.mkdir(path.dirname(args.out), { recursive: true })
  await fs.writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`SOAK_ROUND ${args.round} COMPLETE: ${records.length} cases`)
  console.log(JSON.stringify(report.aggregate, null, 2))
  const failed = records.filter((r) => r.expected_match !== true)
  if (failed.length) {
    console.log('EXPECTATION_MISMATCHES:')
    for (const f of failed) console.log(`  ${f.case_id}: decision=${f.final_decision} reason=${f.reason_code} expected=${f.expected_match === false ? 'NO' : 'CHECK'} ${f.run_error ? `error=${f.run_error}` : ''}`)
  }
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(`SOAK_RUNNER_ERROR: ${error instanceof Error ? error.stack || error.message : String(error)}`)
  process.exitCode = 2
})
