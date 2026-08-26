#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Independent read-only structural verifier for the Phase-C holdout.
 *
 * This deliberately does not call the live provider and does not trust the
 * runner's embedded verifier result as its only evidence.
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PRODUCT_MODEL_HARNESS_PROFILES } from '../runtime/harness/product-model-harness-profiles.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const corpusPath = path.join(repoRoot, 'docs/evaluation/issue-33-confirmatory-corpus.v2.json')
const planPath = path.join(repoRoot, 'docs/evaluation/issue-33-confirmatory-v2/issue-33-confirmatory-plan.json')
const evidencePath = path.join(repoRoot, 'docs/evaluation/issue-33-confirmatory-v2/issue-33-confirmatory-evidence.json')
const lockPath = path.join(repoRoot, 'docs/evaluation/issue-33-phase-c-hypothesis-lock.md')
const outputPath = path.join(repoRoot, 'docs/evaluation/issue-33-confirmatory-v2/independent-verifier.json')
const expectedCorpusFingerprint = 'e3d2f2d095d6407ea4035bacbc3644027e83b444ccd457937c8306f9725f33b8'
const expectedDevelopmentFingerprint = '217693f623ba4f0d197ae58107ee98a017a37f434c5142be0bd1797d56e723d7'
const expectedCases = ['tool-selection-new', 'multi-step-new', 'code-build-new', 'review-reasoning-new', 'context-heavy-new']
const expectedRoles = ['TOOL_USE', 'PLAN', 'BUILD', 'REVIEW', 'RESEARCH']

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex')
}

function check(name, ok, details = {}) {
  return { name, ok, ...details }
}

const [corpus, plan, evidence, lock] = await Promise.all([
  fs.readFile(corpusPath, 'utf8').then(JSON.parse),
  fs.readFile(planPath, 'utf8').then(JSON.parse),
  fs.readFile(evidencePath, 'utf8').then(JSON.parse),
  fs.readFile(lockPath, 'utf8'),
])
const evaluation = evidence.evaluations[0]
const records = evaluation?.records || []
const generic = records.filter((record) => record.arm === 'generic')
const candidate = records.filter((record) => record.arm === 'candidate')
const pairs = new Map()
for (const record of records) {
  const key = `${record.provider}/${record.model}|${record.case_id}|${record.repetition}`
  const pair = pairs.get(key) || {}
  pair[record.arm] = record
  pairs.set(key, pair)
}

const checks = [
  check('candidate_locked_before_holdout_creation', lock.includes('CANDIDATE_LOCKED=TRUE') && corpus.generated_after_candidate_lock === true && plan.candidate_locked === true),
  check('holdout_independent_from_development_corpus', corpus.fingerprint !== expectedDevelopmentFingerprint && corpus.fingerprint === expectedCorpusFingerprint),
  check('corpus_frozen_and_fingerprint_valid', corpus.frozen === true && fingerprint({ version: corpus.version, cases: corpus.cases }) === expectedCorpusFingerprint && plan.corpus_frozen === true && evidence.corpus.frozen === true),
  check('new_cases_cover_required_product_classes', expectedCases.every((caseId) => corpus.cases.some((item) => item.case_id === caseId)) && corpus.cases.length === 5),
  check('promotion_policy_frozen', plan.promotion_criteria_frozen === true && evidence.promotion_policy.criteria_frozen === true && evidence.promotion_policy.version === 'issue-33-promotion.v2'),
  check('all_planned_runs_completed', plan.max_live_runs === 30 && records.length === 30 && evaluation.live_status === 'LIVE_ATTEMPTED'),
  check('all_failures_retained', records.every((record) => record.retained === true)),
  check('paired_arms_balanced', generic.length === 15 && candidate.length === 15 && pairs.size === 15 && [...pairs.values()].every((pair) => pair.generic && pair.candidate)),
  check('only_harness_variant_changed', records.every((record) => record.provider === 'opencode' && record.model === 'hy3-free') && [...pairs.values()].every(({ generic: base, candidate: variant }) => base.case_id === variant.case_id && base.repetition === variant.repetition && base.task_role === variant.task_role)),
  check('paid_effects_zero', evidence.paid_model_calls === 0 && evidence.paid_cost === 0 && records.every((record) => record.paid_calls === 0 && record.fallback === false)),
  check('product_boundary_preserved', !DEFAULT_PRODUCT_MODEL_HARNESS_PROFILES.some((profile) => profile.profile_id === 'hy3' && profile.version === 2) && DEFAULT_PRODUCT_MODEL_HARNESS_PROFILES.some((profile) => profile.profile_id === 'generic' && profile.status === 'active')),
  check('no_profile_promoted', evidence.promotions.length === 1 && evidence.promotions[0].decision === 'B_REJECT_NO_VALUE'),
  check('success_gate_and_efficiency_gate', evaluation.metrics.generic.verified_success === 15 && evaluation.metrics.candidate.verified_success === 15 && evaluation.metrics.candidate.average_input_context_volume < evaluation.metrics.generic.average_input_context_volume && evidence.promotions[0].effect_size < 0.1),
]

const result = {
  contract: 'issue-33-independent-verifier.v1',
  corpus_fingerprint: corpus.fingerprint,
  plan_fingerprint: evaluation.plan_fingerprint,
  checks,
  planned_runs: plan.max_live_runs,
  completed_runs: records.length,
  generic_verified_success: generic.filter((record) => record.verified_success === true).length,
  candidate_verified_success: candidate.filter((record) => record.verified_success === true).length,
  generic_average_input_context_volume: evaluation.metrics.generic.average_input_context_volume,
  candidate_average_input_context_volume: evaluation.metrics.candidate.average_input_context_volume,
  effect_size: evidence.promotions[0].effect_size,
  promotion_decision: evidence.promotions[0].decision,
  result: checks.every((item) => item.ok) ? 'PASS' : 'FAIL',
}
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({ output_path: path.relative(repoRoot, outputPath), ...result }, null, 2))
if (result.result !== 'PASS') process.exitCode = 1
