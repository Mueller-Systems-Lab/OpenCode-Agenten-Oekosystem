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

export const ROUTING_EVENT_JOBS = Object.freeze([
  'model.route.selected',
  'model.route.rejected',
  'model.escalation',
  'provider.fallback',
  'model.worker.start',
  'model.worker.result',
  'model.worker.failure',
])

export function routeSelectedEvent({ run_id, route, attempt = 0, phase = 'ROUTING' } = {}) {
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

export function escalationEvent({ run_id, from, to, failure_class = null, routing_reason = null, attempt = 0, phase = 'ROUTING' } = {}) {
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
    strategy_delta: redactFailureReason(routing_reason),
    contract_out: 'routing.route.v1',
  })
}

export function providerFallbackEvent({ run_id, from, to, failure_class = null, routing_reason = null, attempt = 0, phase = 'ROUTING' } = {}) {
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
    strategy_delta: redactFailureReason(routing_reason),
    contract_out: 'routing.route.v1',
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
