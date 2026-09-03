#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Frozen Issue #43 causal isolation experiment. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { DEFAULT_MODEL_CATALOG, getCatalogEntry } from '../runtime/routing/model-catalog.mjs'
import { createQualificationIdentity, fingerprint } from '../runtime/harness/empirical-capability-contract.mjs'
import { createFrozenQualificationCorpora, createQualificationPlan, runQualification } from '../runtime/harness/qualification-runner.mjs'
import { resolveModelHarness } from '../runtime/harness/harness-resolver.mjs'
import { createOpenCodeLiveExecutor, invokeOpenCode, LIVE_RUNTIME_ID, LIVE_TOOL_SET, LIVE_VERIFIER_VERSION, parseOpenCodeEvents } from '../runtime/harness/live-qualification.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from '../runtime/harness/model-harness-profiles.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const provider = 'opencode'
const model = 'muse-spark-1.2-contributor-free'
const opencodeBin = process.env.OCAE_OPENCODE_BIN || 'opencode'
const timeoutMs = 90_000
const repetitions = 3
const contractRepetitions = 2
const experimentId = 'issue-43-causal-factor-isolation-20260903T215623Z'
const outputPath = path.join(repoRoot, 'docs', 'reports', `${experimentId}.json`)
const freezePath = path.join(repoRoot, 'docs', 'reports', `${experimentId}-freeze.json`)
const armDefinitions = Object.freeze({
  A: { tool_exposure: 'FULL_GENERIC', observation_adaptation: false, contract_framing: 'BASELINE' },
  B: { tool_exposure: 'TASK_MINIMAL', observation_adaptation: false, contract_framing: 'BASELINE' },
  C: { tool_exposure: 'FULL_GENERIC', observation_adaptation: true, contract_framing: 'BASELINE' },
  D: { tool_exposure: 'TASK_MINIMAL', observation_adaptation: true, contract_framing: 'BASELINE' },
})
const contractDefinitions = Object.freeze({
  CONTRACT_A_BASELINE: 'BASELINE',
  CONTRACT_B_SHORT_EXPLICIT: 'SHORT_EXPLICIT',
  CONTRACT_C_EXAMPLE_ASSISTED: 'EXAMPLE_ASSISTED',
})

function rate(rows, field) {
  const values = rows.map((row) => row.metrics?.[field]).filter((value) => typeof value === 'boolean')
  return { success: values.filter(Boolean).length, samples: values.length, rate: values.length ? values.filter(Boolean).length / values.length : null }
}

function average(rows, field) {
  const values = rows.map((row) => row.metrics?.[field] ?? row[field]).filter((value) => typeof value === 'number' && Number.isFinite(value))
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function total(rows, field) {
  return rows.reduce((sum, row) => sum + (Number.isFinite(row.metrics?.[field]) ? row.metrics[field] : 0), 0)
}

function summarize(records, arm) {
  const rows = records.filter((row) => row.arm === arm)
  const failureClasses = Object.fromEntries([...new Set(rows.map((row) => row.failure_class).filter(Boolean))].sort().map((name) => [name, rows.filter((row) => row.failure_class === name).length]))
  const interpositions = rows.flatMap((row) => row.observation_interposition || [])
  const distinctRaw = new Set(interpositions.map((item) => item.raw_observation_fingerprint).filter(Boolean))
  const distinctModelFacing = new Set(interpositions.map((item) => item.model_facing_observation_fingerprint).filter(Boolean))
  return {
    runs: rows.length,
    verified_success: { success: rows.filter((row) => row.verified_success).length, samples: rows.length, rate: rows.length ? rows.filter((row) => row.verified_success).length / rows.length : null },
    tool_selection_correct: rate(rows, 'tool_selection_correct'),
    tool_argument_validity: rate(rows, 'tool_argument_validity'),
    observation_comprehension: rate(rows, 'observation_status_comprehension'),
    source_attribution_correct: rate(rows, 'source_attribution_correct'),
    failure_class_comprehension: rate(rows, 'failure_class_comprehension'),
    grounded_final_claim: rate(rows, 'grounded_final_claim'),
    next_action_correct: rate(rows, 'next_action_correct'),
    invalid_tool_calls: { total: total(rows, 'invalid_tool_calls'), average: average(rows, 'invalid_tool_calls') },
    unnecessary_tool_calls: { total: total(rows, 'unnecessary_tool_calls'), average: average(rows, 'unnecessary_tool_calls') },
    argument_diagnostics: Object.fromEntries(['schema_parse_failure', 'wrong_argument_name', 'missing_required_argument', 'invalid_argument_type', 'semantic_argument_error'].map((name) => [name, total(rows, name)])),
    tool_calls: { total: total(rows, 'tool_call_count'), average: average(rows, 'tool_call_count') },
    input_context_volume: { total: rows.reduce((sum, row) => sum + (row.context_volume || 0), 0), average: average(rows, 'context_volume') },
    tool_result_volume: { total: rows.reduce((sum, row) => sum + (row.raw_result_volume || 0), 0), average: average(rows, 'raw_result_volume') },
    adapted_result_volume: { total: rows.reduce((sum, row) => sum + (row.adapted_result_volume || 0), 0), average: average(rows, 'adapted_result_volume') },
    total_model_visible_volume: { total: rows.reduce((sum, row) => sum + (row.context_volume || 0) + (row.adapted_result_volume || 0), 0), average: rows.length ? rows.reduce((sum, row) => sum + (row.context_volume || 0) + (row.adapted_result_volume || 0), 0) / rows.length : null },
    exposed_tool_count: { average: average(rows, 'exposed_tool_count') },
    source_count: { average: average(rows, 'source_count') },
    simultaneous_failure_count: { total: total(rows, 'simultaneous_failure_count'), average: average(rows, 'simultaneous_failure_count') },
    open_hypothesis_count: { average: average(rows, 'open_hypothesis_count') },
    retry_count: { total: rows.reduce((sum, row) => sum + (row.retry_count || 0), 0), average: average(rows, 'retry_count') },
    latency_ms: { average: average(rows, 'latency_ms') },
    failure_class_distribution: failureClasses,
    raw_observation_fingerprint_count: distinctRaw.size,
    model_facing_observation_fingerprint_count: distinctModelFacing.size,
    observation_interposition: {
      records: interpositions.length,
      adapter_ids: [...new Set(interpositions.map((item) => item.adapter_id).filter(Boolean))].sort(),
      all_interposed_before_model: interpositions.length > 0 && interpositions.every((item) => item.interposed_before_model),
      raw_and_model_facing_differ: interpositions.length > 0 && interpositions.every((item) => item.raw_observation_fingerprint !== item.model_facing_observation_fingerprint),
      provenance_preserved: interpositions.length > 0 && interpositions.every((item) => item.provenance === 'canonical-opencode-runtime'),
    },
    records: rows,
  }
}

function effect(rows, left, right, metric, lowerIsBetter = false) {
  const a = summarize(rows, left)
  const b = summarize(rows, right)
  const value = (summary) => {
    if (metric === 'verified_success') return summary.verified_success.rate
    if (metric === 'argument_validity') return summary.tool_argument_validity.rate
    if (metric === 'observation_comprehension') return summary.observation_comprehension.rate
    if (metric === 'tool_calls') return summary.tool_calls.average
    if (metric === 'input_context_volume') return summary.input_context_volume.average
    if (metric === 'tool_result_volume') return summary.tool_result_volume.average
    if (metric === 'latency') return summary.latency_ms.average
    return null
  }
  const delta = (value(b) ?? 0) - (value(a) ?? 0)
  return { from: left, to: right, metric, delta, lower_is_better: lowerIsBetter }
}

function pairedHoldout(records, arms) {
  const holdout = records.filter((row) => row.mode === 'CONFIRMATORY_HOLDOUT_CORPUS')
  const baseline = new Map(holdout.filter((row) => row.arm === arms[0]).map((row) => [`${row.case_id}|${row.repetition}`, row.verified_success]))
  const comparisons = Object.fromEntries(arms.slice(1).map((arm) => {
    const rows = holdout.filter((row) => row.arm === arm)
    const pairs = rows.map((row) => ({ row, baseline: baseline.get(`${row.case_id}|${row.repetition}`) })).filter((pair) => typeof pair.baseline === 'boolean')
    return [arm, { pairs: pairs.length, baseline_success: pairs.filter((pair) => pair.baseline).length, arm_success: pairs.filter((pair) => pair.row.verified_success).length, losses: pairs.filter((pair) => pair.baseline && !pair.row.verified_success).length, pass: pairs.length > 0 && pairs.every((pair) => !pair.baseline || pair.row.verified_success) }]
  }))
  return { baseline_arm: arms[0], comparisons, pass: Object.values(comparisons).every((comparison) => comparison.pass) }
}

async function preflight() {
  const root = await fs.mkdtemp('/tmp/ocae-issue-43-causal-preflight-')
  try {
    const response = await invokeOpenCode({ opencode_bin: opencodeBin, provider, model, root, prompt: 'Reply with exactly PREFLIGHT_OK and nothing else. Do not use tools.', timeout_ms: timeoutMs })
    const events = parseOpenCodeEvents(response.stdout)
    const answer = events.filter((event) => event.type === 'text').map((event) => event.part?.text || '').join('')
    return { model_reachable: response.ok && answer.includes('PREFLIGHT_OK'), live_model_evidence: response.ok && events.some((event) => event.type === 'step_finish'), paid_calls: response.cost > 0 ? 1 : 0, fallback_used: false, failure_class: response.failure_class, reported_cost: response.cost }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

const catalogEntry = getCatalogEntry(DEFAULT_MODEL_CATALOG, provider, model)
if (!catalogEntry || catalogEntry.enabled !== true || catalogEntry.cost_tier !== 'LOW' || catalogEntry.tool_support !== true) throw new Error('MODEL_NOT_ELIGIBLE:catalog')
const hostVersion = execFileSync(opencodeBin, ['--version'], { encoding: 'utf8' }).trim()
const corpora = createFrozenQualificationCorpora()
const repositoryFixtureFingerprint = fingerprint({ fixture: 'issue-43-live-qualification-scenarios.v1', cases: corpora.derivation.cases.concat(corpora.holdout.cases) })
const toolContractFingerprint = fingerprint({ host: 'opencode', version: hostVersion, tools: LIVE_TOOL_SET, contract: 'opencode-native-tool-result.v1' })
const observationContractFingerprint = fingerprint({ contract: 'ecosystem.tool-observation.v1', version: 1, adapter: 'ocae.live.tool-execute-after.v1' })
const harnessFingerprint = fingerprint({ experiment_id: experimentId, arm_definitions: armDefinitions, contract_definitions: contractDefinitions })
const identity = createQualificationIdentity({
  provider, model, runtime_class: LIVE_RUNTIME_ID, runtime_version_if_known: null, opencode_host_version: hostVersion,
  opencode_workspace_capability_fingerprint: fingerprint({ host: hostVersion, native_tool_surface: LIVE_TOOL_SET, format: 'json-events', lsp: 'host-managed' }),
  tool_contract_fingerprint: toolContractFingerprint, observation_contract_fingerprint: observationContractFingerprint,
  qualification_corpus_fingerprint: corpora.derivation.fingerprint, holdout_corpus_fingerprint: corpora.holdout.fingerprint,
  harness_fingerprint: harnessFingerprint, verifier_version: LIVE_VERIFIER_VERSION,
})
const primaryPlan = createQualificationPlan({ identity, corpora, model: { provider, model }, harness_fingerprint: harnessFingerprint, verifier_version: LIVE_VERIFIER_VERSION, granted_tools: [...LIVE_TOOL_SET], repetitions, max_rows: 128, arms: Object.keys(armDefinitions) })
const contractPlan = createQualificationPlan({ identity, corpora, model: { provider, model }, harness_fingerprint: harnessFingerprint, verifier_version: LIVE_VERIFIER_VERSION, granted_tools: [...LIVE_TOOL_SET], repetitions: contractRepetitions, max_rows: 128, arms: Object.keys(contractDefinitions) })
const executionOrder = [...primaryPlan.rows, ...contractPlan.rows].map((row) => ({ sequence: row.sequence, mode: row.mode, case_id: row.case_id, repetition: row.repetition, arm: row.arm }))
const frozen = {
  experiment_id: experimentId, model: { provider, model, runtime: LIVE_RUNTIME_ID, opencode_version: hostVersion },
  repository_fixture_fingerprint: repositoryFixtureFingerprint, derivation_corpus_fingerprint: corpora.derivation.fingerprint, holdout_corpus_fingerprint: corpora.holdout.fingerprint,
  tool_contract_fingerprint: toolContractFingerprint, observation_contract_fingerprint: observationContractFingerprint, verifier_version: LIVE_VERIFIER_VERSION,
  primary_repetitions: repetitions, contract_repetitions: contractRepetitions, timeout_ms: timeoutMs, retry_budget: 0,
  arm_definitions: armDefinitions, contract_definitions: contractDefinitions, execution_order: executionOrder, execution_order_fingerprint: fingerprint(executionOrder),
  primary_plan_fingerprint: primaryPlan.fingerprint, contract_plan_fingerprint: contractPlan.fingerprint,
}

await fs.writeFile(freezePath, `${JSON.stringify({ contract: 'ecosystem.issue-43-causal-factor-freeze.v1', status: 'FROZEN_BEFORE_LIVE_RUNS', frozen }, null, 2)}\n`, { mode: 0o600 })
const probe = await preflight()
const baseReport = { contract: 'ecosystem.issue-43-causal-factor-experiment.v1', experiment_id: experimentId, frozen, preflight: { ...probe, paid_calls_allowed: 0, fallback_disabled: true }, paid_calls: probe.paid_calls, fallback_used: probe.fallback_used, promoted_profile: 'NONE', promotion_decision: 'NONE' }
if (!probe.model_reachable || probe.paid_calls !== 0 || probe.fallback_used) {
  await fs.writeFile(outputPath, `${JSON.stringify({ ...baseReport, status: 'AMBER_OCAE_CAUSAL_EXPERIMENT_BLOCKED_MODEL_UNAVAILABLE' }, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ output_path: path.relative(repoRoot, outputPath), ...baseReport, status: 'AMBER_OCAE_CAUSAL_EXPERIMENT_BLOCKED_MODEL_UNAVAILABLE' }, null, 2))
  process.exitCode = 2
} else {
  const primaryExecutor = createOpenCodeLiveExecutor({ provider, model, opencode_bin: opencodeBin, timeout_ms: timeoutMs, repo_root: repoRoot, host_version: hostVersion, resolve_treatment: ({ row, scenario, default_profile }) => {
    const definition = armDefinitions[row.arm]
    const minimal = definition.tool_exposure === 'TASK_MINIMAL'
    const generic = resolveModelHarness({ provider: 'unmatched', model: 'generic', profiles: DEFAULT_MODEL_HARNESS_PROFILES, task_role: scenario.task_role }).effective_harness
    return {
      profile: default_profile, profile_id: `factorial.${row.arm}.v1`, harness_fingerprint: fingerprint({ experiment_id: experimentId, arm: row.arm, definition, task_role: scenario.task_role }),
      effective_harness: generic, tool_policy: minimal ? { tool_exposure: 'TASK_MINIMAL_TOOLSET', task_relevant_tools: [...scenario.required_tools] } : { tool_exposure: 'FULL_TOOLSET' },
      tool_contract_framing: definition.contract_framing, observation_adaptation: definition.observation_adaptation,
    }
  } })
  const primaryDerivation = await runQualification({ plan: primaryPlan, executor: primaryExecutor, mode: 'DERIVATION_CORPUS', concurrency: 2 })
  const primaryHoldout = await runQualification({ plan: primaryPlan, executor: primaryExecutor, mode: 'CONFIRMATORY_HOLDOUT_CORPUS', concurrency: 2 })
  const primaryRecords = [...primaryDerivation.records, ...primaryHoldout.records]
  const contractExecutor = createOpenCodeLiveExecutor({ provider, model, opencode_bin: opencodeBin, timeout_ms: timeoutMs, repo_root: repoRoot, host_version: hostVersion, resolve_treatment: ({ row, default_profile }) => ({
    profile: default_profile, profile_id: `contract.${row.arm}.v1`, harness_fingerprint: fingerprint({ experiment_id: experimentId, contract: row.arm }), tool_policy: { tool_exposure: 'FULL_TOOLSET' }, tool_contract_framing: contractDefinitions[row.arm], observation_adaptation: false,
  }) })
  const contractDerivation = await runQualification({ plan: contractPlan, executor: contractExecutor, mode: 'DERIVATION_CORPUS', concurrency: 2 })
  const contractHoldout = await runQualification({ plan: contractPlan, executor: contractExecutor, mode: 'CONFIRMATORY_HOLDOUT_CORPUS', concurrency: 2 })
  const contractRecords = [...contractDerivation.records, ...contractHoldout.records]
  const primarySummaries = Object.fromEntries(Object.keys(armDefinitions).map((arm) => [arm, { derivation: summarize(primaryDerivation.records, arm), holdout: summarize(primaryHoldout.records, arm), all: summarize(primaryRecords, arm) }]))
  const contractSummaries = Object.fromEntries(Object.keys(contractDefinitions).map((arm) => [arm, { derivation: summarize(contractDerivation.records, arm), holdout: summarize(contractHoldout.records, arm), all: summarize(contractRecords, arm) }]))
  const effects = {
    tool_exposure_effect: Object.fromEntries(['verified_success', 'argument_validity', 'observation_comprehension', 'tool_calls', 'input_context_volume', 'tool_result_volume', 'latency'].map((metric) => [metric, effect(primaryRecords, 'A', 'B', metric, ['tool_calls', 'input_context_volume', 'tool_result_volume', 'latency'].includes(metric))])),
    observation_adaptation_effect: Object.fromEntries(['verified_success', 'argument_validity', 'observation_comprehension', 'tool_calls', 'input_context_volume', 'tool_result_volume', 'latency'].map((metric) => [metric, effect(primaryRecords, 'A', 'C', metric, ['tool_calls', 'input_context_volume', 'tool_result_volume', 'latency'].includes(metric))])),
    combined_effect: Object.fromEntries(['verified_success', 'argument_validity', 'observation_comprehension', 'tool_calls', 'input_context_volume', 'tool_result_volume', 'latency'].map((metric) => [metric, effect(primaryRecords, 'A', 'D', metric, ['tool_calls', 'input_context_volume', 'tool_result_volume', 'latency'].includes(metric))])),
    observation_effect_under_minimal_tools: Object.fromEntries(['verified_success', 'argument_validity', 'observation_comprehension', 'tool_calls', 'input_context_volume', 'tool_result_volume', 'latency'].map((metric) => [metric, effect(primaryRecords, 'B', 'D', metric, ['tool_calls', 'input_context_volume', 'tool_result_volume', 'latency'].includes(metric))])),
    tool_exposure_effect_under_adapted_observations: Object.fromEntries(['verified_success', 'argument_validity', 'observation_comprehension', 'tool_calls', 'input_context_volume', 'tool_result_volume', 'latency'].map((metric) => [metric, effect(primaryRecords, 'C', 'D', metric, ['tool_calls', 'input_context_volume', 'tool_result_volume', 'latency'].includes(metric))])),
  }
  const holdoutConfirmation = pairedHoldout(primaryRecords, Object.keys(armDefinitions))
  const contractHoldoutConfirmation = pairedHoldout(contractRecords, Object.keys(contractDefinitions))
  const allRecords = [...primaryRecords, ...contractRecords]
  const paidCalls = allRecords.reduce((sum, row) => sum + row.paid_calls, probe.paid_calls)
  const fallbackUsed = allRecords.some((row) => row.fallback_used) || probe.fallback_used
  const genuineInterposition = primaryRecords.filter((row) => ['C', 'D'].includes(row.arm)).flatMap((row) => row.observation_interposition || [])
  const correctnessRegression = !holdoutConfirmation.pass || !contractHoldoutConfirmation.pass
  const securityRegression = paidCalls > 0 || fallbackUsed
  const eligiblePrimary = Object.keys(armDefinitions).filter((arm) => arm !== 'A' && primarySummaries[arm].holdout.verified_success.success >= primarySummaries.A.holdout.verified_success.success && !securityRegression)
  const bestResearchArm = eligiblePrimary.sort((left, right) => primarySummaries[right].all.verified_success.success - primarySummaries[left].all.verified_success.success)[0] || 'NONE'
  const eligibleContracts = Object.keys(contractDefinitions).filter((arm) => contractSummaries[arm].holdout.verified_success.success >= contractSummaries.CONTRACT_A_BASELINE.holdout.verified_success.success && !securityRegression)
  const bestContract = eligibleContracts.sort((left, right) => (contractSummaries[right].all.tool_argument_validity.rate || 0) - (contractSummaries[left].all.tool_argument_validity.rate || 0))[0] || 'NONE'
  const primaryValue = bestResearchArm !== 'NONE' && primarySummaries[bestResearchArm].all.verified_success.success >= primarySummaries.A.all.verified_success.success && bestResearchArm !== 'A'
  const contractValue = bestContract !== 'NONE' && (contractSummaries[bestContract].all.tool_argument_validity.rate || 0) > (contractSummaries.CONTRACT_A_BASELINE.all.tool_argument_validity.rate || 0)
  const output = {
    ...baseReport, status: securityRegression ? 'RED_OCAE_CAUSAL_SECURITY_REGRESSION' : correctnessRegression ? 'RED_OCAE_CAUSAL_CORRECTNESS_REGRESSION' : primaryValue || contractValue ? 'GREEN_OCAE_CAUSAL_HARNESS_FACTOR_VALUE_PROVEN' : 'GREEN_OCAE_CAUSAL_EXPERIMENT_PROVEN_NO_FACTOR_VALUE',
    provider, model, opencode_version: hostVersion, live_model_reachable: true, execution_order_fingerprint: frozen.execution_order_fingerprint,
    primary: primarySummaries, tool_contract: contractSummaries, effects, holdout_confirmation: holdoutConfirmation, contract_holdout_confirmation: contractHoldoutConfirmation,
    observation_validation: {
      genuine_live_observation_interposition: genuineInterposition.length > 0 && genuineInterposition.every((item) => item.interposed_before_model),
      raw_observation_fingerprinting: genuineInterposition.length > 0 && genuineInterposition.every((item) => Boolean(item.raw_observation_fingerprint)),
      model_facing_observation_fingerprinting: genuineInterposition.length > 0 && genuineInterposition.every((item) => Boolean(item.model_facing_observation_fingerprint)),
      raw_and_model_facing_differ: genuineInterposition.length > 0 && genuineInterposition.every((item) => item.raw_observation_fingerprint !== item.model_facing_observation_fingerprint),
      verifier_raw_authority: allRecords.every((row) => row.canonical_verifier && row.metrics?.verifier_raw_authority !== false),
      adapter_ids: [...new Set(genuineInterposition.map((item) => item.adapter_id))].sort(),
    },
    paid_calls: paidCalls, fallback_used: fallbackUsed, correctness_regression: correctnessRegression, security_regression: securityRegression,
    best_research_arm: bestResearchArm, best_tool_contract: bestContract,
  }
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ output_path: path.relative(repoRoot, outputPath), experiment_id: experimentId, provider, model, opencode_version: hostVersion, status: output.status, paid_calls: paidCalls, fallback_used: fallbackUsed, primary: Object.fromEntries(Object.entries(primarySummaries).map(([arm, summary]) => [arm, { derivation: summary.derivation.verified_success, holdout: summary.holdout.verified_success }])), tool_contract: Object.fromEntries(Object.entries(contractSummaries).map(([arm, summary]) => [arm, { all: summary.all.tool_argument_validity, holdout: summary.holdout.tool_argument_validity }])), best_research_arm: bestResearchArm, best_tool_contract: bestContract }, null, 2))
}
