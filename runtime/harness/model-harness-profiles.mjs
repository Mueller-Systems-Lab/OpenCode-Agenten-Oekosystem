// SPDX-License-Identifier: MIT
/**
 * Development/evaluation model-harness profile registry — DATA, NOT AUTHORITY.
 *
 * Every profile is created through the fail-closed contract factory at module
 * load (invalid data cannot exist here). Profiles refine prompt-shaping
 * vocabulary only; routing, pipeline, controller, grants, and budgets stay
 * with the shared canonical core.
 *
 * This file is deliberately not installed into a normal OCAE target.
 * Lifecycle: 'active' is reserved for the safe generic baseline; model
 * profiles start as 'candidate' and become 'promoted' or 'rejected' only via
 * the evaluation + promotion rules (see
 * docs/specs/ocae-hierarchical-model-harness-foundation.md). Candidates never
 * auto-apply in production.
 */
import { createModelHarnessProfile } from './model-harness-contract.mjs'

export const MODEL_HARNESS_REGISTRY_VERSION = '1.0.0'
export const GENERIC_PROFILE_ID = 'generic'

// --- generic.v1 — safe default harness (the only 'active' profile) ---------
const genericProfile = createModelHarnessProfile({
  profile_id: 'generic',
  version: 1,
  status: 'active',
  model_match: null,
  context_policy: {
    framing_style: 'STANDARD',
    instruction_order: ['task', 'constraints', 'output_format'],
    scaffolding_verbosity: 'STANDARD',
    compression_hints: [],
  },
  tool_policy: {
    description_verbosity: 'STANDARD',
    tool_exposure: 'FULL_TOOLSET',
    action_boundaries: 'STANDARD',
  },
  result_policy: {
    truncation_hint: 'NONE',
    structured_output_anchoring: 'STANDARD',
  },
  planning_policy: {
    granularity: 'STANDARD',
  },
  retry_hints: [],
  known_failure_mitigations: [],
  evidence_metadata: {
    hypothesis: 'safe default harness',
    value_proven: true, // as the safe baseline every fallback resolves to
    evidence_path: null,
  },
})

// --- hy3.v1 — candidate: efficiency / context reduction --------------------
const hy3Profile = createModelHarnessProfile({
  profile_id: 'hy3',
  version: 1,
  status: 'candidate',
  model_match: { provider: 'opencode', model: 'hy3-free' },
  context_policy: {
    framing_style: 'CONCISE',
    instruction_order: ['task', 'output_format', 'constraints'],
    scaffolding_verbosity: 'SHORT',
    compression_hints: [
      'Do not restate the task in your answer',
      'Keep intermediate reasoning minimal',
      'Summarize tool outputs instead of repeating them',
    ],
  },
  tool_policy: {
    description_verbosity: 'SHORT',
    tool_exposure: 'FULL_TOOLSET',
    action_boundaries: 'STANDARD',
  },
  result_policy: {
    truncation_hint: 'SUMMARIZE',
    structured_output_anchoring: 'STANDARD',
  },
  planning_policy: {
    granularity: 'COMPACT',
  },
  retry_hints: [],
  known_failure_mitigations: [],
  evidence_metadata: {
    hypothesis: 'efficiency / context reduction',
    value_proven: false,
    evidence_path: null,
  },
})

// --- muse.v1 — candidate: tool selection / tool interface behavior --------
const museProfile = createModelHarnessProfile({
  profile_id: 'muse',
  version: 1,
  status: 'candidate',
  model_match: { provider: 'opencode', model: 'muse-spark-1.2-contributor-free' },
  tool_policy: {
    description_verbosity: 'SHORT_EXPLICIT',
    tool_exposure: 'TASK_MINIMAL_TOOLSET',
    action_boundaries: 'EXPLICIT',
    explicit_tool_contracts: true,
    task_relevant_tools: ['read', 'write', 'edit', 'list', 'glob'], // file-artifact tools
  },
  context_policy: {
    framing_style: 'STANDARD',
    instruction_order: ['task', 'action_boundary', 'output_format', 'constraints'],
    scaffolding_verbosity: 'STANDARD',
    compression_hints: [],
  },
  result_policy: {
    truncation_hint: 'NONE',
    structured_output_anchoring: 'STANDARD',
  },
  planning_policy: {
    granularity: 'STANDARD',
  },
  known_failure_mitigations: [
    {
      failure_signature: 'fabricated_tool_result',
      adjustment: 'explicit action boundary: only report values actually observed from tool output; never invent file contents or tool results',
    },
  ],
  evidence_metadata: {
    hypothesis: 'tool selection / tool interface behavior',
    value_proven: false,
    evidence_path: null,
  },
})

// --- nemotron.v1 — candidate: runtime robustness / structured output ------
const nemotronProfile = createModelHarnessProfile({
  profile_id: 'nemotron',
  version: 1,
  status: 'candidate',
  model_match: { provider: 'opencode', model: 'nemotron-3-ultra-free' },
  context_policy: {
    framing_style: 'STEPWISE',
    instruction_order: ['task', 'steps', 'output_format', 'constraints'],
    scaffolding_verbosity: 'STANDARD',
    ordered_instructions: true,
    compression_hints: [],
  },
  result_policy: {
    truncation_hint: 'NONE',
    structured_output_anchoring: 'STRICT',
    final_answer_anchoring: true,
  },
  tool_policy: {
    description_verbosity: 'STANDARD',
    tool_exposure: 'FULL_TOOLSET',
    action_boundaries: 'STANDARD',
  },
  planning_policy: {
    granularity: 'STEPWISE',
  },
  known_failure_mitigations: [
    {
      failure_signature: 'structured_output_degradation',
      adjustment: 'restate the exact required output format immediately before the final answer',
    },
  ],
  retry_hints: [],
  evidence_metadata: {
    hypothesis: 'runtime robustness',
    value_proven: false,
    evidence_path: null,
  },
})

export const DEFAULT_MODEL_HARNESS_PROFILES = Object.freeze([
  genericProfile,
  hy3Profile,
  museProfile,
  nemotronProfile,
])

/** Status precedence for selection: promoted > candidate > active > rejected. */
const STATUS_PRECEDENCE = Object.freeze({ promoted: 0, candidate: 1, active: 2, rejected: 3 })

/**
 * Exact model_match lookup with deterministic status precedence. Returns the
 * matching profile object or null. Selectability is decided by the resolver
 * (candidates require explicit allow_candidate).
 */
export function findProfileForModel(profiles, provider, model) {
  const matches = (profiles || []).filter((profile) => profile
    && profile.model_match
    && profile.model_match.provider === provider
    && profile.model_match.model === model)
  if (matches.length === 0) return null
  return matches.reduce((best, current) => (
    (STATUS_PRECEDENCE[current.status] ?? Number.POSITIVE_INFINITY)
      < (STATUS_PRECEDENCE[best.status] ?? Number.POSITIVE_INFINITY) ? current : best
  ))
}

/** Look up a profile by profile_id (first match, registry order). */
export function getProfile(profiles, profileId) {
  return (profiles || []).find((profile) => profile && profile.profile_id === profileId) || null
}
