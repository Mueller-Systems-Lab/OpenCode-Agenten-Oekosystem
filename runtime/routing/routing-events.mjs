// SPDX-License-Identifier: MIT
/**
 * Routing observability events.
 *
 * Emitted into the run's canonical event sink (ecosystem.run-event.v1). All
 * routing events carry the SAME run_id as the task — a route change never
 * changes the run identity. No secrets: only provider/model identifiers,
 * failure classes, routing reasons, and fingerprints.
 */
import { createRunEvent } from '../observability/run-events.mjs'
import { redactFailureReason } from './failure-classifier.mjs'
import { isUsagePresent } from './usage.mjs'

export const ROUTING_EVENT_JOBS = Object.freeze([
  'model.route.selected',
  'model.route.rejected',
  'model.escalation',
  'provider.fallback',
  'model.worker.start',
  'model.worker.result',
  'model.worker.failure',
  // Availability & cost governance observability (additive)
  'model.health.probe.start',
  'model.health.probe.result',
  'model.health.state.changed',
  'model.usage',
  // Shared runtime budget observability (additive — shared budget governor)
  'budget.shared.reserve',
  'budget.shared.consume',
  'budget.shared.release',
  'budget.shared.expire',
  'budget.shared.deny',
])

export function routeSelectedEvent({ run_id, route, attempt = 0, phase = 'ROUTING', health_status = null, cost_tier = null, routing_budget_remaining = null } = {}) {
  return createRunEvent({
    run_id,
    phase,
    job: 'model.route.selected',
    status: 'PASS',
    attempt,
    provider: route?.provider || null,
    model: route?.model || null,
    input_fingerprint: route?.capabilities ? `cap:${route.capabilities.sort().join(',')}` : null,
    strategy_delta: route?.routing_reason || null,
    health_status: health_status ?? route?.health_status ?? null,
    cost_tier: cost_tier ?? route?.cost_tier ?? null,
    routing_budget_remaining: routing_budget_remaining ?? route?.routing_budget_remaining ?? null,
    contract_out: 'routing.route.v1',
  })
}

export function routeRejectedEvent({ run_id, reason_code = null, reason = null, attempt = 0, phase = 'ROUTING' } = {}) {
  return createRunEvent({
    run_id,
    phase,
    job: 'model.route.rejected',
    status: 'FAIL',
    attempt,
    failure_signature: `ROUTE_REJECTED:${String(reason_code || 'UNKNOWN')}`,
    strategy_delta: redactFailureReason(reason),
    contract_out: 'routing.route.v1',
  })
}

export function escalationEvent({ run_id, from, to, failure_class = null, routing_reason = null, attempt = 0, phase = 'ROUTING', health_status = null, cost_tier = null, routing_budget_remaining = null, transition_reason = null } = {}) {
  return createRunEvent({
    run_id,
    phase,
    job: 'model.escalation',
    status: 'PASS',
    attempt,
    provider: to?.provider || null,
    model: to?.model || null,
    input_fingerprint: from ? `${from.provider}/${from.model}` : null,
    output_fingerprint: to ? `${to.provider}/${to.model}` : null,
    failure_signature: `ESCALATION:${String(failure_class || 'UNKNOWN')}`,
    strategy_delta: redactFailureReason(routing_reason) || transition_reason || null,
    health_status: health_status ?? to?.health_status ?? null,
    cost_tier: cost_tier ?? to?.cost_tier ?? null,
    routing_budget_remaining: routing_budget_remaining ?? to?.routing_budget_remaining ?? null,
    contract_out: 'routing.route.v1',
  })
}

export function providerFallbackEvent({ run_id, from, to, failure_class = null, routing_reason = null, attempt = 0, phase = 'ROUTING', health_status = null, cost_tier = null, routing_budget_remaining = null, transition_reason = null } = {}) {
  return createRunEvent({
    run_id,
    phase,
    job: 'provider.fallback',
    status: 'PASS',
    attempt,
    provider: to?.provider || null,
    model: to?.model || null,
    input_fingerprint: from ? `${from.provider}/${from.model}` : null,
    output_fingerprint: to ? `${to.provider}/${to.model}` : null,
    failure_signature: `PROVIDER_FALLBACK:${String(failure_class || 'UNKNOWN')}`,
    strategy_delta: redactFailureReason(routing_reason) || transition_reason || null,
    health_status: health_status ?? to?.health_status ?? null,
    cost_tier: cost_tier ?? to?.cost_tier ?? null,
    routing_budget_remaining: routing_budget_remaining ?? to?.routing_budget_remaining ?? null,
    contract_out: 'routing.route.v1',
  })
}

export function healthProbeStartEvent({ run_id, provider, model, phase = 'ROUTING', attempt = 0 } = {}) {
  return createRunEvent({
    run_id,
    phase,
    job: 'model.health.probe.start',
    status: 'PASS',
    attempt,
    provider,
    model,
    contract_out: 'routing.health.v1',
  })
}

export function healthProbeResultEvent({ run_id, provider, model, ok = false, health_status = 'UNKNOWN', failure_class = null, latency_ms = null, retry_after = null, attempt = 0, phase = 'ROUTING' } = {}) {
  return createRunEvent({
    run_id,
    phase,
    job: 'model.health.probe.result',
    status: ok ? 'PASS' : 'FAIL',
    attempt,
    provider,
    model,
    failure_signature: `PROBE:${String(failure_class || 'OK')}`,
    health_status,
    latency_ms,
    retry_after,
    contract_out: 'routing.health.v1',
  })
}

export function healthStateChangedEvent({ run_id, provider, model, from = 'UNKNOWN', to = 'UNKNOWN', failure_class = null, source = 'PROBE', attempt = 0, phase = 'ROUTING' } = {}) {
  return createRunEvent({
    run_id,
    phase,
    job: 'model.health.state.changed',
    status: 'PASS',
    attempt,
    provider,
    model,
    health_status: to,
    strategy_delta: `${from}->${to}`,
    failure_signature: failure_class ? `HEALTH_STATE_CHANGED:${failure_class}` : null,
    contract_out: 'routing.health.v1',
  })
}

export function usageEvent({ run_id, usage = null, phase = 'BUILD', attempt = 0 } = {}) {
  const u = usage && typeof usage === 'object' ? usage : {}
  return createRunEvent({
    run_id,
    phase,
    job: 'model.usage',
    status: 'PASS',
    attempt,
    provider: u.provider || null,
    model: u.model || null,
    usage_status: u.usage_status || (isUsagePresent(u) ? 'AVAILABLE' : 'UNAVAILABLE'),
    usage_input_tokens: u.input_tokens ?? null,
    usage_output_tokens: u.output_tokens ?? null,
    usage_total_tokens: u.total_tokens ?? null,
    provider_reported_cost: u.provider_reported_cost ?? null,
    contract_out: 'routing.usage.v1',
  })
}

export function workerStartEvent({ run_id, route, attempt = 0, phase = 'BUILD' } = {}) {
  return createRunEvent({
    run_id,
    phase,
    job: 'model.worker.start',
    status: 'PASS',
    attempt,
    provider: route?.provider || null,
    model: route?.model || null,
    strategy_delta: route?.routing_reason || null,
    contract_out: 'routing.worker.v1',
  })
}

export function workerResultEvent({ run_id, route, status = 'SUCCESS', attempt = 0, phase = 'BUILD' } = {}) {
  return createRunEvent({
    run_id,
    phase,
    job: 'model.worker.result',
    status: status === 'SUCCESS' ? 'PASS' : 'FAIL',
    attempt,
    provider: route?.provider || null,
    model: route?.model || null,
    failure_signature: status === 'SUCCESS' ? null : `WORKER_RESULT:${String(status)}`,
    contract_out: 'routing.worker.v1',
  })
}

export function workerFailureEvent({ run_id, route, failure_class = null, reason = null, attempt = 0, phase = 'BUILD' } = {}) {
  return createRunEvent({
    run_id,
    phase,
    job: 'model.worker.failure',
    status: 'FAIL',
    attempt,
    provider: route?.provider || null,
    model: route?.model || null,
    failure_signature: `WORKER_FAILURE:${String(failure_class || 'UNKNOWN')}`,
    strategy_delta: redactFailureReason(reason),
    contract_out: 'routing.worker.v1',
  })
}

export { redactFailureReason }
