#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Small live ladder for isolating the first GLM-5.3 observation regression. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createOpenCodeLiveExecutor, invokeOpenCode, parseOpenCodeEvents } from '../runtime/harness/live-qualification.mjs'
import { fingerprint } from '../runtime/harness/empirical-capability-contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const provider = 'zai-coding-plan'
const model = 'glm-5.3'
const opencodeBin = process.env.OCAE_OPENCODE_BIN || 'opencode'
const timeoutMs = Number(process.env.OCAE_CANARY_TIMEOUT_MS || 90_000)
const repetitions = Number(process.env.OCAE_CANARY_REPETITIONS || 3)
const outputPath = process.env.OCAE_CANARY_OUTPUT_PATH
  ? path.resolve(repoRoot, process.env.OCAE_CANARY_OUTPUT_PATH)
  : path.join(repoRoot, 'docs', 'reports', `issue-43-observation-interposition-canary-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/u, 'Z')}.json`)
const reportRoot = path.join(repoRoot, 'docs', 'reports')
if (!outputPath.startsWith(`${reportRoot}${path.sep}`)) throw new Error('CONTRACT_INVALID:canary:evidence must remain under docs/reports')
if (!Number.isInteger(repetitions) || repetitions < 3 || repetitions > 5) throw new Error('CONTRACT_INVALID:canary:repetitions must be 3..5')

const modes = [
  { name: 'CONTROL', adapterMode: null },
  { name: 'IDENTITY', adapterMode: 'IDENTITY' },
  { name: 'ENVELOPE_ONLY', adapterMode: 'ENVELOPE_ONLY' },
  { name: 'STRUCTURED_TRANSFORM', adapterMode: 'STRUCTURED_TRANSFORM' },
  { name: 'TRUNCATED', adapterMode: 'TRUNCATED' },
]

function average(values) {
  const finite = values.filter((value) => Number.isFinite(value))
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
}

function eventSequenceTiming(result) {
  const timings = result.timing?.event_timings || []
  const resumeGaps = []
  for (let index = 0; index < timings.length; index += 1) {
    if (timings[index].type !== 'step_finish') continue
    const nextStart = timings.slice(index + 1).find((event) => event.type === 'step_start')
    if (nextStart) resumeGaps.push(Math.max(0, nextStart.latency_ms - timings[index].latency_ms))
  }
  return { provider_resume_latency_ms: average(resumeGaps), resume_gap_samples: resumeGaps.length }
}

function sanitizeResult(result) {
  const calls = result.tool_calls.map((call) => ({
    tool_call_id: call.call_id,
    tool_name: call.tool,
    tool_args_fingerprint: fingerprint(call.input || {}),
    status: call.status,
    argument_valid: call.argument_valid,
  }))
  const interposition = result.observation_interposition.map((item) => ({
    tool_call_id: item.tool_call_id,
    adapter_mode: item.adapter_mode,
    raw_observation_fingerprint: item.raw_observation_fingerprint,
    model_facing_observation_fingerprint: item.model_facing_observation_fingerprint,
    adapter_id: item.adapter_id,
    lossiness: item.lossiness,
    truncated: item.truncated,
    protocol_preserved: item.protocol_preserved,
    output_before: item.output_before,
    output_after: item.output_after,
    tool_execution_latency_ms: item.tool_execution_latency_ms,
    adapter_latency_ms: item.adapter_latency_ms,
    hook_latency_ms: item.hook_latency_ms,
  }))
  const callIds = new Set(calls.map((call) => call.tool_call_id).filter(Boolean))
  const receiptIds = new Set(result.observation_receipts.map((receipt) => receipt.tool_call_id).filter(Boolean))
  const interpositionIds = new Set(interposition.map((item) => item.tool_call_id).filter(Boolean))
  const identityOutputStable = interposition.every((item) => item.adapter_mode !== 'IDENTITY'
    || (item.output_before?.output_hash && item.output_before.output_hash === item.output_after?.output_hash))
  const metadataStable = interposition.every((item) => item.output_before?.metadata?.hash === item.output_after?.metadata?.hash
    && JSON.stringify(item.output_before?.metadata?.keys || []) === JSON.stringify(item.output_after?.metadata?.keys || []))
  const toolStatusStable = result.observation_receipts.every((receipt) => receipt.status === 'SUCCESS'
    ? calls.some((call) => call.tool_call_id === receipt.tool_call_id && call.status === 'COMPLETED')
    : true)
  const eventSequence = result.message_sequence || []
  const sequenceShape = eventSequence.every((type, index) => type !== 'tool_use' || eventSequence[index - 1] === 'step_start' || eventSequence[index - 1] === 'text')
  return {
    verified_success: result.verified_success,
    failure_class: result.failure_class,
    answer_fingerprint: result.answer_fingerprint,
    answer_length: result.answer_length,
    answer_preview: result.answer_preview,
    tool_selection_correct: result.metrics.tool_selection_correct,
    tool_argument_validity: result.metrics.tool_argument_validity,
    canonical_verifier: result.canonical_verifier,
    verifier_raw_authority: result.metrics.verifier_raw_authority,
    tool_calls: calls,
    observation_receipt_count: result.observation_receipts.length,
    observation_interposition_count: interposition.length,
    interposition,
    message_sequence: eventSequence,
    metadata_diff: {
      output_content_equal: identityOutputStable,
      result_metadata_equal: metadataStable,
      protocol_preserved: interposition.every((item) => item.protocol_preserved),
    },
    preservation: {
      tool_call_id: callIds.size === (interposition.length ? interpositionIds.size : receiptIds.size)
        && [...(interposition.length ? interpositionIds : receiptIds)].every((id) => callIds.has(id)),
      tool_identity: interposition.every((item) => calls.some((call) => call.tool_call_id === item.tool_call_id)),
      result_status: toolStatusStable,
      call_result_correlation: receiptIds.size === callIds.size && [...receiptIds].every((id) => callIds.has(id)),
      raw_receipt_propagation: result.observation_interposition.length === result.observation_receipts.length
        && interposition.every((item) => result.observation_receipts.some((receipt) => receipt.tool_call_id === item.tool_call_id && receipt.raw_fingerprint === item.raw_observation_fingerprint)),
    },
    timing: {
      total_latency_ms: result.timing?.total_latency_ms ?? result.metrics.latency_ms,
      process_latency_ms: result.timing?.process_latency_ms ?? null,
      first_event_latency_ms: result.timing?.first_event_latency_ms ?? null,
      tool_execution_latency_ms: average(interposition.map((item) => item.tool_execution_latency_ms)),
      adapter_latency_ms: average(interposition.map((item) => item.adapter_latency_ms)),
      hook_latency_ms: average(interposition.map((item) => item.hook_latency_ms)),
      ...eventSequenceTiming(result),
      model_latency_ms: result.timing?.first_event_latency_ms ?? null,
    },
  }
}

async function preflight() {
  const root = await fs.mkdtemp('/tmp/ocae-issue-43-canary-preflight-')
  try {
    const response = await invokeOpenCode({ opencode_bin: opencodeBin, provider, model, root, prompt: 'Reply with exactly PREFLIGHT_OK and nothing else. Do not use tools.', timeout_ms: timeoutMs })
    const events = parseOpenCodeEvents(response.stdout)
    const answer = events.filter((event) => event.type === 'text').map((event) => event.part?.text || '').join('')
    return { reachable: response.ok && answer.includes('PREFLIGHT_OK'), failure_class: response.failure_class, latency_ms: response.process_latency_ms ?? null, paid_calls: response.cost > 0 ? 1 : 0 }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

const hostVersion = execFileSync(opencodeBin, ['--version'], { encoding: 'utf8' }).trim()
const preflightResult = await preflight()
const output = {
  contract: 'ecosystem.issue-43-observation-interposition-canary.v1',
  timestamp: new Date().toISOString(), provider, model, opencode_version: hostVersion,
  timeout_ms: timeoutMs, repetitions, preflight: preflightResult,
  registration_path: 'explicit-project-config-plugin',
  stopped_after_first_regression: true,
  canaries: [],
}

if (preflightResult.reachable && preflightResult.paid_calls === 0) {
  for (const mode of modes) {
    const executor = createOpenCodeLiveExecutor({
      provider, model, opencode_bin: opencodeBin, timeout_ms: timeoutMs, repo_root: repoRoot,
      resolve_treatment: ({ default_profile }) => ({
        profile: default_profile,
        tool_policy: default_profile.effective_harness.tool_policy,
        tool_contract_framing: 'BASELINE',
        observation_adaptation: false,
        ...(mode.adapterMode ? { observation_mode: mode.adapterMode } : {}),
      }),
    })
    const runs = []
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const result = await executor.execute({ sequence: output.canaries.length * repetitions + repetition, arm: 'control', test_case: { case_id: 'read-observation', task_role: 'TOOL_USE' } })
      runs.push({ repetition, ...sanitizeResult(result) })
    }
    const summary = {
      layer: mode.name,
      runs: runs.length,
      verified_success: runs.filter((run) => run.verified_success).length,
      failures: runs.filter((run) => !run.verified_success).map((run) => run.failure_class || 'VERIFIER_REJECTION'),
      average_latency_ms: average(runs.map((run) => run.timing.total_latency_ms)),
      timing_averages: Object.fromEntries(['tool_execution_latency_ms', 'adapter_latency_ms', 'hook_latency_ms', 'provider_resume_latency_ms', 'model_latency_ms'].map((field) => [field, average(runs.map((run) => run.timing[field]))])),
      preservation: {
        tool_call_id: runs.every((run) => run.preservation.tool_call_id),
        tool_identity: runs.every((run) => run.preservation.tool_identity),
        result_status: runs.every((run) => run.preservation.result_status),
        call_result_correlation: runs.every((run) => run.preservation.call_result_correlation),
        raw_receipt_propagation: mode.adapterMode === null ? null : runs.every((run) => run.preservation.raw_receipt_propagation),
      },
      metadata_diff: {
        output_content_equal: runs.every((run) => run.metadata_diff.output_content_equal),
        result_metadata_equal: runs.every((run) => run.metadata_diff.result_metadata_equal),
        protocol_preserved: runs.every((run) => run.metadata_diff.protocol_preserved),
      },
      run_records: runs,
    }
    output.canaries.push(summary)
    if (summary.verified_success !== summary.runs) break
  }
}

output.live_model_reachable = preflightResult.reachable
output.first_failing_layer = output.canaries.find((canary) => canary.verified_success < canary.runs)?.layer || 'NONE'
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({ output_path: path.relative(repoRoot, outputPath), provider, model, opencode_version: hostVersion, live_model_reachable: output.live_model_reachable, first_failing_layer: output.first_failing_layer, canaries: output.canaries.map((canary) => ({ layer: canary.layer, verified_success: `${canary.verified_success}/${canary.runs}`, average_latency_ms: canary.average_latency_ms })) }, null, 2))
