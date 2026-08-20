// SPDX-License-Identifier: MIT
/**
 * Runtime routing module — deterministic model routing policy.
 *
 * LLMs ARE WORKERS. LLMs ARE NOT THE CONTROLLER. The routing policy is a
 * runtime policy: the worker receives an assigned provider/model and never
 * selects, upgrades, or falls back on its own.
 */
export {
  CATALOG_VERSION,
  DEFAULT_MODEL_CATALOG,
  PROVIDER_INVENTORY,
  COST_TIERS,
  QUALITY_TIERS,
  CONTEXT_TIERS,
  STRUCTURED_OUTPUT_LEVELS,
  getCatalogEntry,
  findReachableModels,
  findPrimaryRoute,
  tierRank,
} from './model-catalog.mjs'
export {
  ROUTING_FAILURE_CLASSES,
  ROUTING_FAILURE_CLASS_SET,
  isRoutingFailureClass,
  classifyWorkerOutcome,
  redactFailureReason,
} from './failure-classifier.mjs'
export {
  ROUTING_POLICY_REVISION,
  MODEL_SELECTION_AUTHORITY,
  ROUTE_ACTION,
  DEFAULT_ROUTING_POLICY,
  selectRoute,
  decideRouteAction,
  enforceRouteRunId,
  assertGrantStableAcrossRoute,
  modelMeetsRequirements,
  routeCandidates,
  healthRoutable,
  costGateAllows,
} from './routing-policy.mjs'
export {
  ROUTING_EVENT_JOBS,
  routeSelectedEvent,
  routeRejectedEvent,
  escalationEvent,
  providerFallbackEvent,
  workerStartEvent,
  workerResultEvent,
  workerFailureEvent,
  healthProbeStartEvent,
  healthProbeResultEvent,
  healthStateChangedEvent,
  usageEvent,
} from './routing-events.mjs'
export {
  HEALTH_STATES,
  HEALTH_TTL_BOUNDS,
  DEFAULT_HEALTH_TTL_SECONDS,
  HEALTH_SOURCES,
  clampTtl,
  healthExpiry,
  isHealthStateValid,
  createHealthEntry,
  HealthStore,
  healthStatusRank,
} from './health-state.mjs'
export {
  PROBE_POLICY_DEFAULTS,
  PROBE_PROMPT_DEFAULT,
  probeClassificationFromError,
  statusFromProbeFailure,
  parseRetryAfter,
  probeProviderModel,
  resolveCandidateHealth,
} from './health-probe.mjs'
export {
  USAGE_KEYS,
  normalizeUsageNumber,
  parseUsage,
  isUsagePresent,
  aggregateUsage,
  usageRedacted,
} from './usage.mjs'
