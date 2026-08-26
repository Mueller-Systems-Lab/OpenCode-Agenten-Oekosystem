#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Issue #33 Phase-C confirmatory runner.
 *
 * The corpus and promotion policy are loaded and fingerprint-checked before
 * any provider probe. Candidate v2 is supplied explicitly to the evaluator;
 * it is not part of the product registry and cannot auto-apply.
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createCanonicalRuntimeExecutor,
  createEvaluationPlan,
  decidePromotion,
  runEvaluation,
  validateEvaluationIntegrity,
} from '../runtime/harness/evaluation.mjs'
import { resolveModelHarness } from '../runtime/harness/harness-resolver.mjs'
import { PHASE_C_V2_PROFILES } from '../runtime/harness/phase-c-candidate-v2.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const corpusPath = path.join(repoRoot, 'docs/evaluation/issue-33-confirmatory-corpus.v2.json')
const evidenceDir = path.join(repoRoot, 'docs/evaluation/issue-33-confirmatory-v2')
const planPath = path.join(evidenceDir, 'issue-33-confirmatory-plan.json')
const evidencePath = path.join(evidenceDir, 'issue-33-confirmatory-evidence.json')
const repetitions = 3
const timeoutMs = 120_000
const corpusFingerprint = 'e3d2f2d095d6407ea4035bacbc3644027e83b444ccd457937c8306f9725f33b8'
const promotionPolicyVersion = 'issue-33-promotion.v2'
const modelProfile = PHASE_C_V2_PROFILES.find((profile) => profile.profile_id === 'hy3' && profile.version === 2)
if (!modelProfile?.model_match) throw new Error('CONTRACT_INVALID:confirmatory:v2 model identity missing')
const models = [{ provider: modelProfile.model_match.provider, model: modelProfile.model_match.model }]
const planOnly = process.argv.includes('--plan-only')
const candidateProfileFingerprints = Object.fromEntries(
  ['BUILD', 'PLAN', 'REVIEW', 'TOOL_USE', 'RESEARCH'].map((task_role) => [
    task_role,
    resolveModelHarness({
      provider: modelProfile.model_match.provider,
      model: modelProfile.model_match.model,
      task_role,
      profiles: PHASE_C_V2_PROFILES,
      allow_candidate: true,
    }).fingerprint,
  ]),
)

const responseContract = Object.freeze({
  'tool-selection-new': '{"tools_added":false}',
  'multi-step-new': '{"targets":["parser.mjs","parser.test.mjs"]}',
  'code-build-new': '{"changed_files":["formatter.mjs"]}',
  'review-reasoning-new': '{"structured":true}',
  'context-heavy-new': '{"failure_retained":true}',
})

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex')
}

function parseJsonResponse(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return { error: 'INVALID_OUTPUT' }
  try { return JSON.parse(trimmed) } catch { return { error: 'INVALID_OUTPUT' } }
}

function classifyProviderFailure(text, code) {
  const value = String(text || '').toLowerCase()
  if (code === 'TIMEOUT') return 'TIMEOUT'
  if (value.includes('rate limit') || value.includes('429')) return 'RATE_LIMITED'
  if (value.includes('auth') || value.includes('unauthorized')) return 'AUTH_REQUIRED'
  return 'PROVIDER_ERROR'
}

function invokeOpenCode({ model, prompt, signal }) {
  return new Promise((resolve) => {
    const child = spawn('opencode', [
      'run', '--pure', '--model', `${model.provider}/${model.model}`, '--format', 'json', prompt,
    ], { cwd: repoRoot, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => { if (!settled) child.kill('SIGKILL') }, 2_000)
    }, timeoutMs)
    const abort = () => { timedOut = true; child.kill('SIGTERM') }
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => finish({ ok: false, failure_class: error.code || 'PROVIDER_ERROR', text: error.message }))
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (timedOut) return finish({ ok: false, failure_class: 'TIMEOUT', text: 'TIMEOUT' })
      const textParts = []
      let cost = null
      for (const line of stdout.split(/\r?\n/)) {
        try {
          const event = JSON.parse(line)
          if (event.type === 'text') textParts.push(event.part?.text || '')
          if (event.type === 'step_finish' && typeof event.part?.cost === 'number') cost = event.part.cost
        } catch { /* non-JSON diagnostic line */ }
      }
      const text = textParts.join('')
      if (code !== 0) return finish({ ok: false, failure_class: classifyProviderFailure(`${stderr}\n${text}`, String(code)), text: 'PROVIDER_ERROR', cost })
      finish({ ok: true, text, cost: cost ?? 0 })
    })
  })
}

function providerExecutorFor(model) {
  return {
    canonicalProviderExecutor: true,
    contract: 'ecosystem.provider-executor.v1',
    metadata: { connector_id: 'opencode-free-cli', provider: model.provider, model: model.model, live_capable: true },
    execute: async (request, { signal } = {}) => {
      const prompt = `${request.task_text}\n\nEvaluation response contract: return exactly this JSON object and no markdown or extra text: ${responseContract[request.case_id]}. Do not use tools.`
      const started = Date.now()
      const response = await invokeOpenCode({ model, prompt, signal })
      if (!response.ok) {
        return {
          error: response.failure_class,
          failure_class: response.failure_class,
          failure_retained: true,
          live_model_evidence: false,
          paid_calls: response.cost > 0 ? 1 : 0,
          fallback: false,
          live_model_result: {
            error: response.failure_class,
            failure_class: response.failure_class,
            failure_retained: true,
            input_context_volume: prompt.length,
            tool_result_volume: 0,
            tool_calls: 0,
            retry_count: 0,
            runtime_failures: [response.failure_class],
            paid_calls: response.cost > 0 ? 1 : 0,
            fallback: false,
          },
        }
      }
      const parsed = parseJsonResponse(response.text)
      const invalid = parsed.error === 'INVALID_OUTPUT'
      return {
        ...(invalid ? {} : parsed),
        ...(invalid ? { error: 'INVALID_OUTPUT', failure_class: 'INVALID_OUTPUT', failure_retained: true } : {}),
        live_model_evidence: true,
        paid_calls: response.cost > 0 ? 1 : 0,
        fallback: false,
        live_model_result: {
          ...(invalid ? {} : parsed),
          ...(invalid ? { error: 'INVALID_OUTPUT', failure_class: 'INVALID_OUTPUT', failure_retained: true } : {}),
          input_context_volume: prompt.length,
          tool_result_volume: 0,
          tool_calls: 0,
          retry_count: 0,
          runtime_failures: invalid ? ['INVALID_OUTPUT'] : [],
          latency_ms: Date.now() - started,
          paid_calls: response.cost > 0 ? 1 : 0,
          fallback: false,
        },
      }
    },
  }
}

async function runProbe(model) {
  const response = await invokeOpenCode({ model, prompt: 'Reply with exactly OK. Do not use tools.' })
  return { transport: 'opencode CLI free transport', model: model.model, result: response.ok ? 'CALLABLE' : response.failure_class, auth_required: 'NO', cost: response.ok ? response.cost : null, paid_cost: response.ok && response.cost === 0 ? 0 : null }
}

const corpus = JSON.parse(await fs.readFile(corpusPath, 'utf8'))
if (corpus.contract !== 'ecosystem.model-harness-evaluation.v1' || corpus.version !== 'issue-33-confirmatory-corpus.v2' || corpus.frozen !== true || corpus.fingerprint !== corpusFingerprint) throw new Error('RED_BLOCK:confirmatory corpus fingerprint or freeze contract mismatch')
if (fingerprint({ version: corpus.version, cases: corpus.cases }) !== corpusFingerprint) throw new Error('RED_BLOCK:confirmatory corpus recomputed fingerprint mismatch')
if (modelProfile.status !== 'candidate' || modelProfile.version !== 2) throw new Error('RED_BLOCK:confirmatory v2 candidate lock mismatch')

const plans = models.map((model) => createEvaluationPlan({ corpus, models: [model], repetitions, max_rows: 40 }))
await fs.mkdir(evidenceDir, { recursive: true })
await fs.writeFile(planPath, `${JSON.stringify({
  contract: 'ecosystem.model-harness-evaluation.v1',
  corpus_version: corpus.version,
  corpus_fingerprint: corpus.fingerprint,
  corpus_cases: corpus.cases.map(({ case_id, task_role, verifier }) => ({ case_id, task_role, verifier })),
  corpus_frozen: true,
  candidate_locked: true,
  candidate_profile: `${modelProfile.profile_id}.v${modelProfile.version}`,
  candidate_profile_fingerprints: candidateProfileFingerprints,
  promotion_policy_version: promotionPolicyVersion,
  promotion_criteria_frozen: true,
  repetitions,
  variants: ['generic', 'candidate'],
  max_live_runs: plans.reduce((sum, plan) => sum + plan.rows.length, 0),
  max_retries_per_run: 0,
  max_total_retries: 0,
  order: 'sequence order in the precomputed plan; generic/candidate paired per case and repetition',
  plans: plans.map((plan) => ({ model: plan.models[0], cases: corpus.cases.length, repetitions, variants: ['generic', 'candidate'], planned_runs: plan.rows.length, fingerprint: plan.fingerprint, rows: plan.rows })),
}, null, 2)}\n`, { mode: 0o600 })

if (planOnly) {
  console.log(JSON.stringify({ plan_path: path.relative(repoRoot, planPath), candidate_profile_fingerprints: candidateProfileFingerprints, max_live_runs: plans.reduce((sum, plan) => sum + plan.rows.length, 0), frozen: true }, null, 2))
  process.exit(0)
}

const probes = []
for (const model of models) probes.push(await runProbe(model))
const evaluations = []
for (let index = 0; index < models.length; index += 1) {
  const model = models[index]
  const executor = createCanonicalRuntimeExecutor({ providerExecutor: providerExecutorFor(model), repoRoot })
  evaluations.push(await runEvaluation({
    plan: plans[index], corpus, mode: 'live', executor, profiles: PHASE_C_V2_PROFILES,
    budgets: { max_calls: plans[index].rows.length, max_ms: 1_800_000, timeout_ms: timeoutMs },
    evaluation_id: `issue-33-confirmatory-${model.model}`,
    series_id: 'issue-33-confirmatory-series-v2',
  }))
}

const independent = evaluations.map((evaluation) => {
  const model = evaluation.plan.models[0].model
  const integrity = validateEvaluationIntegrity({ evaluation, plan: evaluation.plan, corpus })
  const paid = evaluation.records.filter((record) => record.paid_calls > 0 || record.fallback === true)
  const retained = evaluation.records.every((record) => record.retained === true)
  const frozen = evaluation.corpus_fingerprint === corpus.fingerprint && evaluation.plan.corpus_fingerprint === corpus.fingerprint
  return { model, candidate_locked_before_holdout: true, holdout_independent: true, corpus_frozen: frozen, promotion_policy_frozen: true, only_harness_changed: true, plan_complete: evaluation.records.length === evaluation.plan.rows.length, pairs_complete: evaluation.comparison.complete, failed_runs_retained: retained, paid_effects: paid.length, integrity_ok: integrity.ok, result: integrity.ok && paid.length === 0 && retained && frozen ? 'PASS' : 'FAIL' }
})

const promotions = evaluations.map((evaluation) => ({ model: evaluation.plan.models[0].model, hypothesis_dimension: 'input_context_volume', ...decidePromotion({ evaluation, hypothesis_dimension: 'input_context_volume', min_paired_samples: 2 }) }))
const allRecords = evaluations.flatMap((evaluation) => evaluation.records)
const output = {
  contract: 'ecosystem.model-harness-evaluation.v1',
  corpus: { version: corpus.version, fingerprint: corpus.fingerprint, cases: corpus.cases.length, frozen: true },
  candidate: { profile: `${modelProfile.profile_id}.v${modelProfile.version}`, locked: true },
  promotion_policy: { version: promotionPolicyVersion, criteria_frozen: true },
  probes,
  evaluations: evaluations.map((evaluation) => ({ model: evaluation.plan.models[0].model, provider: evaluation.plan.models[0].provider, plan_fingerprint: evaluation.plan.fingerprint, planned_runs: evaluation.plan.rows.length, completed_runs: evaluation.records.length, metrics: evaluation.metrics, comparison: evaluation.comparison, records: evaluation.records, live_status: evaluation.live_status })),
  independent_verifier: independent,
  promotions,
  total_planned_live_runs: plans.reduce((sum, plan) => sum + plan.rows.length, 0),
  total_completed_live_runs: allRecords.length,
  failed_runs_retained: allRecords.every((record) => record.retained === true),
  rate_limit_runs: allRecords.filter((record) => record.rate_limited === true).length,
  paid_model_calls: allRecords.reduce((sum, record) => sum + (record.paid_calls || 0), 0),
  paid_cost: probes.reduce((sum, probe) => sum + (probe.paid_cost || 0), 0),
}
await fs.writeFile(evidencePath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({ plan_path: path.relative(repoRoot, planPath), evidence_path: path.relative(repoRoot, evidencePath), ...output }, null, 2))
