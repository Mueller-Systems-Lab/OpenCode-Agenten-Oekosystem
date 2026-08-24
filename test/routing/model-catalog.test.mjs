// SPDX-License-Identifier: MIT
/**
 * Canonical Model Catalog tests — real metadata only.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MODEL_CATALOG,
  PROVIDER_INVENTORY,
  COST_TIERS,
  QUALITY_TIERS,
  CONTEXT_TIERS,
  STRUCTURED_OUTPUT_LEVELS,
  getCatalogEntry,
  findReachableModels,
  findPrimaryRoute,
} from '../../runtime/routing/model-catalog.mjs'

describe('model catalog — reality', () => {
  it('real configured providers are recorded (deepseek api_key, openai oauth)', () => {
    const providers = PROVIDER_INVENTORY.map((entry) => entry.provider)
    assert.ok(providers.includes('deepseek'), 'deepseek must be configured')
    assert.ok(providers.includes('openai'), 'openai must be configured')
    for (const entry of PROVIDER_INVENTORY) {
      assert.equal(entry.authenticated, true)
      assert.ok(entry.reachable === true, `${entry.provider} reachability must be explicit`)
    }
  })

  it('catalog contains the real configured models', () => {
    const ids = DEFAULT_MODEL_CATALOG.map((entry) => `${entry.provider}/${entry.model}`)
    assert.ok(ids.includes('deepseek/deepseek-v4-flash'))
    assert.ok(ids.includes('deepseek/deepseek-chat'))
    assert.ok(ids.includes('openai/gpt-5.4-mini'))
  })

  it('every entry carries the full metadata shape', () => {
    for (const entry of DEFAULT_MODEL_CATALOG) {
      assert.equal(typeof entry.provider, 'string')
      assert.equal(typeof entry.model, 'string')
      assert.equal(typeof entry.enabled, 'boolean')
      assert.ok(['reachable', 'configured'].includes(entry.availability), `${entry.model} availability`)
      assert.equal(typeof entry.tool_support, 'boolean')
      assert.equal(typeof entry.mcp_support, 'boolean')
      assert.ok(STRUCTURED_OUTPUT_LEVELS.includes(entry.structured_output))
      assert.ok(COST_TIERS.includes(entry.cost_tier))
      assert.ok(QUALITY_TIERS.includes(entry.quality_tier))
      assert.ok(CONTEXT_TIERS.includes(entry.context_tier))
      assert.equal(typeof entry.default_primary, 'boolean')
      assert.ok(Array.isArray(entry.capabilities))
    }
  })

  it('only the MCP-proven model claims mcp_support', () => {
    const mcpCapable = DEFAULT_MODEL_CATALOG.filter((entry) => entry.mcp_support === true)
    assert.deepEqual(
      mcpCapable.map((entry) => `${entry.provider}/${entry.model}`),
      ['deepseek/deepseek-v4-flash'],
      'mcp_support must reflect the real MCP proof only',
    )
  })

  it('exactly one default primary route exists and is reachable', () => {
    const primary = findPrimaryRoute(DEFAULT_MODEL_CATALOG)
    assert.equal(primary.provider, 'deepseek')
    assert.equal(primary.model, 'deepseek-v4-flash')
    assert.equal(primary.availability, 'reachable')
  })

  it('reachable models are a subset of configured models with real probes', () => {
    const reachable = findReachableModels(DEFAULT_MODEL_CATALOG)
    const ids = reachable.map((entry) => `${entry.provider}/${entry.model}`).sort()
    assert.deepEqual(ids, ['deepseek/deepseek-chat', 'deepseek/deepseek-v4-flash', 'openai/gpt-5.4-mini'])
  })

  it('getCatalogEntry resolves exact provider/model pairs', () => {
    assert.ok(getCatalogEntry(DEFAULT_MODEL_CATALOG, 'deepseek', 'deepseek-v4-flash'))
    assert.equal(getCatalogEntry(DEFAULT_MODEL_CATALOG, 'deepseek', 'does-not-exist'), null)
    assert.equal(getCatalogEntry(DEFAULT_MODEL_CATALOG, 'nope', 'deepseek-v4-flash'), null)
  })

  it('tierRank is stable ordinal ordering', () => {
    assert.deepEqual([COST_TIERS, QUALITY_TIERS, CONTEXT_TIERS].map((tiers) => tiers.join('<')), ['LOW<MEDIUM<HIGH', 'LOW<MEDIUM<HIGH', 'LOW<MEDIUM<HIGH'])
  })
})
