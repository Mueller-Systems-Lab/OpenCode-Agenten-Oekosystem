// SPDX-License-Identifier: MIT
/**
 * Health state machine tests — runtime-owned availability evidence.
 *
 * Pflicht-Negativtest A: stale HEALTHY must NEVER be routed (expired health
 * resolves to UNKNOWN); worker/tool output can never write health.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  HealthStore,
  HEALTH_STATES,
  healthStatusRank,
  isHealthStateValid,
  healthRoutable,
} from '../../runtime/routing/index.mjs'

describe('health state machine', () => {
  it('UNKNOWN default for missing entry', () => {
    const store = new HealthStore()
    const entry = store.get('deepseek', 'x')
    assert.equal(entry.status, 'UNKNOWN')
  })

  it('HEALTHY probe result is stored and valid', () => {
    const store = new HealthStore()
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'HEALTHY', ttl_seconds: 300 })
    const entry = store.get('deepseek', 'm')
    assert.equal(entry.status, 'HEALTHY')
    assert.ok(entry.expires_at > entry.observed_at, 'expires_at must be after observed_at')
  })

  it('TTL is clamped to bounds', () => {
    const store = new HealthStore()
    const low = store.applyProbeResult({ provider: 'deepseek', model: 'a', status: 'HEALTHY', ttl_seconds: 1 })
    assert.equal(low.ttl_seconds, 10, 'below-min TTL must clamp to the 10s bound')
    const high = store.applyProbeResult({ provider: 'deepseek', model: 'b', status: 'HEALTHY', ttl_seconds: 999999 })
    assert.equal(high.ttl_seconds, 7200, 'above-max TTL must clamp to the 7200s bound')
  })

  it('expired HEALTHY resolves to UNKNOWN (stale health never routed)', () => {
    let now = 1000000
    const store = new HealthStore({ clock: () => now })
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'HEALTHY', ttl_seconds: 10 })
    assert.equal(store.get('deepseek', 'm').status, 'HEALTHY')
    now = 1000000 + 11 * 1000
    const resolved = store.get('deepseek', 'm')
    assert.equal(resolved.status, 'UNKNOWN', 'expired HEALTHY must resolve to UNKNOWN')
    assert.equal(resolved.source, 'TTL_EXPIRED')
  })

  it('RATE_LIMITED entry is valid until TTL', () => {
    let now = 2000000
    const store = new HealthStore({ clock: () => now })
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'RATE_LIMITED', ttl_seconds: 60 })
    assert.equal(store.get('deepseek', 'm').status, 'RATE_LIMITED')
    now = 2000000 + 61 * 1000
    assert.equal(store.get('deepseek', 'm').status, 'UNKNOWN')
  })

  it('AUTH_FAILED never auto-recovers without new probe', () => {
    let now = 3000000
    const store = new HealthStore({ clock: () => now })
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'AUTH_FAILED', ttl_seconds: 900 })
    assert.equal(store.get('deepseek', 'm').status, 'AUTH_FAILED')
    now = 3000000 + 901 * 1000
    assert.equal(store.get('deepseek', 'm').status, 'UNKNOWN', 'AUTH_FAILED must not auto-recover')
    // Recovery only via a new valid probe (§107/108).
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'HEALTHY', ttl_seconds: 300 })
    assert.equal(store.get('deepseek', 'm').status, 'HEALTHY')
  })

  it('state transitions UNKNOWN→HEALTHY→RATE_LIMITED→HEALTHY→UNAVAILABLE', () => {
    const store = new HealthStore({ clock: () => 4000000 })
    assert.equal(store.get('deepseek', 'm').status, 'UNKNOWN')
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'HEALTHY' })
    assert.equal(store.get('deepseek', 'm').status, 'HEALTHY')
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'RATE_LIMITED' })
    assert.equal(store.get('deepseek', 'm').status, 'RATE_LIMITED')
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'HEALTHY' })
    assert.equal(store.get('deepseek', 'm').status, 'HEALTHY')
    store.applyProbeResult({ provider: 'deepseek', model: 'm', status: 'UNAVAILABLE' })
    assert.equal(store.get('deepseek', 'm').status, 'UNAVAILABLE')
  })

  it('applyProbeResult rejects invalid status', () => {
    const store = new HealthStore()
    assert.throws(
      () => store.applyProbeResult({ provider: 'x', model: 'y', status: 'BOGUS' }),
      /HEALTH_INVALID/,
    )
  })

  it('applyProbeResult rejects non-runtime-writable source', () => {
    const store = new HealthStore()
    assert.throws(
      () => store.applyProbeResult({ provider: 'x', model: 'y', status: 'HEALTHY', source: 'WORKER' }),
      /HEALTH_INVALID/,
    )
    assert.throws(
      () => store.applyProbeResult({ provider: 'x', model: 'y', status: 'HEALTHY', source: 'TOOL' }),
      /HEALTH_INVALID/,
    )
  })

  it('no public method accepts worker status', () => {
    const store = new HealthStore()
    assert.ok(!store.applyWorkerStatus && !store.set, 'worker write path must not exist')
  })

  it('UNKNOWN is never routable', () => {
    assert.equal(
      isHealthStateValid({ entry: { status: 'UNKNOWN', expires_at: Date.now() + 100000 } }),
      false,
      'UNKNOWN must never be a valid health state',
    )
    assert.equal(healthRoutable({ status: 'UNKNOWN' }), false, 'UNKNOWN must never be routable')
    // Unknown-like ranks fail closed to Infinity (never selected by ranking).
    assert.equal(healthStatusRank('NOT_A_STATE', HEALTH_STATES), Number.POSITIVE_INFINITY)
  })
})
