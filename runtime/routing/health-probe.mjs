// SPDX-License-Identifier: MIT
/**
 * Bounded, lazy, demand-based health probing for deterministic model routing.
 *
 * Reuse before build: the real provider probe goes through the EXISTING
 * opencode client (`opencode run -m <provider>/<model> --dir <dir>
 * --format json --auto "<minimal prompt>"`) — there is no second provider
 * abstraction. The probe result is a real, observed provider call.
 *
 * SECURITY / PRIVACY:
 *   - probe output is NEVER persisted raw: results carry only `output_tail`
 *     (last 500 chars) and never raw auth headers.
 *   - probe prompts are minimal and contain no task data.
 *   - probe classification is evidence, never a terminal decision.
 *   - budget discipline: at most max_candidates_probed_per_route probes per
 *     route decision and max_probe_attempts per candidate; healthy/known
 *     states are cache hits (no probe storm).
 *   - §21: budget-skipped / unprobed candidates stay UNKNOWN — a lack of
 *     probe evidence is NEVER marked UNAVAILABLE (no false negative).
 *   - §20: a probe is a success only when the worker actually produced a
 *     step_finish with a reason or text part; a raw transport/HTTP success is
 *     NOT proof of a healthy model (no false positive).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROUTING_FAILURE_CLASS_SET } from './failure-classifier.mjs'
import { COST_TIERS, QUALITY_TIERS } from './model-catalog.mjs'
import { normalizeUsageNumber } from './usage.mjs'
import { healthProbeStartEvent, healthProbeResultEvent } from './routing-events.mjs'

export const PROBE_POLICY_DEFAULTS = Object.freeze({
  max_probe_attempts: 1,
  probe_timeout_ms: 60000,
  max_candidates_probed_per_route: 3,
  max_parallel_probes: 2,
})

export const PROBE_PROMPT_DEFAULT = 'Reply with exactly OK. Do not use any tools. Do not write any files.'

const MCP_DISABLE_CONFIG = JSON.stringify({
  mcp: {
    playwright: { type: 'local', command: ['playwright-mcp'], enabled: false, timeout: 30000 },
  },
}, null, 2)

/**
 * Classify a probe failure into a stable ROUTING_FAILURE_CLASS.
 * Priority: timeout → HTTP status codes → text matching → MODEL_OUTPUT_INVALID.
 * Self-contained (mirrors failure-classifier patterns; no reliance on caller
 * classification).
 */
export function probeClassificationFromError({ error = null, output = null, timed_out = false, http_status = null } = {}) {
  if (timed_out) return 'PROVIDER_TRANSPORT_FAILURE'
  if (http_status === 401 || http_status === 403) return 'PROVIDER_AUTH_FAILURE'
  if (http_status === 429) return 'PROVIDER_RATE_LIMITED'
  if (http_status === 404 || http_status === 410) return 'MODEL_UNAVAILABLE'
  if (http_status && http_status >= 500) return 'PROVIDER_UNAVAILABLE'
  const text = `${error || ''}\n${output || ''}`.toLowerCase()
  if (!text.trim()) return 'MODEL_OUTPUT_INVALID'
  // auth patterns
  if (/(auth|unauthorized|forbidden|401|403|invalid api key|api key.*invalid|permission denied)/.test(text)) return 'PROVIDER_AUTH_FAILURE'
  // rate limit patterns
  if (/(rate.?limit|429|quota|too many requests)/.test(text)) return 'PROVIDER_RATE_LIMITED'
  // model not found
  if (/(model.*not.?found|unknown model|does not exist|404|410)/.test(text)) return 'MODEL_UNAVAILABLE'
  // unavailable / overloaded
  if (/(unavailable|overloaded|503|502|504|500|bad gateway|service.*error)/.test(text)) return 'PROVIDER_UNAVAILABLE'
  // transport / timeout / network
  if (/(transport|connect|timeout|network|econn|socket|tls|dns)/.test(text)) return 'PROVIDER_TRANSPORT_FAILURE'
  return 'MODEL_OUTPUT_INVALID'
}

const PROBE_FAILURE_STATUS = Object.freeze({
  PROVIDER_AUTH_FAILURE: 'AUTH_FAILED',
  PROVIDER_RATE_LIMITED: 'RATE_LIMITED',
  MODEL_UNAVAILABLE: 'UNAVAILABLE',
  PROVIDER_UNAVAILABLE: 'UNAVAILABLE',
  PROVIDER_TRANSPORT_FAILURE: 'UNAVAILABLE',
  MODEL_OUTPUT_INVALID: 'UNKNOWN',
})

/**
 * Health status derived from a probe failure class. MODEL_OUTPUT_INVALID →
 * UNKNOWN: an invalid probe result is NOT proof of unavailability (§21 — no
 * false negative). Default → UNKNOWN (never invent unavailability).
 */
export function statusFromProbeFailure(failure_class) {
  return PROBE_FAILURE_STATUS[failure_class] || 'UNKNOWN'
}

/**
 * Extract `retry-after: N` / `retry_after: N` / `rate_limit_reset: N` from
 * probe output as integer seconds. Never invents a value: no match → null.
 */
export function parseRetryAfter(text) {
  if (typeof text !== 'string' || text.length === 0) return null
  const match = text.match(/(?:retry[-_]?after|rate_limit_reset)\s*[:=]\s*(\d+)/i)
  if (!match) return null
  const seconds = Number.parseInt(match[1], 10)
  return Number.isFinite(seconds) ? seconds : null
}

function stepHasText(step) {
  if (!step) return false
  if (typeof step.text === 'string' && step.text.trim().length > 0) return true
  if (step.part && typeof step.part === 'object' && typeof step.part.text === 'string' && step.part.text.trim().length > 0) return true
  if (Array.isArray(step.parts) && step.parts.some((p) => p && typeof p.text === 'string' && p.text.trim().length > 0)) return true
  return false
}

function lastStepFinishFromOutput(output) {
  if (typeof output !== 'string' || output.length === 0) return null
  let last = null
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed
    try { parsed = JSON.parse(trimmed) } catch { continue }
    if (parsed && typeof parsed === 'object' && parsed.type === 'step_finish') last = parsed
  }
  return last
}

/**
 * REAL provider probe via the existing opencode client (spawnSync).
 *
 * Success (no false positive — §20): exit_code===0 AND a step_finish line
 * exists AND the step_finish carries a reason (e.g. 'stop') or a text part.
 * A raw transport/HTTP success alone is NOT success.
 *
 * SECURITY: only `output_tail` (last 500 chars) is returned — never the full
 * output, never raw auth headers.
 */
export function probeProviderModel({
  provider,
  model,
  workdir = null,
  opencode_bin = null,
  timeout_ms = PROBE_POLICY_DEFAULTS.probe_timeout_ms,
  prompt = PROBE_PROMPT_DEFAULT,
  disable_mcp = true,
  clock = () => Date.now(),
} = {}) {
  const startedAt = clock()
  const bin = opencode_bin || process.env.OCAE_OPENCODE_BIN || 'opencode'
  const dir = workdir || process.cwd()

  // Disable the playwright MCP for probes (minimal prompt, no tools needed).
  // Never overwrite an existing opencode.jsonc.
  if (disable_mcp && workdir) {
    try {
      const configPath = path.join(workdir, 'opencode.jsonc')
      if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, `${MCP_DISABLE_CONFIG}\n`, { encoding: 'utf8', mode: 0o600 })
      }
    } catch {
      // Probe must not fail because the config could not be written; the
      // probe itself is the authority and will simply run with default MCP.
    }
  }

  let result
  try {
    result = spawnSync(bin, ['run', '-m', `${provider}/${model}`, '--dir', dir, '--format', 'json', '--auto', prompt], {
      encoding: 'utf8',
      timeout: timeout_ms,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const latencyMs = clock() - startedAt
    return {
      ok: false, provider, model,
      status: 'UNAVAILABLE',
      failure_class: 'PROVIDER_TRANSPORT_FAILURE',
      retry_after: null,
      latency_ms: latencyMs,
      timed_out: Boolean(error && error.code === 'ETIMEDOUT'),
      output_tail: '',
      exit_code: null,
    }
  }

  const output = `${result.stdout || ''}${result.stderr ? `\n${result.stderr}` : ''}`
  const outputTail = output.slice(-500)
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT')

  // Spawn error (timeout/killed) → transport failure.
  if (result.error || result.signal) {
    return {
      ok: false, provider, model,
      status: 'UNAVAILABLE',
      failure_class: 'PROVIDER_TRANSPORT_FAILURE',
      retry_after: parseRetryAfter(output),
      latency_ms: clock() - startedAt,
      timed_out: timedOut || Boolean(result.signal),
      output_tail: outputTail,
      exit_code: result.status,
    }
  }

  const step = lastStepFinishFromOutput(output)
  // REAL opencode JSON output nests reason/tokens/cost inside `part`
  // ({"type":"step_finish", "part": { "reason":"stop", "tokens":{...}, "cost":N }}).
  const part = step && typeof step.part === 'object' && step.part !== null ? step.part : {}
  const success = result.status === 0 && Boolean(step) && (Boolean(part.reason) || stepHasText(step))

  if (success) {
    const tokens = part.tokens && typeof part.tokens === 'object' && part.tokens !== null ? part.tokens : {}
    const cache = tokens && typeof tokens.cache === 'object' && tokens.cache !== null ? tokens.cache : {}
    const cachedTokens = cache.read || cache.write || 0
    const cost = typeof part.cost === 'number' && Number.isFinite(part.cost) ? part.cost : null
    return {
      ok: true, provider, model,
      status: 'HEALTHY',
      latency_ms: clock() - startedAt,
      failure_class: null,
      usage: {
        usage_source: 'opencode_step_finish',
        input_tokens: normalizeUsageNumber(tokens.input),
        output_tokens: normalizeUsageNumber(tokens.output),
        cached_tokens: cachedTokens,
        reasoning_tokens: normalizeUsageNumber(tokens.reasoning),
        total_tokens: normalizeUsageNumber(tokens.total),
        provider_reported_cost: cost,
      },
      output_tail: outputTail,
      timed_out: false,
    }
  }

  const failureClass = probeClassificationFromError({ error: result.stderr || null, output: result.stdout || null, timed_out: timedOut })
  return {
    ok: false, provider, model,
    status: statusFromProbeFailure(failureClass),
    failure_class: failureClass,
    retry_after: parseRetryAfter(output),
    latency_ms: clock() - startedAt,
    timed_out: timedOut,
    output_tail: outputTail,
    exit_code: result.status,
  }
}

function costRankOf(tier) {
  const index = COST_TIERS.indexOf(tier)
  return index === -1 ? Number.POSITIVE_INFINITY : index
}

function qualityRankOf(tier) {
  const index = QUALITY_TIERS.indexOf(tier)
  return index === -1 ? Number.POSITIVE_INFINITY : index
}

function sortedCheapestFirst(candidates) {
  return [...(candidates || [])].sort((a, b) => {
    const byCost = costRankOf(a.cost_tier) - costRankOf(b.cost_tier)
    if (byCost !== 0) return byCost
    const byQuality = qualityRankOf(a.quality_tier) - qualityRankOf(b.quality_tier)
    if (byQuality !== 0) return byQuality
    return `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`)
  })
}

/**
 * Lazy, demand-based probing. Candidates are probed CHEAPEST FIRST up to the
 * probe budget; healthy/known states are cache hits (no probe storm — §15);
 * unprobed candidates stay UNKNOWN (never UNAVAILABLE — §21).
 *
 * Sequential implementation (max_parallel_probes is documented for the
 * bounded-parallel contract; the current implementation keeps it simple and
 * deterministic).
 *
 * Returns { health_map, probed, probe_budget_skipped, cache_hits }.
 */
export async function resolveCandidateHealth({
  candidates = [],
  store = null,
  probe_policy = PROBE_POLICY_DEFAULTS,
  probe_fn = null,
  clock = () => Date.now(),
  emit = null,
  run_id = null,
  phase = 'ROUTING',
  attempt = 0,
} = {}) {
  const health_map = {}
  const probed = []
  const probe_budget_skipped = []
  const cache_hits = []

  if (!store) {
    // No store → leave all health UNKNOWN for the caller to decide.
    return { health_map: {}, probed: [], probe_budget_skipped: [], cache_hits: [] }
  }

  const policy = { ...PROBE_POLICY_DEFAULTS, ...(probe_policy || {}) }
  const maxProbeAttempts = Math.max(1, Number.isFinite(policy.max_probe_attempts) ? policy.max_probe_attempts : 1)
  let budget = Math.max(0, Number.isFinite(policy.max_candidates_probed_per_route) ? policy.max_candidates_probed_per_route : 0)

  const recordHealth = (provider, model) => {
    const entry = store.get(provider, model)
    health_map[`${provider}/${model}`] = {
      status: entry.status,
      expires_at: entry.expires_at,
      observed_at: entry.observed_at,
      source: entry.source,
      failure_class: entry.failure_class,
      retry_after: entry.retry_after,
      latency_ms: entry.latency_ms,
    }
    return entry
  }

  for (const candidate of sortedCheapestFirst(candidates)) {
    const key = `${candidate.provider}/${candidate.model}`
    const entry = store.get(candidate.provider, candidate.model)

    if (entry.status === 'HEALTHY' || entry.status === 'DEGRADED') {
      cache_hits.push({ provider: candidate.provider, model: candidate.model, status: entry.status, from: 'cache' })
      recordHealth(candidate.provider, candidate.model)
      continue
    }
    if (entry.status === 'RATE_LIMITED' || entry.status === 'UNAVAILABLE' || entry.status === 'AUTH_FAILED') {
      cache_hits.push({ provider: candidate.provider, model: candidate.model, status: entry.status, from: 'cache' })
      recordHealth(candidate.provider, candidate.model)
      continue
    }

    // UNKNOWN or expired → probe (bounded by budget).
    if (budget <= 0) {
      probe_budget_skipped.push({ provider: candidate.provider, model: candidate.model, reason: 'probe budget exhausted' })
      health_map[key] = { status: 'UNKNOWN' }
      continue
    }
    budget -= 1

    let lastOk = false
    let lastHealthStatus = 'UNKNOWN'
    for (let i = 0; i < maxProbeAttempts; i += 1) {
      if (emit) await emit({ ...healthProbeStartEvent({ run_id, provider: candidate.provider, model: candidate.model, phase, attempt: i }) })
      let result = null
      try {
        result = probe_fn ? await probe_fn({ provider: candidate.provider, model: candidate.model, attempt: i }) : null
      } catch (error) {
        result = {
          ok: false, provider: candidate.provider, model: candidate.model,
          status: 'UNAVAILABLE', failure_class: 'PROVIDER_TRANSPORT_FAILURE',
          retry_after: null, latency_ms: null, timed_out: false,
        }
      }
      const ok = Boolean(result && result.ok)
      const healthStatus = ok ? 'HEALTHY' : (result && result.status ? result.status : 'UNKNOWN')
      lastOk = ok
      lastHealthStatus = healthStatus
      if (ok) {
        store.applyProbeResult({
          provider: candidate.provider, model: candidate.model, status: 'HEALTHY',
          latency_ms: result && result.latency_ms !== undefined ? result.latency_ms : null,
          ttl_seconds: null,
        })
      } else if (healthStatus !== 'UNKNOWN') {
        // UNKNOWN probe results are NOT written — the next route decision
        // re-probes instead of caching a useless UNKNOWN (but the probe
        // result event is still emitted).
        store.applyProbeResult({
          provider: candidate.provider, model: candidate.model, status: healthStatus,
          failure_class: result && result.failure_class ? result.failure_class : null,
          retry_after: result && result.retry_after !== undefined ? result.retry_after : null,
          latency_ms: result && result.latency_ms !== undefined ? result.latency_ms : null,
          ttl_seconds: null,
        })
      }
      if (emit) {
        await emit({
          ...healthProbeResultEvent({
            run_id, provider: candidate.provider, model: candidate.model,
            ok, health_status: healthStatus,
            failure_class: result && result.failure_class ? result.failure_class : null,
            latency_ms: result && result.latency_ms !== undefined ? result.latency_ms : null,
            retry_after: result && result.retry_after !== undefined ? result.retry_after : null,
            attempt: i, phase,
          }),
        })
      }
      if (ok) break
    }

    const finalEntry = recordHealth(candidate.provider, candidate.model)
    probed.push({
      provider: candidate.provider, model: candidate.model,
      status: finalEntry.status,
      ok: lastOk,
      health_status: lastHealthStatus,
    })
  }

  return { health_map, probed, probe_budget_skipped, cache_hits }
}
