// SPDX-License-Identifier: MIT
/**
 * Task-role overlay registry — declarative L2 refinements (DATA, NOT
 * AUTHORITY). Overlays carry ONLY policy-key refinements validated by
 * validateTaskRoleOverlay; the shared core owns everything else.
 *
 * Merge semantics (deterministic, enforced by harness-resolver.mjs): overlay
 * policy keys merge into the effective harness per top-level policy key with
 * the role overlay winning scalars; arrays (e.g. compression_hints) are
 * additive.
 */
import { validateTaskRoleOverlay } from './model-harness-contract.mjs'

export const TASK_ROLE_REGISTRY_VERSION = '1.0.0'

const PLAN = Object.freeze({
  planning_policy: { granularity: 'DETAILED' },
  context_policy: { emphasis: 'State concrete targets and acceptance criteria before building.' },
})

const BUILD = Object.freeze({
  context_policy: { scaffolding_verbosity: 'STANDARD', emphasis: 'produce exactly the requested artifacts' },
  planning_policy: { granularity: 'STANDARD' },
})

const REVIEW = Object.freeze({
  result_policy: { structured_output_anchoring: 'STRICT' },
  context_policy: { emphasis: 'Report findings with concrete evidence — file paths and observed values.' },
})

const RESEARCH = Object.freeze({
  context_policy: { compression_hints: ['cite concrete file paths'] },
  planning_policy: { granularity: 'COMPACT' },
})

const TOOL_USE = Object.freeze({
  tool_policy: { action_boundaries: 'EXPLICIT' },
  context_policy: { emphasis: 'one tool action at a time, verify result before next step' },
})

export const DEFAULT_TASK_ROLE_PROFILES = Object.freeze({ PLAN, BUILD, REVIEW, RESEARCH, TOOL_USE })

// Fail closed at module load: a registry entry that violates the overlay
// contract can never exist here.
for (const [role, overlay] of Object.entries(DEFAULT_TASK_ROLE_PROFILES)) {
  const validation = validateTaskRoleOverlay(overlay)
  if (!validation.ok) {
    throw new Error(`CONTRACT_INVALID:task-role-overlay:${role}:${validation.issues.join('; ')}`)
  }
}
