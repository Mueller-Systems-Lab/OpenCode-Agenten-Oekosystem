// SPDX-License-Identifier: MIT
/**
 * Phase-C development/evaluation candidate registry.
 *
 * This file is intentionally not imported by the product profile registry.
 * It supplies the locked HY3 v2 candidate to the confirmatory evaluator only;
 * generic.v1 remains the product fallback and no candidate auto-applies.
 */
import { createModelHarnessProfile } from './model-harness-contract.mjs'
import { DEFAULT_MODEL_HARNESS_PROFILES } from './model-harness-profiles.mjs'

const genericProfile = DEFAULT_MODEL_HARNESS_PROFILES.find((profile) => profile.profile_id === 'generic')
if (!genericProfile) throw new Error('CONTRACT_INVALID:phase-c-v2:generic profile missing')

/**
 * HY3 v1 evidence showed that declarative compression hints and truncation
 * claims added static prompt cost while no runtime compression occurred.
 * V2 therefore retains only a compact renderer framing choice and removes
 * every inactive savings claim.
 */
export const HY3_V2_PROFILE = createModelHarnessProfile({
  profile_id: 'hy3',
  version: 2,
  status: 'candidate',
  model_match: { provider: 'opencode', model: 'hy3-free' },
  context_policy: {
    framing_style: 'CONCISE',
    instruction_order: ['task', 'constraints', 'output_format'],
    scaffolding_verbosity: 'SHORT',
    compression_hints: [],
  },
  tool_policy: {
    description_verbosity: 'SHORT',
    tool_exposure: 'FULL_TOOLSET',
    action_boundaries: 'STANDARD',
  },
  result_policy: {
    truncation_hint: 'NONE',
    structured_output_anchoring: 'STANDARD',
  },
  planning_policy: {
    granularity: 'STANDARD',
    emit_directive: false,
  },
  retry_hints: [],
  known_failure_mitigations: [],
  evidence_metadata: {
    hypothesis: 'remove static profile overhead; retain only cheaper compact framing',
    value_proven: false,
    evidence_path: 'docs/evaluation/issue-33-phase-c-hypothesis-lock.md',
  },
})

/** Explicit evaluator input; never installed or selected by product runtime. */
export const PHASE_C_V2_PROFILES = Object.freeze([genericProfile, HY3_V2_PROFILE])
