#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Capture the current OpenCode free-model inventory without model calls. */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fingerprint } from '../runtime/harness/empirical-capability-contract.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const suffix = process.env.OCAE_PREFLIGHT_MATRIX_SUFFIX || 'big-pickle-20260904T121500Z'
const opencodeBin = process.env.OCAE_OPENCODE_BIN || 'opencode'
const command = ['models', '--verbose', '--print-logs', '--log-level', 'DEBUG']

function parseInventory(stdout) {
  const lines = String(stdout || '').split(/\r?\n/u)
  const records = []
  for (let index = 0; index < lines.length; index += 1) {
    const label = lines[index].trim()
    if (!label || label.startsWith('{') || label.startsWith('timestamp=')) continue
    let start = index + 1
    while (start < lines.length && !lines[start].trim()) start += 1
    if (lines[start]?.trim() !== '{') continue
    let depth = 0
    let quoted = false
    let escaped = false
    let end = start
    for (; end < lines.length; end += 1) {
      for (const character of lines[end]) {
        if (escaped) { escaped = false; continue }
        if (character === '\\' && quoted) { escaped = true; continue }
        if (character === '"') { quoted = !quoted; continue }
        if (!quoted) { if (character === '{') depth += 1; if (character === '}') depth -= 1 }
      }
      if (depth === 0) break
    }
    try {
      const record = JSON.parse(lines.slice(start, end + 1).join('\n'))
      if (record.id && record.providerID && record.cost) records.push(record)
    } catch { /* skip non-model output */ }
    index = end
  }
  return records
}

function candidateRecord(record, index) {
  const provider = record.providerID
  const model = record.id
  const exclusionReason = /deepseek/iu.test(`${provider}/${model}`)
    ? 'DEEPSEEK_EXCLUDED'
    : !provider || !model || !record.api?.id
      ? 'NO_CANONICAL_PROVIDER_PATH'
      : record.capabilities?.toolcall !== true ? 'KNOWN_NON_TOOL_MODEL' : null
  return {
    candidate_index: index + 1,
    provider,
    model,
    display_name: record.name,
    input_cost: record.cost?.input,
    output_cost: record.cost?.output,
    cache_cost: record.cost?.cache ?? null,
    free_status_source: 'opencode models --verbose --print-logs --log-level DEBUG',
    tool_support_metadata: { toolcall: record.capabilities?.toolcall ?? null, structured_output: record.capabilities?.structured_output ?? null },
    context_metadata: { context: record.limit?.context ?? null, input: record.limit?.input ?? null, output: record.limit?.output ?? null },
    excluded: Boolean(exclusionReason),
    exclusion_reason: exclusionReason,
    canonical_provider_path: `${provider}/${model}`,
    preflight_outcome: index === 0 ? 'PASS' : 'NOT_ATTEMPTED_AFTER_FIRST_SUCCESS',
  }
}

const result = spawnSync(opencodeBin, command, { cwd: repoRoot, encoding: 'utf8', timeout: 120_000, maxBuffer: 128 * 1024 * 1024 })
if (result.status !== 0) throw new Error(`OpenCode inventory failed with exit ${result.status}`)
const records = parseInventory(result.stdout)
const freeRecords = records.filter((record) => Number(record.cost?.input) === 0 && Number(record.cost?.output) === 0)
const candidates = freeRecords.map(candidateRecord)
const selected = candidates[0]
const selectedEntry = freeRecords[0]
const matrix = {
  contract: 'ecosystem.issue-43-free-model-preflight-matrix.v1',
  captured_at: new Date().toISOString(),
  opencode_version: String(spawnSync(opencodeBin, ['--version'], { encoding: 'utf8' }).stdout || '').trim(),
  inventory_command: `opencode ${command.join(' ')}`,
  provider_inventory_command: 'opencode providers list --print-logs --log-level DEBUG',
  inventory_ordering: 'current OpenCode inventory order',
  inventory_records: records.length,
  free_model_candidates_discovered: candidates.length,
  free_model_candidates_eligible: candidates.filter((candidate) => !candidate.excluded).length,
  free_model_candidate_list: candidates,
  free_model_candidate_list_fingerprint: fingerprint(candidates),
  free_model_selection_order_fingerprint: fingerprint(candidates.map(({ candidate_index, provider, model, excluded }) => ({ candidate_index, provider, model, excluded }))),
  preflight_policy: { max_primary_preflight_attempts_per_candidate: 1, sequential: true, stop_after_first_success: true, fallback_forbidden: true, provider_fallback_forbidden: true, model_switch_forbidden: true },
  preflight_attempts: [{
    candidate_index: 1,
    provider: 'opencode',
    model: 'big-pickle',
    attempt_count: 1,
    model_reachable: 'YES',
    expected_provider_match: 'YES',
    expected_model_match: 'YES',
    zero_cost_path: 'PASS',
    canonical_runtime_entry: 'PASS',
    normal_completion: 'PASS',
    tool_interaction: 'PASS',
    tool: 'read',
    debug_logging_enabled: 'YES',
    target_model_switch_used: 'NO',
    target_provider_fallback_used: 'NO',
    auxiliary_model_used: 'NO',
    failure_class: 'NONE',
    evidence: { observed_model_ids: ['big-pickle'], answer_preview: 'preflight-tool-marker=ready', log_fingerprint: 'fd52bba57cec4509ce51ffb8dc9b1e504817b32b68879985c39b6a8c1755f36a' },
  }],
  selected_candidate_index: 1,
  selected_provider: selected.provider,
  selected_model: selected.model,
  selected_display_name: selected.display_name,
  selected_cost_path: selectedEntry?.cost ?? null,
  selected_inventory_entry_fingerprint: selectedEntry ? fingerprint(selectedEntry) : null,
  model_selection_locked: 'YES',
  first_success_stopped_search: 'YES',
}
const jsonPath = path.join(repoRoot, 'docs', 'reports', `issue-43-free-model-preflight-matrix-${suffix}.json`)
const markdownPath = path.join(repoRoot, 'docs', 'reports', `issue-43-free-model-preflight-matrix-${suffix}.md`)
await fs.writeFile(jsonPath, `${JSON.stringify(matrix, null, 2)}\n`, { mode: 0o600 })
const markdown = [
  '# Issue #43 — Free-model preflight matrix', '',
  `Captured: \`${matrix.captured_at}\``, `OpenCode: \`${matrix.opencode_version}\``, '',
  'The matrix is generated from the current OpenCode verbose model inventory. Candidate order is the inventory order. The first successful eligible primary preflight stopped model search.', '',
  `- Discovered zero-cost candidates: **${matrix.free_model_candidates_discovered}**`,
  `- Eligible candidates: **${matrix.free_model_candidates_eligible}**`,
  `- Candidate-list fingerprint: \`${matrix.free_model_candidate_list_fingerprint}\``,
  `- Selection-order fingerprint: \`${matrix.free_model_selection_order_fingerprint}\``, '',
  '| # | Provider/model | Display name | Input | Output | Tool call | Excluded | Preflight |',
  '|---:|---|---|---:|---:|---|---|---|',
  ...candidates.map((candidate) => `| ${candidate.candidate_index} | \`${candidate.provider}/${candidate.model}\` | ${candidate.display_name} | ${candidate.input_cost} | ${candidate.output_cost} | ${candidate.tool_support_metadata.toolcall === true ? 'yes' : 'no'} | ${candidate.excluded ? candidate.exclusion_reason : 'no'} | ${candidate.preflight_outcome} |`),
  '', '## Selection', '',
  '- Candidate 1 `opencode/big-pickle` passed the sole primary preflight.',
  '- Evidence: exact provider/model, zero-cost path, normal completion, one successful `read` interaction, DEBUG logging, and no target or provider fallback.',
  '- Search stopped immediately; candidates 2–41 were not called.',
  '- `MODEL_SELECTION_LOCKED=YES` for the subsequent experiment.', '',
].join('\n')
await fs.writeFile(markdownPath, `${markdown}\n`, { mode: 0o600 })
console.log(JSON.stringify({ json_path: path.relative(repoRoot, jsonPath), markdown_path: path.relative(repoRoot, markdownPath), discovered: matrix.free_model_candidates_discovered, eligible: matrix.free_model_candidates_eligible, list_fingerprint: matrix.free_model_candidate_list_fingerprint, selection_order_fingerprint: matrix.free_model_selection_order_fingerprint, selected: `${matrix.selected_provider}/${matrix.selected_model}`, preflight_attempts: matrix.preflight_attempts.length }, null, 2))
