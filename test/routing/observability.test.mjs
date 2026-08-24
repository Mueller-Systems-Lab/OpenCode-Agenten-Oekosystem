// SPDX-License-Identifier: MIT
/**
 * Routing observability tests — events, provenance, no secret leak.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  routeSelectedEvent,
  routeRejectedEvent,
  escalationEvent,
  providerFallbackEvent,
  workerStartEvent,
  workerResultEvent,
  workerFailureEvent,
  ROUTING_EVENT_JOBS,
} from '../../runtime/routing/routing-events.mjs'
import { loadRunEvents, runIdsOf, hasSecretLeak } from '../../runtime/observability/run-events.mjs'
import { validate } from '../../runtime/contracts/run-event.mjs'

const route = { provider: 'deepseek', model: 'deepseek-v4-flash', routing_reason: 'PRIMARY_ROUTE', capabilities: ['tools', 'mcp'] }

describe('routing observability events', () => {
  it('all routing event jobs are declared', () => {
    for (const job of ['model.route.selected', 'model.route.rejected', 'model.escalation', 'provider.fallback', 'model.worker.start', 'model.worker.result', 'model.worker.failure']) {
      assert.ok(ROUTING_EVENT_JOBS.includes(job), job)
    }
  })

  it('route selected event is a valid run-event with provider/model provenance', () => {
    const event = routeSelectedEvent({ run_id: 'run-1', route })
    const validation = validate(event)
    assert.equal(validation.ok, true, validation.issues.join('; '))
    assert.equal(event.phase, 'ROUTING')
    assert.equal(event.job, 'model.route.selected')
    assert.equal(event.provider, 'deepseek')
    assert.equal(event.model, 'deepseek-v4-flash')
    assert.equal(event.strategy_delta, 'PRIMARY_ROUTE')
  })

  it('escalation event carries from/to provenance (redacted reason)', () => {
    const event = escalationEvent({
      run_id: 'run-1',
      from: { provider: 'deepseek', model: 'deepseek-chat' },
      to: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      failure_class: 'MODEL_CAPABILITY_INSUFFICIENT',
      routing_reason: 'insufficient capability',
    })
    assert.equal(validate(event).ok, true)
    assert.equal(event.input_fingerprint, 'deepseek/deepseek-chat')
    assert.equal(event.output_fingerprint, 'deepseek/deepseek-v4-flash')
    assert.equal(event.failure_signature, 'ESCALATION:MODEL_CAPABILITY_INSUFFICIENT')
    assert.equal(event.run_id, 'run-1')
  })

  it('provider fallback event is distinct from escalation', () => {
    const event = providerFallbackEvent({
      run_id: 'run-1',
      from: { provider: 'deepseek', model: 'deepseek-chat' },
      to: { provider: 'openai', model: 'gpt-5.4-mini' },
      failure_class: 'PROVIDER_UNAVAILABLE',
    })
    assert.equal(validate(event).ok, true)
    assert.equal(event.job, 'provider.fallback')
    assert.equal(event.failure_signature, 'PROVIDER_FALLBACK:PROVIDER_UNAVAILABLE')
  })

  it('worker events carry the assigned route', () => {
    const start = workerStartEvent({ run_id: 'run-1', route })
    const result = workerResultEvent({ run_id: 'run-1', route, status: 'SUCCESS' })
    const failure = workerFailureEvent({ run_id: 'run-1', route, failure_class: 'MODEL_OUTPUT_INVALID', reason: 'output invalid' })
    for (const event of [start, result, failure]) {
      assert.equal(validate(event).ok, true)
      assert.equal(event.provider, 'deepseek')
      assert.equal(event.model, 'deepseek-v4-flash')
    }
    assert.equal(failure.failure_signature, 'WORKER_FAILURE:MODEL_OUTPUT_INVALID')
  })

  it('routing events never leak secrets (sink round-trip)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-routing-events-'))
    const sink = path.join(dir, 'events.jsonl')
    const events = [
      routeSelectedEvent({ run_id: 'run-1', route }),
      escalationEvent({ run_id: 'run-1', from: { provider: 'deepseek', model: 'deepseek-chat' }, to: { provider: 'deepseek', model: 'deepseek-v4-flash' }, failure_class: 'MODEL_CAPABILITY_INSUFFICIENT', routing_reason: 'request Authorization: Bearer sk-supersecret1234567890 failed' }),
      workerFailureEvent({ run_id: 'run-1', route, failure_class: 'MODEL_OUTPUT_INVALID', reason: 'Authorization: Bearer sk-abcdefgh1234567890 invalid' }),
    ]
    const { appendRunEvent } = await import('../../runtime/observability/run-events.mjs')
    for (const event of events) await appendRunEvent(sink, event)
    const loaded = await loadRunEvents(sink)
    assert.equal(runIdsOf(loaded).length, 1)
    assert.equal(runIdsOf(loaded)[0], 'run-1')
    assert.equal(hasSecretLeak(loaded), false, 'no secret may leak into routing events')
    assert.equal(loaded.some((e) => JSON.stringify(e).includes('sk-supersecret1234567890')), false)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('route rejected event fails closed with redacted reason', () => {
    const event = routeRejectedEvent({ run_id: 'run-1', reason_code: 'ROUTING_CAPABILITY_INCOMPATIBLE', reason: 'needs api_key=abcdefgh123456789012345678901234567890 for MCP' })
    assert.equal(validate(event).ok, true)
    assert.equal(event.status, 'FAIL')
    assert.equal(event.failure_signature, 'ROUTE_REJECTED:ROUTING_CAPABILITY_INCOMPATIBLE')
    assert.ok(!event.strategy_delta.includes('abcdefgh123456789012345678901234567890'))
  })
})
