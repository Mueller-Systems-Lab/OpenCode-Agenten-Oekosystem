// SPDX-License-Identifier: MIT
/**
 * Usage observability for cost governance.
 *
 * Usage is evidence for cost governance, never a completion authority.
 * Missing usage is recorded as UNAVAILABLE, never zeroed (§38): a record with
 * no positive token fields must NEVER claim 0 tokens, because 0 is a false
 * cost assertion. Records carry NO text content — no prompts, no outputs.
 */
export const USAGE_KEYS = Object.freeze([
  'input_tokens',
  'output_tokens',
  'cached_tokens',
  'reasoning_tokens',
  'total_tokens',
])

/**
 * Normalize a usage number: integer >= 0, or null. Never negative, never NaN,
 * never a non-number.
 */
export function normalizeUsageNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

/**
 * True when at least one token field is a positive integer.
 */
export function isUsagePresent(usage) {
  if (!usage || typeof usage !== 'object') return false
  return USAGE_KEYS.some((key) => typeof usage[key] === 'number' && Number.isInteger(usage[key]) && usage[key] > 0)
}

/**
 * Parse raw usage into a normalized record.
 *
 * raw may be:
 *   - an opencode step_finish tokens object  {total, input, output, reasoning, cache:{read, write}}
 *   - an object with input_tokens/output_tokens...
 *   - a string (JSON-encoded object)
 *
 * usage_status = 'UNAVAILABLE' when raw is missing/null/not-object OR no token
 * field is a positive integer. MISSING USAGE IS NEVER ZEROED — missing fields
 * stay null, never 0.
 */
export function parseUsage(raw, { run_id = null, phase = null, attempt = 0, route_index = 0, provider = null, model = null } = {}) {
  let value = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { value = null }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, usage_status: 'UNAVAILABLE' }
  }

  // REAL opencode step_finish JSON nests tokens/cost inside `part`
  // ({"type":"step_finish","part":{"reason":"stop","tokens":{...},"cost":N}}).
  // Older/other shapes carry tokens at .tokens or at the top level
  // ({input,output,total,...} / {input_tokens,output_tokens,...}).
  const isStepFinishShape = value.type === 'step_finish'
  const part = value.part && typeof value.part === 'object' && !Array.isArray(value.part) ? value.part : null
  const partTokens = part && part.tokens && typeof part.tokens === 'object' && !Array.isArray(part.tokens) ? part.tokens : null
  const directTokens = value.tokens && typeof value.tokens === 'object' && !Array.isArray(value.tokens) ? value.tokens : null
  const tokensObj = partTokens || directTokens || value
  const cache = tokensObj.cache && typeof tokensObj.cache === 'object' && !Array.isArray(tokensObj.cache) ? tokensObj.cache : {}
  const input = normalizeUsageNumber(tokensObj.input ?? tokensObj.input_tokens)
  const output = normalizeUsageNumber(tokensObj.output ?? tokensObj.output_tokens)
  const cached = normalizeUsageNumber(cache.read ?? cache.write ?? tokensObj.cached_tokens)
  const reasoning = normalizeUsageNumber(tokensObj.reasoning ?? tokensObj.reasoning_tokens)
  const total = normalizeUsageNumber(tokensObj.total ?? tokensObj.total_tokens)
  const partCost = part && typeof part.cost === 'number' ? part.cost : null
  const cost = typeof partCost === 'number' && Number.isFinite(partCost) ? partCost : (typeof value.cost === 'number' && Number.isFinite(value.cost) ? value.cost : null)

  const usage = {
    run_id,
    phase,
    attempt,
    route_index,
    provider,
    model,
    usage_source: isStepFinishShape ? 'opencode_step_finish' : (input !== null || output !== null || cached !== null || reasoning !== null || total !== null ? 'provider_result' : 'UNKNOWN'),
    input_tokens: input,
    output_tokens: output,
    cached_tokens: cached,
    reasoning_tokens: reasoning,
    total_tokens: total,
    provider_reported_cost: cost,
    usage_status: 'AVAILABLE',
  }

  if (!isUsagePresent(usage)) {
    return { ok: false, usage_status: 'UNAVAILABLE' }
  }
  return { ok: true, usage }
}

/**
 * Aggregate usage records. Sums only real numbers; never invents zeroes for
 * missing fields. usage_status is 'AVAILABLE' when any record carried usage,
 * 'UNAVAILABLE' otherwise.
 */
export function aggregateUsage(records = []) {
  const list = Array.isArray(records) ? records : []
  const by_provider = {}
  const by_model = {}
  let total_input_tokens = 0
  let total_output_tokens = 0
  let total_cached_tokens = 0
  let total_reasoning_tokens = 0
  let total_tokens = 0
  let provider_reported_cost_total = 0
  let invocation_count = 0
  let hasPresent = false

  const addNumber = (target, value) => (typeof value === 'number' && Number.isFinite(value) ? target + value : target)

  for (const record of list) {
    if (!record || typeof record !== 'object') continue
    invocation_count += 1
    if (record.usage_status === 'AVAILABLE' || isUsagePresent(record)) hasPresent = true
    total_input_tokens = addNumber(total_input_tokens, record.input_tokens)
    total_output_tokens = addNumber(total_output_tokens, record.output_tokens)
    total_cached_tokens = addNumber(total_cached_tokens, record.cached_tokens)
    total_reasoning_tokens = addNumber(total_reasoning_tokens, record.reasoning_tokens)
    total_tokens = addNumber(total_tokens, record.total_tokens)
    provider_reported_cost_total = addNumber(provider_reported_cost_total, record.provider_reported_cost)

    if (record.provider) {
      const key = record.provider
      by_provider[key] = by_provider[key] || { total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0, invocation_count: 0 }
      by_provider[key].total_input_tokens = addNumber(by_provider[key].total_input_tokens, record.input_tokens)
      by_provider[key].total_output_tokens = addNumber(by_provider[key].total_output_tokens, record.output_tokens)
      by_provider[key].total_tokens = addNumber(by_provider[key].total_tokens, record.total_tokens)
      by_provider[key].invocation_count += 1
    }
    if (record.model) {
      const key = record.model
      by_model[key] = by_model[key] || { total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0, invocation_count: 0 }
      by_model[key].total_input_tokens = addNumber(by_model[key].total_input_tokens, record.input_tokens)
      by_model[key].total_output_tokens = addNumber(by_model[key].total_output_tokens, record.output_tokens)
      by_model[key].total_tokens = addNumber(by_model[key].total_tokens, record.total_tokens)
      by_model[key].invocation_count += 1
    }
  }

  return {
    usage_status: hasPresent ? 'AVAILABLE' : 'UNAVAILABLE',
    total_input_tokens,
    total_output_tokens,
    total_cached_tokens,
    total_reasoning_tokens,
    total_tokens,
    provider_reported_cost_total,
    invocation_count,
    by_provider,
    by_model,
  }
}

/**
 * True when the serialized record contains no token-like secrets: no prompt/
 * output text fields and all token fields are numbers or null.
 */
export function usageRedacted(record) {
  if (!record || typeof record !== 'object') return false
  const serialized = JSON.stringify(record)
  if (/(^|")(prompt|output|text|content|reason|message|tool_call|command)"\s*:/.test(serialized)) return false
  for (const key of USAGE_KEYS) {
    const value = record[key]
    if (value !== null && value !== undefined && !(typeof value === 'number' && Number.isFinite(value))) return false
  }
  return true
}
