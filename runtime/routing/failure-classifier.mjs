// SPDX-License-Identifier: MIT
/**
 * Model/Provider routing failure taxonomy.
 *
 * The deterministic routing policy consumes these classes to decide between
 * retry-same-model, model escalation, provider fallback, and terminal states.
 * They are EVIDENCE categories, never terminal decisions — DONE | FIX | SPLIT |
 * BLOCKED stay reserved for the deterministic controller.
 *
 * Only classes that drive a real routing decision exist. No theoretical
 * taxonomy without runtime use.
 */
export const ROUTING_FAILURE_CLASSES = Object.freeze([
  // Model-level
  'MODEL_UNAVAILABLE',
  'MODEL_CAPABILITY_INSUFFICIENT',
  'MODEL_CONTEXT_LIMIT',
  'MODEL_OUTPUT_INVALID',
  'MODEL_QUALITY_GATE_REJECTED',
  // Provider-level
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_AUTH_FAILURE',
  'PROVIDER_TRANSPORT_FAILURE',
  // Routing-policy-level
  'ROUTING_POLICY_DENIED',
  'ROUTING_BUDGET_EXHAUSTED',
])

export const ROUTING_FAILURE_CLASS_SET = new Set(ROUTING_FAILURE_CLASSES)

export function isRoutingFailureClass(value) {
  return ROUTING_FAILURE_CLASS_SET.has(value)
}

/**
 * Classify a raw worker/model/provider outcome into a stable routing failure
 * class. Unknown shapes fail closed to MODEL_OUTPUT_INVALID (evidence of an
 * unclassifiable worker result) — never swallowed, never promoted to a
 * terminal decision.
 */
export function classifyWorkerOutcome({ status = null, error = null, failure_class = null, timedOut = false, http_status = null } = {}) {
  if (failure_class) {
    if (isRoutingFailureClass(failure_class)) return failure_class
    return 'MODEL_OUTPUT_INVALID'
  }
  if (timedOut) return 'MODEL_UNAVAILABLE'
  if (status === 'SUCCESS') return null
  if (http_status === 401 || http_status === 403) return 'PROVIDER_AUTH_FAILURE'
  if (http_status === 429) return 'PROVIDER_RATE_LIMITED'
  if (http_status === 404 || http_status === 410) return 'MODEL_UNAVAILABLE'
  if (http_status && http_status >= 500) return 'PROVIDER_UNAVAILABLE'
  if (http_status && http_status >= 400) return 'MODEL_OUTPUT_INVALID'
  const text = String(error || '').toLowerCase()
  if (!text) return 'MODEL_OUTPUT_INVALID'
  if (/auth|unauthorized|forbidden|401|403|invalid api key|api key.*invalid|permission denied/i.test(text)) return 'PROVIDER_AUTH_FAILURE'
  if (/rate.?limit|429|quota|too many requests/i.test(text)) return 'PROVIDER_RATE_LIMITED'
  if (/context length|context window|context.*exceed|maximum context|token.*limit|input.*too long|truncate/i.test(text)) return 'MODEL_CONTEXT_LIMIT'
  if (/model.*not.?found|unknown model|does not exist|not available|404/i.test(text)) return 'MODEL_UNAVAILABLE'
  if (/unavailable|overloaded|503|502|504|500|bad gateway|service.*error/i.test(text)) return 'PROVIDER_UNAVAILABLE'
  if (/transport|connect|timeout|network|econn|socket|tls|dns/i.test(text)) return 'PROVIDER_TRANSPORT_FAILURE'
  return 'MODEL_OUTPUT_INVALID'
}

/**
 * Defensive redaction for failure reasons before they are persisted into
 * events or evidence. The routing layer itself never accepts raw reasons into
 * events (only classes + fingerprints); this helper additionally strips common
 * secret shapes for harness evidence. Callers with the canonical security lib
 * available SHOULD run safeRedactText first (see scripts/routing harness).
 */
const DEFENSIVE_PATTERNS = [
  /(\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic|token)\s+)[^\s,;]+/gi,
  /\b(?:bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(?:sk|ghp|gho|ghu|ghs|ghr|sk-)[A-Za-z0-9_-]{8,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization)\s*[:=]\s*["']?)[^,\s}\]"']+/gi,
  /([?&](?:token|access_token|refresh_token|api_key|apikey|secret|password|authorization|key)=)[^&#\s]+/gi,
]

export function redactFailureReason(value) {
  let text = String(value ?? '')
  for (const pattern of DEFENSIVE_PATTERNS) text = text.replace(pattern, '$1[REDACTED]')
  return text.slice(0, 1000)
}
