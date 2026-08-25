// SPDX-License-Identifier: MIT
/**
 * Installable model-harness registry — PRODUCT DATA, NOT AUTHORITY.
 *
 * The generic profile is mandatory for every fresh installation. Model-
 * specific profiles enter this registry only after explicit evidence-gated
 * promotion. Candidate profiles used by Issue #33 evaluation live in
 * model-harness-profiles.mjs and are development/evaluation-only artifacts.
 */
import { createModelHarnessProfile } from './model-harness-contract.mjs'

export const MODEL_HARNESS_REGISTRY_VERSION = '1.0.0'
export const GENERIC_PROFILE_ID = 'generic'

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
  planning_policy: { granularity: 'STANDARD' },
  retry_hints: [],
  known_failure_mitigations: [],
  evidence_metadata: {
    hypothesis: 'safe default harness',
    value_proven: true,
    evidence_path: null,
  },
})

export const DEFAULT_PRODUCT_MODEL_HARNESS_PROFILES = Object.freeze([genericProfile])

const STATUS_PRECEDENCE = Object.freeze({ promoted: 0, candidate: 1, active: 2, rejected: 3 })

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

export function getProfile(profiles, profileId) {
  return (profiles || []).find((profile) => profile && profile.profile_id === profileId) || null
}
