// SPDX-License-Identifier: MIT
/**
 * Usage observability tests (Pflicht-Negativtests M–N + §36-39, 100-102).
 *
 * Missing usage is UNAVAILABLE, never zeroed — a fabricated 0-token record
 * would be a false cost assertion. Records carry no text content.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseUsage,
  aggregateUsage,
  normalizeUsageNumber,
  usageRedacted,
} from '../../runtime/routing/index.mjs'

describe('usage parsing and accounting', () => {
  it('M: missing usage → UNAVAILABLE, never zeroed', () => {
    for (const raw of [null, {}, 'garbage', { foo: 1 }]) {
      const result = parseUsage(raw)
      assert.equal(result.ok, false, `parseUsage(${JSON.stringify(raw)}) must fail closed`)
      assert.equal(result.usage_status, 'UNAVAILABLE')
      assert.equal(result.usage, undefined, 'UNAVAILABLE result must not claim 0 tokens')
    }
  })

  it('REAL opencode step_finish shape (tokens nested in part) parsed — regression', () => {
    // Real `opencode run --format json` output nests tokens/cost inside `part`.
    const stepFinish = {
      type: 'step_finish',
      timestamp: 1,
      sessionID: 's',
      part: {
        id: 'p', messageID: 'm', sessionID: 's', type: 'step-finish',
        reason: 'stop',
        tokens: { total: 11398, input: 92, output: 2, reasoning: 40, cache: { write: 0, read: 11264 } },
        cost: 0.0000561792,
      },
    }
    const parsed = parseUsage(stepFinish, { run_id: 'r', phase: 'BUILD', attempt: 0, route_index: 0, provider: 'deepseek', model: 'deepseek-v4-flash' })
    assert.equal(parsed.ok, true)
    assert.equal(parsed.usage.usage_source, 'opencode_step_finish')
    assert.equal(parsed.usage.input_tokens, 92)
    assert.equal(parsed.usage.output_tokens, 2)
    assert.equal(parsed.usage.cached_tokens, 11264)
    assert.equal(parsed.usage.total_tokens, 11398)
    assert.equal(parsed.usage.provider_reported_cost, 0.0000561792)
  })

  it('opencode step_finish tokens parsed', () => {
    const result = parseUsage({
      type: 'step_finish',
      tokens: { total: 100, input: 80, output: 20, reasoning: 0, cache: { read: 10, write: 0 } },
      cost: 0.001,
    })
    assert.equal(result.ok, true)
    assert.equal(result.usage.input_tokens, 80)
    assert.equal(result.usage.output_tokens, 20)
    assert.equal(result.usage.total_tokens, 100)
    assert.equal(result.usage.cached_tokens, 10)
    assert.equal(result.usage.provider_reported_cost, 0.001)
    assert.equal(result.usage.usage_source, 'opencode_step_finish')
  })

  it('provider_result shape parsed', () => {
    const result = parseUsage({ input_tokens: 5, output_tokens: 3 })
    assert.equal(result.ok, true)
    assert.equal(result.usage.input_tokens, 5)
    assert.equal(result.usage.output_tokens, 3)
    assert.equal(result.usage.usage_source, 'provider_result')
  })

  it('provenance fields preserved', () => {
    const result = parseUsage({ input_tokens: 5 }, {
      run_id: 'run-1', phase: 'BUILD', attempt: 2, route_index: 1, provider: 'deepseek', model: 'm',
    })
    assert.equal(result.usage.run_id, 'run-1')
    assert.equal(result.usage.phase, 'BUILD')
    assert.equal(result.usage.attempt, 2)
    assert.equal(result.usage.route_index, 1)
    assert.equal(result.usage.provider, 'deepseek')
    assert.equal(result.usage.model, 'm')
  })

  it('negative/NaN tokens normalized — never negative, NaN→null', () => {
    assert.equal(normalizeUsageNumber(-1), 0, 'negatives clamp to 0, never stored negative')
    assert.equal(normalizeUsageNumber(Number.NaN), null)
    assert.equal(normalizeUsageNumber(1.7), 1)
    const result = parseUsage({ input_tokens: -5 })
    assert.equal(result.ok, false)
    assert.equal(result.usage_status, 'UNAVAILABLE', 'no positive field → UNAVAILABLE')
  })

  it('aggregate sums real usage', () => {
    const records = [
      { provider: 'deepseek', model: 'a', usage_status: 'AVAILABLE', input_tokens: 10, output_tokens: 5, total_tokens: 15, provider_reported_cost: 0.01 },
      { provider: 'deepseek', model: 'b', usage_status: 'AVAILABLE', input_tokens: 20, output_tokens: 10, total_tokens: 30, provider_reported_cost: 0.02 },
    ]
    const agg = aggregateUsage(records)
    assert.equal(agg.usage_status, 'AVAILABLE')
    assert.equal(agg.total_input_tokens, 30)
    assert.equal(agg.total_output_tokens, 15)
    assert.equal(agg.total_tokens, 45)
    assert.equal(agg.invocation_count, 2)
    assert.equal(agg.by_provider.deepseek.invocation_count, 2)
    assert.equal(agg.by_provider.deepseek.total_tokens, 45)
  })

  it('aggregate with no records → UNAVAILABLE', () => {
    const agg = aggregateUsage([])
    assert.equal(agg.usage_status, 'UNAVAILABLE')
    assert.equal(agg.total_tokens, 0)
    assert.equal(agg.invocation_count, 0)
  })

  it('usage records carry no text content (no secret leak)', () => {
    const parsed = parseUsage({ input_tokens: 5, output_tokens: 3 })
    assert.equal(usageRedacted(parsed.usage), true)
    assert.equal(usageRedacted({ prompt: 'secret prompt', input_tokens: 5 }), false)
    assert.equal(usageRedacted({ output: 'secret output', input_tokens: 5 }), false)
  })

  it('usage never influences terminal state', () => {
    // parseUsage/aggregateUsage are pure data producers — no decision fields.
    const parsed = parseUsage({ input_tokens: 5 })
    assert.ok(!('decision' in parsed.usage) && !('action' in parsed.usage), 'usage record must not carry a decision')
    const agg = aggregateUsage([parsed.usage])
    assert.ok(!('decision' in agg) && !('action' in agg), 'aggregate must not carry a decision')
  })
})
