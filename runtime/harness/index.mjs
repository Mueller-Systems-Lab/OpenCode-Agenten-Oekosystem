// SPDX-License-Identifier: MIT
/**
 * Hierarchical model-harness module — barrel exports.
 *
 * Installable L1/L2 harness product surface above the unchanged canonical
 * core (SHARED_CORE_OWNS). Evaluation helpers and candidate profiles are kept
 * in runtime/harness/evaluation.mjs and are not imported by this barrel.
 */
export {
  MODEL_HARNESS_CONTRACT_ID,
  MODEL_HARNESS_CONTRACT_VERSION,
  HARNESS_PROFILE_STATUSES,
  TASK_ROLES,
  PROFILE_POLICY_KEYS,
  FORBIDDEN_PROFILE_KEYS,
  validateModelHarnessProfile,
  validateTaskRoleOverlay,
  createModelHarnessProfile,
} from './model-harness-contract.mjs'
export {
  MODEL_HARNESS_REGISTRY_VERSION,
  GENERIC_PROFILE_ID,
  DEFAULT_PRODUCT_MODEL_HARNESS_PROFILES,
  findProfileForModel,
  getProfile,
} from './product-model-harness-profiles.mjs'
export {
  TASK_ROLE_REGISTRY_VERSION,
  DEFAULT_TASK_ROLE_PROFILES,
} from './task-role-profiles.mjs'
export {
  HARNESS_RESOLVER_AUTHORITY,
  HARNESS_RESOLVER_VERSION,
  normalizeModelIdentity,
  resolveModelHarness,
} from './harness-resolver.mjs'
export {
  composeWorkerTaskText,
  applyToolExposure,
  harnessEvidenceFields,
} from './apply-harness.mjs'
