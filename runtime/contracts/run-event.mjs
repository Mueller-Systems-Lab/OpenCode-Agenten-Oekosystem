// SPDX-License-Identifier: MIT
/**
 * ecosystem.run-event.v1
 *
 * Boundary observability event. Every event keeps the same run_id and is
 * attributed to a phase/job/attempt. No secrets, no full prompt dumps.
 * Fingerprints are hashes, never raw content.
 */
export const CONTRACT_ID = 'ecosystem.run-event.v1'
export const RUN_PHASES = Object.freeze(['TASK', 'BASELINE', 'ROUTING', 'RESEARCH', 'PLAN', 'PLAN_GATE', 'BUILD', 'VERIFY', 'VISUAL_QA', 'REVIEWS', 'CONTROLLER'])

export function create({
  run_id,
  phase,
  job,
  attempt = 0,
  timestamp = new Date().toISOString(),
  status,
  duration_ms = 0,
  agent = null,
  provider = null,
  model = null,
  input_fingerprint = null,
  output_fingerprint = null,
  failure_signature = null,
  strategy_delta = null,
  contract_in = null,
  contract_out = null,
  // Additive optional observability fields (availability & cost governance).
  // Default null → events created without them are byte-identical to before.
  health_status = null,
  cost_tier = null,
  routing_budget_remaining = null,
  latency_ms = null,
  retry_after = null,
  usage_status = null,
  usage_input_tokens = null,
  usage_output_tokens = null,
  usage_total_tokens = null,
  provider_reported_cost = null,
} = {}) {
  return {
    contract: CONTRACT_ID,
    run_id,
    phase,
    job,
    attempt,
    timestamp,
    status,
    duration_ms,
    agent,
    provider,
    model,
    input_fingerprint,
    output_fingerprint,
    failure_signature,
    strategy_delta,
    contract_in,
    contract_out,
    health_status,
    cost_tier,
    routing_budget_remaining,
    latency_ms,
    retry_after,
    usage_status,
    usage_input_tokens,
    usage_output_tokens,
    usage_total_tokens,
    provider_reported_cost,
  }
}

export function validate(value) {
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['run-event must be an object'] }
  }
  if (value.contract !== CONTRACT_ID) issues.push(`contract must be ${CONTRACT_ID}`)
  if (typeof value.run_id !== 'string' || value.run_id.trim().length === 0) issues.push('run_id must be a non-empty string')
  if (!RUN_PHASES.includes(value.phase)) issues.push(`phase must be one of ${RUN_PHASES.join(', ')}`)
  if (typeof value.job !== 'string' || value.job.trim().length === 0) issues.push('job must be a non-empty string')
  if (!Number.isInteger(value.attempt) || value.attempt < 0) issues.push('attempt must be a non-negative integer')
  if (typeof value.timestamp !== 'string' || Number.isNaN(Date.parse(value.timestamp))) issues.push('timestamp must be an ISO timestamp')
  if (typeof value.status !== 'string' || value.status.trim().length === 0) issues.push('status must be a non-empty string')
  if (!Number.isFinite(value.duration_ms) || value.duration_ms < 0) issues.push('duration_ms must be a non-negative number')
  for (const key of ['input_fingerprint', 'output_fingerprint', 'failure_signature', 'strategy_delta', 'contract_in', 'contract_out']) {
    if (value[key] !== null && value[key] !== undefined && typeof value[key] !== 'string') issues.push(`${key} must be a string or null`)
  }
  // Additive optional field validation (availability & cost governance):
  // string-or-null fields
  for (const key of ['health_status', 'cost_tier', 'usage_status']) {
    if (value[key] !== null && value[key] !== undefined && typeof value[key] !== 'string') issues.push(`${key} must be a string or null`)
  }
  // number-or-null fields
  for (const key of ['routing_budget_remaining', 'latency_ms', 'retry_after', 'usage_input_tokens', 'usage_output_tokens', 'usage_total_tokens', 'provider_reported_cost']) {
    if (value[key] !== null && value[key] !== undefined && !(typeof value[key] === 'number' && Number.isFinite(value[key]))) {
      issues.push(`${key} must be a number or null`)
    }
  }
  return { ok: issues.length === 0, issues }
}
