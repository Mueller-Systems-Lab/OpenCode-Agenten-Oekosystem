// SPDX-License-Identifier: MIT
/**
 * Canonical Model Catalog — runtime-owned model metadata.
 *
 * Reality contract:
 *   - provider/model ids come from the REAL providers/models exposed by the
 *     OpenCode host; auth lifecycle remains outside OCAE.
 *   - availability is observed, not assumed:
 *       'reachable'  = a real model call succeeded in this environment
 *       'configured' = listed by the provider but not yet probed (NOT
 *                      selectable by the routing policy until probed)
 *   - capabilities (tool_support / mcp_support / vision_support /
 *     structured_output) are only claimed where real evidence exists. No
 *     invented prices or abilities.
 *   - cost_tier / quality_tier / context_tier are STABLE ORDINAL POLICY
 *     metadata (LOW < MEDIUM < HIGH), not live prices and not benchmark
 *     claims. The routing policy uses them for "cheapest sufficient model".
 *
 * The catalog is data, not authority. The deterministic routing policy
 * (routing-policy.mjs) owns model selection; a model can never select itself.
 */
export const CATALOG_VERSION = '1.2.0'

export const COST_TIERS = Object.freeze(['LOW', 'MEDIUM', 'HIGH'])
export const QUALITY_TIERS = Object.freeze(['LOW', 'MEDIUM', 'HIGH'])
export const CONTEXT_TIERS = Object.freeze(['LOW', 'MEDIUM', 'HIGH'])
export const STRUCTURED_OUTPUT_LEVELS = Object.freeze(['NONE', 'STANDARD', 'STRICT'])

export function tierRank(tier, tiers) {
  const index = tiers.indexOf(tier)
  return index === -1 ? Number.POSITIVE_INFINITY : index
}

/**
 * REAL provider inventory (non-secret identifiers only).
 * deepseek: API-key authenticated. openai: OAuth authenticated.
 * Both were verified reachable via real model calls in this milestone.
 * opencode: free-tier models via the OpenCode free transport. The transport
 * is callable without a credential in this environment; reachability is still
 * established only by a fresh real probe.
 */
export const PROVIDER_INVENTORY = Object.freeze([
  { provider: 'deepseek', authenticated: true, reachable: true, auth_type: 'api_key' },
  { provider: 'openai', authenticated: true, reachable: true, auth_type: 'oauth' },
  { provider: 'opencode', authenticated: false, reachable: true, auth_type: 'opencode_free_transport' },
])

export const DEFAULT_MODEL_CATALOG = Object.freeze([
  // --- deepseek (API key, reachable) -------------------------------------
  {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    enabled: true,
    availability: 'reachable',
    tool_support: true,
    mcp_support: true,   // real MCP worker proof (playwright grant) — previous milestone
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STRICT', // real probe: exact JSON file written
    cost_tier: 'LOW',
    quality_tier: 'MEDIUM',
    context_tier: 'MEDIUM',
    default_primary: true,
    capabilities: ['tools', 'mcp', 'structured_output'],
  },
  {
    provider: 'deepseek',
    model: 'deepseek-chat',
    enabled: true,
    availability: 'reachable',
    tool_support: true,  // real probe: agentic file write
    mcp_support: false,  // no real MCP proof — runtime grants no MCP for this model
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STRICT', // real probe: exact JSON file written
    cost_tier: 'LOW',
    quality_tier: 'LOW',
    context_tier: 'MEDIUM',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    enabled: true,
    availability: 'configured', // listed, not probed in this milestone
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STANDARD',
    cost_tier: 'MEDIUM',
    quality_tier: 'HIGH',
    context_tier: 'HIGH',
    default_primary: false,
    capabilities: ['tools', 'reasoning', 'structured_output'],
  },
  {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    enabled: true,
    availability: 'configured', // listed, not probed in this milestone
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STANDARD',
    cost_tier: 'HIGH',
    quality_tier: 'HIGH',
    context_tier: 'HIGH',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  // --- openai (OAuth, reachable) -----------------------------------------
  {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    enabled: true,
    availability: 'reachable',
    tool_support: true,  // real probe: agentic file write
    mcp_support: false,  // no real MCP proof in this environment
    vision_support: true, // real probe: opencode run --file <png> correctly answered image-content questions ("red" for a red square; "YES" for overlapping rectangles)
    structured_output: 'STRICT', // real probe: exact JSON file written
    cost_tier: 'MEDIUM',
    quality_tier: 'MEDIUM',
    context_tier: 'HIGH',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'openai',
    model: 'gpt-5.4-mini-fast',
    enabled: true,
    availability: 'configured',
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STRICT',
    cost_tier: 'MEDIUM',
    quality_tier: 'MEDIUM',
    context_tier: 'HIGH',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'openai',
    model: 'gpt-5.3-codex-spark',
    enabled: true,
    availability: 'configured',
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STANDARD',
    cost_tier: 'MEDIUM',
    quality_tier: 'MEDIUM',
    context_tier: 'HIGH',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'openai',
    model: 'gpt-5.4',
    enabled: true,
    availability: 'configured',
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STRICT',
    cost_tier: 'HIGH',
    quality_tier: 'HIGH',
    context_tier: 'HIGH',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'openai',
    model: 'gpt-5.4-fast',
    enabled: true,
    availability: 'configured',
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STRICT',
    cost_tier: 'HIGH',
    quality_tier: 'HIGH',
    context_tier: 'HIGH',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'openai',
    model: 'gpt-5.5',
    enabled: true,
    availability: 'configured',
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STRICT',
    cost_tier: 'HIGH',
    quality_tier: 'HIGH',
    context_tier: 'HIGH',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'openai',
    model: 'gpt-5.5-fast',
    enabled: true,
    availability: 'configured',
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STRICT',
    cost_tier: 'HIGH',
    quality_tier: 'HIGH',
    context_tier: 'HIGH',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  // --- opencode (free-tier models via local opencode runtime auth) --------
  // Availability is flipped to 'reachable' only for models with fresh probe
  // evidence in the same change. DEFAULT_ROUTING_POLICY is
  // UNCHANGED (allowed_providers stays deepseek+openai) — evaluation passes
  // its own per-run policy object.
  {
    provider: 'opencode',
    model: 'hy3-free',
    enabled: true,
    availability: 'reachable', // fresh zero-cost probe succeeded
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STANDARD',
    cost_tier: 'LOW',
    quality_tier: 'LOW',
    context_tier: 'MEDIUM',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'opencode',
    model: 'muse-spark-1.2-contributor-free',
    enabled: true,
    availability: 'configured', // listed; not selected for this milestone
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STANDARD',
    cost_tier: 'LOW',
    quality_tier: 'LOW',
    context_tier: 'MEDIUM',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'opencode',
    model: 'nemotron-3-ultra-free',
    enabled: true,
    availability: 'reachable', // fresh zero-cost probe succeeded
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STANDARD',
    cost_tier: 'LOW',
    quality_tier: 'LOW',
    context_tier: 'MEDIUM',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'opencode',
    model: 'nemotron-3.5-lightning-free',
    enabled: true,
    availability: 'configured', // reserve — listed, not yet probed
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STANDARD',
    cost_tier: 'LOW',
    quality_tier: 'LOW',
    context_tier: 'MEDIUM',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
  {
    provider: 'opencode',
    model: 'mimo-v2.5-free',
    enabled: true,
    availability: 'configured', // reserve — listed, not yet probed
    tool_support: true,
    mcp_support: false,
    vision_support: false, // no real vision probe in this environment
    structured_output: 'STANDARD',
    cost_tier: 'LOW',
    quality_tier: 'LOW',
    context_tier: 'MEDIUM',
    default_primary: false,
    capabilities: ['tools', 'structured_output'],
  },
])

export function getCatalogEntry(catalog, provider, model) {
  return (catalog || DEFAULT_MODEL_CATALOG).find((entry) => entry.provider === provider && entry.model === model) || null
}

export function findReachableModels(catalog = DEFAULT_MODEL_CATALOG, { provider = null } = {}) {
  return (catalog || [])
    .filter((entry) => entry.enabled && entry.availability === 'reachable')
    .filter((entry) => !provider || entry.provider === provider)
}

export function findPrimaryRoute(catalog = DEFAULT_MODEL_CATALOG, allowedProviders = null) {
  const candidate = (catalog || [])
    .filter((entry) => entry.default_primary)
    .filter((entry) => !allowedProviders || allowedProviders.includes(entry.provider))
    .find((entry) => entry.enabled && entry.availability === 'reachable')
  return candidate || null
}
