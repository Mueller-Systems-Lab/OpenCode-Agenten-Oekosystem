// SPDX-License-Identifier: MIT
/**
 * Deterministic Harness Resolver — the runtime authority that maps a
 * ROUTE-SELECTED model + task role to an effective worker harness.
 *
 * HARNESS_RESOLVER_AUTHORITY: the resolver is a pure deterministic function.
 * The router chooses the model; the resolver chooses the profile; the worker
 * chooses NEITHER — worker_requested_profile is always ignored and recorded
 * as denied. Unknown or non-selectable models resolve to the safe generic
 * fallback (GENERIC_HARNESS_FALLBACK_REQUIRED). The resolver never mutates
 * its inputs and never touches provider/model/route fields.
 *
 * The fingerprint is the sha256 of the canonical JSON (sorted keys) of the
 * resolution inputs — NO timestamps, NO run ids: identical inputs always
 * produce the identical fingerprint.
 */
import crypto from 'node:crypto'
import {
  MODEL_HARNESS_CONTRACT_ID,
  TASK_ROLES,
  validateModelHarnessProfile,
  validateTaskRoleOverlay,
} from './model-harness-contract.mjs'
import {
  MODEL_HARNESS_REGISTRY_VERSION,
  GENERIC_PROFILE_ID,
  DEFAULT_PRODUCT_MODEL_HARNESS_PROFILES,
  findProfileForModel,
  getProfile,
} from './product-model-harness-profiles.mjs'
import {
  TASK_ROLE_REGISTRY_VERSION,
  DEFAULT_TASK_ROLE_PROFILES,
} from './task-role-profiles.mjs'

export const HARNESS_RESOLVER_AUTHORITY = 'DETERMINISTIC_RUNTIME_HARNESS_RESOLVER'
export const HARNESS_RESOLVER_VERSION = '1.0.0'

const ROLE_SET = new Set(TASK_ROLES)

/**
 * Single normalization point for model identity: accepts 'provider/model' or
 * { provider, model }. Provider is trimmed + lowercased, model lowercased
 * (catalog ids are lowercase). Throws CONTRACT_INVALID on malformed input.
 */
export function normalizeModelIdentity(input) {
  let provider
  let model
  if (typeof input === 'string') {
    const parts = input.split('/')
    if (parts.length !== 2) {
      throw new Error('CONTRACT_INVALID:model-identity:expected provider/model string')
    }
    provider = parts[0]
    model = parts[1]
  } else if (input && typeof input === 'object' && !Array.isArray(input)) {
    provider = input.provider
    model = input.model
  } else {
    throw new Error('CONTRACT_INVALID:model-identity:expected provider/model string or { provider, model }')
  }
  if (typeof provider !== 'string' || typeof model !== 'string') {
    throw new Error('CONTRACT_INVALID:model-identity:provider and model must be strings')
  }
  const normalized = { provider: provider.trim().toLowerCase(), model: model.trim().toLowerCase() }
  if (!normalized.provider || !normalized.model) {
    throw new Error('CONTRACT_INVALID:model-identity:provider and model must be non-empty')
  }
  return Object.freeze(normalized)
}

/** Canonical JSON: object keys sorted recursively, stable string form. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function harnessFingerprint({ profile_id, profile_version, task_role, effective_harness }) {
  const canonical = canonicalJson({
    contract: MODEL_HARNESS_CONTRACT_ID,
    registry_version: MODEL_HARNESS_REGISTRY_VERSION,
    role_registry_version: TASK_ROLE_REGISTRY_VERSION,
    profile_id,
    profile_version,
    task_role,
    effective_harness,
  })
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deterministic value merge, keyed by the innermost field name:
 *   - scalars — override wins
 *   - arrays — additive hint lists (compression_hints, retry_hints,
 *     known_failure_mitigations, task_relevant_tools) concatenate with
 *     canonical dedup (base order first); every other array is an ORDERED
 *     LIST (e.g. instruction_order) and is REPLACED by the override —
 *     concatenation there would be meaningless.
 *   - objects — recursive merge.
 * Never mutates inputs; always returns fresh values.
 */
const ADDITIVE_ARRAY_KEYS = new Set(['compression_hints', 'retry_hints', 'known_failure_mitigations', 'task_relevant_tools'])

function mergeValue(base, override, keyName = null) {
  if (override === undefined) return base
  if (Array.isArray(base) && Array.isArray(override)) {
    if (keyName && ADDITIVE_ARRAY_KEYS.has(keyName)) {
      const seen = new Set()
      const merged = []
      for (const item of [...base, ...override]) {
        const key = canonicalJson(item)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(item)
      }
      return merged
    }
    return [...override]
  }
  if (isPlainObject(base) && isPlainObject(override)) {
    const merged = { ...base }
    for (const key of Object.keys(override)) merged[key] = mergeValue(base[key], override[key], key)
    return merged
  }
  return override
}

const POLICY_KEYS = ['context_policy', 'tool_policy', 'result_policy', 'planning_policy', 'retry_hints', 'known_failure_mitigations', 'task_role_overrides']

/** Apply policy keys of a refinement (profile / role override / overlay) onto the current policies. */
function applyRefinement(policies, refinement) {
  if (!refinement || typeof refinement !== 'object') return policies
  const next = { ...policies }
  for (const key of POLICY_KEYS) {
    if (refinement[key] === undefined) continue
    if (key === 'task_role_overrides') continue // input mechanism, never an output policy
    next[key] = mergeValue(next[key], refinement[key], key)
  }
  return next
}

function isProfileSelectable(profile, allow_candidate) {
  if (!profile) return false
  if (profile.profile_id === GENERIC_PROFILE_ID) return profile.status === 'active'
  if (profile.status === 'promoted') return true
  if (profile.status === 'candidate') return allow_candidate === true
  return false // rejected (or invalid status) never applies
}

/**
 * Resolve the effective model harness.
 *
 * Deterministic: identical inputs → deep-equal result including the
 * fingerprint. Throws CONTRACT_INVALID for malformed identity or task role.
 * A worker-requested profile is ALWAYS ignored (recorded as DENIED).
 */
export function resolveModelHarness(input = {}) {
  const options = typeof input === 'string'
    ? { provider: input }
    : (input && typeof input === 'object' ? input : {})
  const {
  provider,
  model,
  task_role = 'BUILD',
  profiles = DEFAULT_PRODUCT_MODEL_HARNESS_PROFILES,
  role_profiles = DEFAULT_TASK_ROLE_PROFILES,
  allow_candidate = false,
  worker_requested_profile = null,
  } = options
  const identity = normalizeModelIdentity(
    typeof provider === 'string' && typeof model === 'string'
      ? { provider, model }
      : provider /* allow a single 'provider/model' or identity object */,
  )
  if (!ROLE_SET.has(task_role)) {
    throw new Error(`CONTRACT_INVALID:task-role:${String(task_role)} not in ${TASK_ROLES.join('|')}`)
  }

  for (const [index, profile] of (profiles || []).entries()) {
    const validation = validateModelHarnessProfile(profile)
    if (!validation.ok) {
      throw new Error(`CONTRACT_INVALID:model-harness-profile[${index}]:${validation.issues.join('; ')}`)
    }
  }
  for (const [role, overlay] of Object.entries(role_profiles || {})) {
    if (!ROLE_SET.has(role)) throw new Error(`CONTRACT_INVALID:task-role-overlay:${role} is not a known task role`)
    const validation = validateTaskRoleOverlay(overlay)
    if (!validation.ok) {
      throw new Error(`CONTRACT_INVALID:task-role-overlay:${role}:${validation.issues.join('; ')}`)
    }
  }

  const genericProfile = getProfile(profiles, GENERIC_PROFILE_ID)
  if (!genericProfile || genericProfile.status !== 'active') {
    throw new Error('CONTRACT_INVALID:harness-registry:selectable generic profile missing (GENERIC_HARNESS_FALLBACK_REQUIRED)')
  }

  const workerSelfSelection = worker_requested_profile !== null && worker_requested_profile !== undefined
    ? 'DENIED' // WORKER_SELF_SELECT_HARNESS=DENIED — always ignored, never applied
    : 'NONE'

  const matched = findProfileForModel(profiles, identity.provider, identity.model)
  const selectable = isProfileSelectable(matched, allow_candidate)
  const profile = selectable ? matched : genericProfile
  const resolution = selectable && profile.profile_id !== GENERIC_PROFILE_ID ? 'MODEL_PROFILE' : 'GENERIC_FALLBACK'

  // L0/L1/L2 deterministic composition: generic baseline ⊕ model profile ⊕
  // matching task_role_overrides ⊕ role overlay (role wins per policy key).
  let policies = applyRefinement({}, genericProfile)
  if (selectable && profile.profile_id !== GENERIC_PROFILE_ID) {
    policies = applyRefinement(policies, profile)
    const roleOverride = profile.task_role_overrides ? profile.task_role_overrides[task_role] : null
    if (roleOverride) policies = applyRefinement(policies, roleOverride)
  }
  const roleOverlay = role_profiles ? role_profiles[task_role] : null
  if (roleOverlay) policies = applyRefinement(policies, roleOverlay)

  const effectiveHarness = deepFreeze({
    core_authority_unchanged: true,
    context_policy: policies.context_policy !== undefined ? policies.context_policy : {},
    tool_policy: policies.tool_policy !== undefined ? policies.tool_policy : {},
    result_policy: policies.result_policy !== undefined ? policies.result_policy : {},
    planning_policy: policies.planning_policy !== undefined ? policies.planning_policy : {},
    retry_hints: policies.retry_hints !== undefined ? policies.retry_hints : [],
    known_failure_mitigations: policies.known_failure_mitigations !== undefined ? policies.known_failure_mitigations : [],
  })

  return Object.freeze({
    ok: true,
    resolution,
    profile_id: profile.profile_id,
    profile_version: profile.version,
    profile_full_id: `${profile.profile_id}.v${profile.version}`,
    task_role,
    effective_harness: effectiveHarness,
    fingerprint: harnessFingerprint({
      profile_id: profile.profile_id,
      profile_version: profile.version,
      task_role,
      effective_harness: effectiveHarness,
    }),
    worker_self_selection: workerSelfSelection,
  })
}

function deepFreeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze))
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key])
    return Object.freeze(value)
  }
  return value
}
