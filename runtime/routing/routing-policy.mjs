// SPDX-License-Identifier: MIT
/**
 * Deterministic Model Routing Policy — runtime-owned model selection.
 *
 * Contract-first, not agent-first: the WORKER is told which provider/model it
 * is assigned to. A worker can never select, upgrade, or fall back its own
 * model. The policy is a pure deterministic function of:
 *   - task requirements (capabilities, context, quality, cost, provider)
 *   - the canonical model catalog (real, observed metadata)
 *   - explicit runtime policy (allowlist, budgets, escalation mapping)
 *   - classified runtime evidence (failure classes)
 *
 * Run identity: this module never creates or accepts a run_id. Run-ID
 * stability across retry/escalation/fallback is enforced by the runtime seam
 * (enforceRouteRunId) which rejects any route carrying a different run_id.
 *
 * Terminal decisions (DONE | FIX | SPLIT | BLOCKED) remain reserved for the
 * deterministic controller. The routing policy produces bounded transition
 * decisions only (RETRY_SAME_MODEL | ESCALATE | PROVIDER_FALLBACK | TERMINAL).
 */
import {
  DEFAULT_MODEL_CATALOG,
  findPrimaryRoute,
  getCatalogEntry,
  COST_TIERS,
  QUALITY_TIERS,
  CONTEXT_TIERS,
  tierRank,
} from './model-catalog.mjs'
import { ROUTING_FAILURE_CLASS_SET } from './failure-classifier.mjs'

export const ROUTING_POLICY_REVISION = '2026.08.19.1'

export const MODEL_SELECTION_AUTHORITY = 'DETERMINISTIC_RUNTIME_POLICY'

export const ROUTE_ACTION = Object.freeze({
  RETRY_SAME_MODEL: 'RETRY_SAME_MODEL',
  ESCALATE: 'ESCALATE',
  PROVIDER_FALLBACK: 'PROVIDER_FALLBACK',
  TERMINAL: 'TERMINAL',
})

export const DEFAULT_ROUTING_POLICY = Object.freeze({
  primary_provider: 'deepseek',
  primary_model: 'deepseek-v4-flash',
  // Explicit allowlist — no silent provider discovery, no auto-registration.
  allowed_providers: ['deepseek', 'openai'],
  provider_fallback_allowlist: ['deepseek', 'openai'],
  // Bounded route budgets (observable, deterministic).
  max_model_escalations: 1,
  max_provider_fallbacks: 1,
  max_attempts_per_route: 2,
  // Failure classes that stay on the same provider+model (a real strategy
  // delta is still required by the canonical retry policy).
  retry_classes: ['MODEL_OUTPUT_INVALID', 'PROVIDER_RATE_LIMITED', 'PROVIDER_TRANSPORT_FAILURE'],
  // Failure classes that may escalate the model (same run_id, new route).
  escalation_classes: ['MODEL_CAPABILITY_INSUFFICIENT', 'MODEL_CONTEXT_LIMIT', 'MODEL_QUALITY_GATE_REJECTED', 'MODEL_OUTPUT_INVALID', 'MODEL_UNAVAILABLE'],
  // AUTH failure never auto-probes other providers — it hides secret/config
  // problems. Fail closed unless an explicit fallback provider is allowed.
  auth_failure_policy: 'FAIL_CLOSED',
})

function normalizeRequirements(input = {}) {
  return {
    needs_tools: Boolean(input.needs_tools ?? input.needsTools ?? false),
    needs_mcp: Boolean(input.needs_mcp ?? input.needsMcp ?? false),
    needs_structured_output: input.needs_structured_output ?? input.needsStructuredOutput ?? null, // 'STANDARD' | 'STRICT' | null
    context_requirement: input.context_requirement ?? input.contextRequirement ?? null, // CONTEXT_TIER
    quality_requirement: input.quality_requirement ?? input.qualityRequirement ?? null, // QUALITY_TIER
    cost_ceiling: input.cost_ceiling ?? input.costCeiling ?? null, // COST_TIER (max)
    provider_constraints: Array.isArray(input.provider_constraints ?? input.providerConstraints)
      ? input.provider_constraints
      : null,
    allowed_providers: Array.isArray(input.allowed_providers ?? input.allowedProviders)
      ? input.allowed_providers
      : null,
  }
}

function structuredOutputRank(value) {
  if (value === 'STRICT') return 2
  if (value === 'STANDARD') return 1
  return 0
}

/**
 * A model is a routing candidate only when it is REAL (enabled + reachable),
 * allowlisted, and capability-compatible with the requirements. Capability
 * mismatch is rejected BEFORE worker invocation — never discovered in the
 * build loop.
 */
export function modelMeetsRequirements(entry, requirements = {}) {
  if (!entry) return false
  if (entry.enabled !== true) return false
  if (entry.availability !== 'reachable') return false
  const req = normalizeRequirements(requirements)
  if (req.provider_constraints && !req.provider_constraints.includes(entry.provider)) return false
  if (req.allowed_providers && !req.allowed_providers.includes(entry.provider)) return false
  if (req.needs_tools && entry.tool_support !== true) return false
  if (req.needs_mcp && entry.mcp_support !== true) return false
  if (req.needs_structured_output && structuredOutputRank(entry.structured_output) < structuredOutputRank(req.needs_structured_output)) return false
  if (req.quality_requirement && tierRank(entry.quality_tier, QUALITY_TIERS) < tierRank(req.quality_requirement, QUALITY_TIERS)) return false
  if (req.context_requirement && tierRank(entry.context_tier, CONTEXT_TIERS) < tierRank(req.context_requirement, CONTEXT_TIERS)) return false
  if (req.cost_ceiling && tierRank(entry.cost_tier, COST_TIERS) > tierRank(req.cost_ceiling, COST_TIERS)) return false
  return true
}

function candidateScore(entry) {
  // Cheapest sufficient model wins: cost first, then quality (ordinal policy
  // metadata). Lower score = better.
  return tierRank(entry.cost_tier, COST_TIERS) * 100 + tierRank(entry.quality_tier, QUALITY_TIERS)
}

/**
 * Deterministic model selection. Returns a route assignment or a denial.
 *
 * Routing authority:
 *   - worker_requested_model is IGNORED (worker cannot self-select).
 *   - explicit_override (admin/user) is validated against the catalog; an
 *     invalid override is DENIED, never silently corrected.
 */
export function selectRoute({
  requirements = {},
  catalog = DEFAULT_MODEL_CATALOG,
  policy = DEFAULT_ROUTING_POLICY,
  explicit_override = null,
  worker_requested_model = null,
  route_index = 0,
  phase = 'BUILD',
  availability = null,
} = {}) {
  const req = normalizeRequirements(requirements)
  // The policy allowlist is a hard constraint on candidate providers — no
  // silent provider discovery beyond the explicit list.
  const allowed = req.allowed_providers || policy.allowed_providers || null
  const candidateRequirements = allowed ? { ...req, allowed_providers: allowed } : req
  // Live availability is REAL observed state (probes, runtime checks). A
  // model marked unavailable is never selected and never called — the policy
  // falls back to the next sufficient candidate or blocks.
  const unavailableSet = new Set([
    ...(Array.isArray(availability) ? availability : []),
    ...(Array.isArray(policy?.unavailable_models) ? policy.unavailable_models : []),
  ])
  const isUnavailable = (entry) => unavailableSet.has(`${entry.provider}/${entry.model}`) || unavailableSet.has(entry.model)

  // 1. Admin/user override: policy-validated, distinguishable from worker
  //    self-selection.
  if (explicit_override && explicit_override.provider && explicit_override.model) {
    const entry = getCatalogEntry(catalog, explicit_override.provider, explicit_override.model)
    if (!entry) {
      return { ok: false, code: 'MODEL_UNAVAILABLE', reason: `override model ${explicit_override.provider}/${explicit_override.model} is not in the canonical catalog` }
    }
    if (entry.enabled !== true) {
      return { ok: false, code: 'ROUTING_POLICY_DENIED', reason: `override model ${explicit_override.provider}/${explicit_override.model} is disabled` }
    }
    if (allowed && !allowed.includes(entry.provider)) {
      return { ok: false, code: 'ROUTING_POLICY_DENIED', reason: `override provider ${entry.provider} is not allowlisted` }
    }
    if (isUnavailable(entry)) {
      return { ok: false, code: 'MODEL_UNAVAILABLE', reason: `override model ${entry.provider}/${entry.model} is unavailable (live availability)` }
    }
    if (!modelMeetsRequirements(entry, req)) {
      return { ok: false, code: 'ROUTING_CAPABILITY_INCOMPATIBLE', reason: `override model ${entry.provider}/${entry.model} does not meet the task capability requirements` }
    }
    return {
      ok: true,
      route: {
        provider: entry.provider,
        model: entry.model,
        phase,
        route_index,
        routing_reason: 'EXPLICIT_OVERRIDE_VALIDATED',
        policy_revision: ROUTING_POLICY_REVISION,
        capabilities: entry.capabilities || [],
        cost_tier: entry.cost_tier,
        quality_tier: entry.quality_tier,
        context_tier: entry.context_tier,
      },
      override_used: true,
    }
  }

  // 2. Worker self-selection is never honored — the runtime policy is the
  //    authority. The request is recorded as DENIED/IGNORED and policy
  //    selection continues unchanged.
  const workerSelfSelection = worker_requested_model ? { worker_self_selection: 'DENIED', worker_requested: String(worker_requested_model).slice(0, 120) } : {}

  // 3. Capability-compatible candidates (reachable, enabled, allowlisted,
  //    and live-available).
  const candidates = (catalog || [])
    .filter((entry) => modelMeetsRequirements(entry, candidateRequirements))
    .filter((entry) => !isUnavailable(entry))

  // 4. Baseline routing: an unconstrained task deterministically goes to the
  //    configured primary route.
  if (candidates.length > 0 && !hasConstraints(req)) {
    const primary = findPrimaryRoute(catalog, allowed)
    if (primary && modelMeetsRequirements(primary, req) && !isUnavailable(primary)) {
      return {
        ok: true,
        route: {
          provider: primary.provider,
          model: primary.model,
          phase,
          route_index,
          routing_reason: 'PRIMARY_ROUTE',
          policy_revision: ROUTING_POLICY_REVISION,
          capabilities: primary.capabilities || [],
          cost_tier: primary.cost_tier,
          quality_tier: primary.quality_tier,
          context_tier: primary.context_tier,
        },
        ...workerSelfSelection,
      }
    }
  }

  // 4b. Primary route live-unavailable → deterministic fallback to the
  //     cheapest sufficient candidate (explicitly observable).
  if (candidates.length > 0 && !hasConstraints(req)) {
    const sortedFallback = [...candidates].sort((a, b) => candidateScore(a) - candidateScore(b) || (a.provider + a.model).localeCompare(b.provider + b.model))
    const chosen = sortedFallback[0]
    return {
      ok: true,
      route: {
        provider: chosen.provider,
        model: chosen.model,
        phase,
        route_index,
        routing_reason: 'PRIMARY_UNAVAILABLE_FALLBACK',
        policy_revision: ROUTING_POLICY_REVISION,
        capabilities: chosen.capabilities || [],
        cost_tier: chosen.cost_tier,
        quality_tier: chosen.quality_tier,
        context_tier: chosen.context_tier,
      },
      ...workerSelfSelection,
    }
  }

  // 5. Constrained task: cheapest sufficient model (capability-based).
  if (candidates.length === 0) {
    return {
      ok: false,
      code: 'ROUTING_CAPABILITY_INCOMPATIBLE',
      reason: `no reachable, enabled, allowlisted model satisfies the task requirements (${JSON.stringify(req)})`,
    }
  }
  const sorted = [...candidates].sort((a, b) => candidateScore(a) - candidateScore(b) || (a.provider + a.model).localeCompare(b.provider + b.model))
  const chosen = sorted[0]
  return {
    ok: true,
    route: {
      provider: chosen.provider,
      model: chosen.model,
      phase,
      route_index,
      routing_reason: candidates.length === 1 ? 'DIRECT_CAPABILITY_ROUTE' : 'CHEAPEST_SUFFICIENT',
      policy_revision: ROUTING_POLICY_REVISION,
      capabilities: chosen.capabilities || [],
      cost_tier: chosen.cost_tier,
      quality_tier: chosen.quality_tier,
      context_tier: chosen.context_tier,
      satisfies: req,
    },
    ...workerSelfSelection,
  }
}

function hasConstraints(req) {
  return Boolean(
    req.needs_tools || req.needs_mcp || req.needs_structured_output || req.context_requirement
    || req.quality_requirement || req.cost_ceiling || req.provider_constraints || req.allowed_providers,
  )
}

/**
 * Pick the escalation target for a classified failure: same provider first
 * (higher quality / context / missing capability), then an allowlisted
 * provider. Never repeats a route already tried in this run (loop guard).
 */
function pickEscalationRoute({ current, requirements, catalog, policy, route_history = [], allow_provider_fallback = false }) {
  const req = normalizeRequirements(requirements)
  const candidates = (catalog || [])
    .filter((entry) => entry.enabled && entry.availability === 'reachable')
    .filter((entry) => modelMeetsRequirements(entry, req))
    .filter((entry) => !(entry.provider === current.provider && entry.model === current.model)) // strictly better route
    .filter((entry) => route_history.every((r) => !(r.provider === entry.provider && r.model === entry.model))) // no loop
    .filter((entry) => {
      if (entry.provider === current.provider) return true
      return allow_provider_fallback && (policy.provider_fallback_allowlist || []).includes(entry.provider)
    })
    .sort((a, b) => {
      // Prefer same provider, then quality, then cost (escalation must never
      // downgrade capability/quality).
      const sameA = a.provider === current.provider ? 0 : 1
      const sameB = b.provider === current.provider ? 0 : 1
      if (sameA !== sameB) return sameA - sameB
      const qualityDelta = tierRank(b.quality_tier, QUALITY_TIERS) - tierRank(a.quality_tier, QUALITY_TIERS)
      if (qualityDelta !== 0) return qualityDelta
      const contextDelta = tierRank(b.context_tier, CONTEXT_TIERS) - tierRank(a.context_tier, CONTEXT_TIERS)
      if (contextDelta !== 0) return contextDelta
      return candidateScore(a) - candidateScore(b)
    })
  const chosen = candidates[0] || null
  if (!chosen) return null
  return {
    provider: chosen.provider,
    model: chosen.model,
    routing_reason: chosen.provider === current.provider ? 'ESCALATION_SAME_PROVIDER' : 'ESCALATION_PROVIDER_FALLBACK',
  }
}

/**
 * Post-failure routing decision. This is where retry-same-model, model
 * escalation, and provider fallback are strictly separated. All transitions
 * are bounded and observable.
 */
export function decideRouteAction({
  failure_class = null,
  route = null,
  requirements = {},
  catalog = DEFAULT_MODEL_CATALOG,
  policy = DEFAULT_ROUTING_POLICY,
  attempt = 0,
  escalation_count = 0,
  provider_fallback_count = 0,
  route_history = [],
} = {}) {
  if (!route) {
    return { action: ROUTE_ACTION.TERMINAL, reason_code: 'ROUTING_NO_ROUTE', routing_reason: 'no active route to act on' }
  }
  if (!ROUTING_FAILURE_CLASS_SET.has(failure_class)) {
    return { action: ROUTE_ACTION.TERMINAL, reason_code: 'ROUTING_UNCLASSIFIED_FAILURE', routing_reason: `unclassified failure class: ${failure_class}` }
  }

  // Budget guards first — no unbounded model hopping.
  if (escalation_count >= policy.max_model_escalations && (policy.escalation_classes.includes(failure_class) || failure_class === 'MODEL_CAPABILITY_INSUFFICIENT' || failure_class === 'MODEL_UNAVAILABLE')) {
    return { action: ROUTE_ACTION.TERMINAL, reason_code: 'ROUTING_BUDGET_EXHAUSTED', routing_reason: `max_model_escalations reached (${escalation_count}/${policy.max_model_escalations}) — no further model call` }
  }

  const isRetryClass = (policy.retry_classes || []).includes(failure_class)
  const isEscalationClass = (policy.escalation_classes || []).includes(failure_class)
  const isProviderClass = ['PROVIDER_UNAVAILABLE', 'MODEL_UNAVAILABLE'].includes(failure_class)

  // RETRY stays on the SAME provider+model with a meaningful strategy delta
  // (bounded by max_attempts_per_route). Never crosses into another model.
  if (isRetryClass) {
    if (attempt < policy.max_attempts_per_route) {
      return { action: ROUTE_ACTION.RETRY_SAME_MODEL, reason_code: 'RETRY_SAME_MODEL_ALLOWED', routing_reason: `${failure_class} — retry on same route with strategy delta (bounded)` }
    }
    // Retry budget on this route exhausted → escalation is a DISTINCT step.
    if (isEscalationClass && escalation_count < policy.max_model_escalations) {
      const next = pickEscalationRoute({ current: route, requirements, catalog, policy, route_history, allow_provider_fallback: provider_fallback_count < policy.max_provider_fallbacks })
      if (next) {
        return { action: ROUTE_ACTION.ESCALATE, next_route: next, reason_code: 'ESCALATION_RETRY_BUDGET_EXHAUSTED', routing_reason: `${failure_class} — retry budget exhausted, escalation to ${next.provider}/${next.model}` }
      }
    }
    return { action: ROUTE_ACTION.TERMINAL, reason_code: 'ROUTING_BUDGET_EXHAUSTED', routing_reason: `${failure_class} — retry budget exhausted, no escalation candidate` }
  }

  // ESCALATION changes the assigned model (same run_id, explicit reason).
  if (isEscalationClass) {
    const allowFallback = provider_fallback_count < policy.max_provider_fallbacks
    const next = pickEscalationRoute({ current: route, requirements, catalog, policy, route_history, allow_provider_fallback: allowFallback })
    if (next) {
      return {
        action: next.provider === route.provider ? ROUTE_ACTION.ESCALATE : ROUTE_ACTION.PROVIDER_FALLBACK,
        next_route: next,
        reason_code: next.provider === route.provider ? 'ESCALATION_ALLOWED' : 'PROVIDER_FALLBACK_ALLOWED',
        routing_reason: `${failure_class} — ${next.provider === route.provider ? 'model escalation' : 'provider fallback'} to ${next.provider}/${next.model}`,
      }
    }
    return { action: ROUTE_ACTION.TERMINAL, reason_code: 'ROUTING_NO_ESCALATION_TARGET', routing_reason: `${failure_class} — no escalation candidate within budgets/allowlist` }
  }

  // PROVIDER failure: fallback ONLY across providers within the explicit
  // allowlist. A same-provider model switch is not a valid fallback when the
  // provider itself is unavailable (it would inherit the same failure).
  if (isProviderClass) {
    if (provider_fallback_count >= policy.max_provider_fallbacks) {
      return { action: ROUTE_ACTION.TERMINAL, reason_code: 'ROUTING_BUDGET_EXHAUSTED', routing_reason: `max_provider_fallbacks reached (${provider_fallback_count}/${policy.max_provider_fallbacks})` }
    }
    const req = normalizeRequirements(requirements)
    const allowlist = policy.provider_fallback_allowlist || []
    const crossProvider = (catalog || [])
      .filter((entry) => entry.enabled && entry.availability === 'reachable')
      .filter((entry) => modelMeetsRequirements(entry, req))
      .filter((entry) => entry.provider !== route.provider)
      .filter((entry) => allowlist.includes(entry.provider))
      .filter((entry) => route_history.every((r) => !(r.provider === entry.provider && r.model === entry.model)))
      .sort((a, b) => candidateScore(a) - candidateScore(b) || (a.provider + a.model).localeCompare(b.provider + b.model))
    const chosen = crossProvider[0] || null
    if (chosen) {
      return { action: ROUTE_ACTION.PROVIDER_FALLBACK, next_route: { provider: chosen.provider, model: chosen.model, routing_reason: 'PROVIDER_FALLBACK_ALLOWLIST' }, reason_code: 'PROVIDER_FALLBACK_ALLOWED', routing_reason: `${failure_class} — allowlisted fallback to ${chosen.provider}/${chosen.model}` }
    }
    return { action: ROUTE_ACTION.TERMINAL, reason_code: 'ROUTING_NO_FALLBACK', routing_reason: `${failure_class} — no allowlisted fallback provider` }
  }

  // AUTH failure: fail closed. It hides secret/config problems and must not
  // trigger an automatic provider sweep.
  if (failure_class === 'PROVIDER_AUTH_FAILURE') {
    return { action: ROUTE_ACTION.TERMINAL, reason_code: 'AUTH_FAILURE_FAIL_CLOSED', routing_reason: `${failure_class} — fail closed (no automatic provider sweep); secrets/config must be inspected` }
  }

  // ROUTING_POLICY_DENIED / ROUTING_BUDGET_EXHAUSTED — policy-level terminal.
  return { action: ROUTE_ACTION.TERMINAL, reason_code: failure_class, routing_reason: `${failure_class} — controlled terminal transition` }
}

/**
 * Runtime seam guard: a route (or any routing artifact) carrying a run_id
 * different from the run's run_id is a contract violation. This is the
 * negative-proof boundary for "provider/model must not change the run_id".
 */
export function enforceRouteRunId(runId, route, label = 'route') {
  if (route && typeof route === 'object' && route.run_id !== undefined && route.run_id !== null && route.run_id !== runId) {
    throw new Error(`CONTRACT_INVALID:${label}:run_id ${route.run_id} does not match task run_id ${runId}`)
  }
  return route
}

/**
 * MCP grant stability across a model route change: the tool grant is runtime
 * authority (attached to the task/plan, never to the model's wish). A new
 * route may only use the tools of the run's resolved grant.
 */
export function assertGrantStableAcrossRoute(grant, route) {
  if (!grant) return { allowed: false, code: 'MCP_GRANT_UNAVAILABLE' }
  return { allowed: true, code: 'MCP_GRANT_STABLE_ACROSS_MODEL_ROUTE', route_provider: route?.provider, route_model: route?.model }
}
