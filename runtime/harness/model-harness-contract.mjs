// SPDX-License-Identifier: MIT
/**
 * Model-Harness Contract — ecosystem.model-harness.v1.
 *
 * A model-harness profile is DECLARATIVE DATA, never authority. It may only
 * refine prompt-shaping vocabulary (context/tool/result/planning policies,
 * retry hints, known-failure mitigations). Anything that would grant
 * permissions, tools beyond the grant, scopes, routing power, retry budgets,
 * acceptance criteria, or decision authority is FORBIDDEN and fails closed
 * at any depth (SHARED_CORE_OWNS / MODEL_PROFILE_MUST_NOT_CONTROL).
 */
export const MODEL_HARNESS_CONTRACT_ID = 'ecosystem.model-harness.v1'
export const MODEL_HARNESS_CONTRACT_VERSION = '1.0.0'

export const HARNESS_PROFILE_STATUSES = Object.freeze(['active', 'candidate', 'promoted', 'rejected'])

export const TASK_ROLES = Object.freeze(['PLAN', 'BUILD', 'REVIEW', 'RESEARCH', 'TOOL_USE'])

/** Top-level policy keys a profile/overlay may carry (subset, not superset). */
export const PROFILE_POLICY_KEYS = Object.freeze([
  'context_policy',
  'tool_policy',
  'result_policy',
  'planning_policy',
  'retry_hints',
  'known_failure_mitigations',
  'task_role_overrides',
])

/**
 * Fail-closed forbidden keys — a profile/overlay carrying ANY of these (at any
 * depth) is invalid. These are the authority surface of the shared canonical
 * core: permissions, tool grants, scopes, route/model selection, budgets,
 * escalation, cost authorization, acceptance criteria, requirements, scope,
 * terminal decisions, promotion, evidence integrity, controller/route
 * internals. Profiles are data; the core owns every one of these.
 */
export const FORBIDDEN_PROFILE_KEYS = Object.freeze([
  'permissions', 'permission',
  'tool_allowlist', 'tool_allowlist_additions', 'allowed_tools',
  'filesystem_scope', 'network_scope', 'github_scope', 'credential_scope',
  'provider', 'model', 'route', 'routing', 'model_override', 'provider_override',
  'retry', 'retry_budget',
  'retry_budget', 'max_attempts', 'attempt_budget',
  'escalation', 'escalation_policy',
  'cost_authorization', 'budget',
  'acceptance_criteria', 'requirements', 'scope',
  'terminal_decision', 'decision',
  'promotion', 'evidence_integrity',
  'controller', 'decide', 'selectRoute',
])

const FORBIDDEN_KEY_SET = new Set(FORBIDDEN_PROFILE_KEYS)
const STATUS_SET = new Set(HARNESS_PROFILE_STATUSES)
const ROLE_SET = new Set(TASK_ROLES)
const POLICY_KEY_SET = new Set(PROFILE_POLICY_KEYS)

const PROFILE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const PROFILE_IDENTITY_KEYS = Object.freeze(['profile_id', 'version', 'status', 'model_match'])
const MODEL_MATCH_ALLOWED_KEYS = Object.freeze(['provider', 'model'])
const ALLOWED_META_KEYS = Object.freeze(['evidence_metadata'])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Walk a value recursively; visit every object key at any depth. The
 * `model_match` is the profile's REQUIRED identity binding. Its shape is
 * validated separately; all other objects are still checked recursively.
 */
function walkKeys(value, visit, path = '', exempt = false) {
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, visit, path, exempt)
    return
  }
  if (!isPlainObject(value)) return
  for (const key of Object.keys(value)) {
    const keyPath = path ? `${path}.${key}` : key
    if (!exempt) visit(key, keyPath)
    walkKeys(value[key], visit, keyPath, exempt || keyPath === 'model_match')
  }
}

function findForbiddenKeys(value) {
  const hits = []
  walkKeys(value, (key, path) => {
    if (FORBIDDEN_KEY_SET.has(key)) hits.push(path)
  })
  return hits
}

function validatePolicyShape(profile, issues, label) {
  for (const key of Object.keys(profile)) {
    if (POLICY_KEY_SET.has(key) || ALLOWED_META_KEYS.includes(key) || PROFILE_IDENTITY_KEYS.includes(key)) continue
    if (key === 'contract') {
      if (profile.contract !== MODEL_HARNESS_CONTRACT_ID) {
        issues.push(`${label}: contract must be ${MODEL_HARNESS_CONTRACT_ID}`)
      }
      continue
    }
    issues.push(`${label}: unexpected top-level key "${key}" (allowed: policy keys + evidence_metadata)`)
  }
  for (const key of ['retry_hints', 'known_failure_mitigations']) {
    if (profile[key] === undefined) continue
    if (!Array.isArray(profile[key])) {
      issues.push(`${label}: ${key} must be an array`)
      continue
    }
    profile[key].forEach((item, index) => {
      if (!isPlainObject(item)) {
        issues.push(`${label}: ${key}[${index}] must be an object`)
        return
      }
      const failure = item.known_failure !== undefined ? item.known_failure : item.failure_signature
      const hint = item.strategy_delta_hint !== undefined ? item.strategy_delta_hint : item.adjustment
      if (key === 'retry_hints' && (item.known_failure === undefined || item.strategy_delta_hint === undefined)) {
        issues.push(`${label}: retry_hints[${index}] must carry { known_failure, strategy_delta_hint }`)
      }
      if (key === 'known_failure_mitigations' && (item.failure_signature === undefined || item.adjustment === undefined)) {
        issues.push(`${label}: known_failure_mitigations[${index}] must carry { failure_signature, adjustment }`)
      }
      if (typeof failure !== 'string' || typeof hint !== 'string' || !failure || !hint) {
        issues.push(`${label}: ${key}[${index}] must be a string pair`)
      }
    })
  }
  if (profile.task_role_overrides !== undefined) {
    if (!isPlainObject(profile.task_role_overrides)) {
      issues.push(`${label}: task_role_overrides must be an object keyed by task role`)
    } else {
      for (const [role, override] of Object.entries(profile.task_role_overrides)) {
        if (!ROLE_SET.has(role)) {
          issues.push(`${label}: task_role_overrides has unknown task role "${role}"`)
          continue
        }
        for (const key of Object.keys(override || {})) {
          if (!POLICY_KEY_SET.has(key)) {
            issues.push(`${label}: task_role_overrides.${role} has non-policy key "${key}"`)
          }
        }
      }
    }
  }
}

/**
 * Validate a model-harness profile against ecosystem.model-harness.v1.
 * Returns { ok, issues }; never throws.
 */
export function validateModelHarnessProfile(profile) {
  const issues = []
  const label = 'profile'
  if (!isPlainObject(profile)) return { ok: false, issues: [`${label}: must be an object`] }

  const { profile_id, version, status, model_match } = profile
  if (typeof profile_id !== 'string' || !PROFILE_ID_RE.test(profile_id)) {
    issues.push(`${label}: profile_id must be a kebab-case string`)
  }
  if (!Number.isInteger(version) || version < 1) {
    issues.push(`${label}: version must be a positive integer`)
  }
  if (!STATUS_SET.has(status)) {
    issues.push(`${label}: status must be one of ${HARNESS_PROFILE_STATUSES.join('|')}`)
  }
  if (model_match !== null && model_match !== undefined) {
    if (!isPlainObject(model_match)
      || typeof model_match.provider !== 'string' || !model_match.provider
      || typeof model_match.model !== 'string' || !model_match.model) {
      issues.push(`${label}: model_match must be null or { provider, model } non-empty strings`)
    }
    for (const key of Object.keys(model_match || {})) {
      if (!MODEL_MATCH_ALLOWED_KEYS.includes(key)) {
        issues.push(`${label}: model_match has unexpected key "${key}" (allowed: ${MODEL_MATCH_ALLOWED_KEYS.join(', ')})`)
      }
    }
  }
  // Only the safe generic baseline may ever be 'active'.
  if (status === 'active' && profile_id !== 'generic') {
    issues.push(`${label}: status 'active' is only allowed for profile_id 'generic'`)
  }
  if (profile.evidence_metadata !== undefined) {
    const meta = profile.evidence_metadata
    if (!isPlainObject(meta)
      || typeof meta.hypothesis !== 'string' || !meta.hypothesis
      || typeof meta.value_proven !== 'boolean'
      || (meta.evidence_path !== null && typeof meta.evidence_path !== 'string' && meta.evidence_path !== undefined)) {
      issues.push(`${label}: evidence_metadata must be { hypothesis: string, value_proven: boolean, evidence_path: string|null }`)
    }
  }
  validatePolicyShape(profile, issues, label)
  for (const path of findForbiddenKeys(profile)) {
    issues.push(`${label}: forbidden key "${path}" (authority belongs to the shared core)`)
  }
  return { ok: issues.length === 0, issues }
}

/**
 * Validate a task-role overlay: policy keys + no forbidden keys (no identity
 * fields). Returns { ok, issues }; never throws.
 */
export function validateTaskRoleOverlay(overlay) {
  const issues = []
  const label = 'task_role_overlay'
  if (!isPlainObject(overlay)) return { ok: false, issues: [`${label}: must be an object`] }
  validatePolicyShape(overlay, issues, label)
  for (const path of findForbiddenKeys(overlay)) {
    issues.push(`${label}: forbidden key "${path}" (authority belongs to the shared core)`)
  }
  return { ok: issues.length === 0, issues }
}

function deepFreeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze))
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key])
    return Object.freeze(value)
  }
  return value
}

/**
 * Create a deep-frozen validated model-harness profile. Throws
 * CONTRACT_INVALID on any validation failure (fail closed, loud).
 */
export function createModelHarnessProfile(input) {
  const validation = validateModelHarnessProfile(input)
  if (!validation.ok) {
    throw new Error(`CONTRACT_INVALID:model-harness-profile:${validation.issues.join('; ')}`)
  }
  return deepFreeze({
    contract: MODEL_HARNESS_CONTRACT_ID,
    profile_id: input.profile_id,
    version: input.version,
    status: input.status,
    model_match: input.model_match === undefined ? null : input.model_match,
    ...(input.context_policy !== undefined ? { context_policy: input.context_policy } : {}),
    ...(input.tool_policy !== undefined ? { tool_policy: input.tool_policy } : {}),
    ...(input.result_policy !== undefined ? { result_policy: input.result_policy } : {}),
    ...(input.planning_policy !== undefined ? { planning_policy: input.planning_policy } : {}),
    ...(input.retry_hints !== undefined ? { retry_hints: input.retry_hints } : {}),
    ...(input.known_failure_mitigations !== undefined ? { known_failure_mitigations: input.known_failure_mitigations } : {}),
    ...(input.task_role_overrides !== undefined ? { task_role_overrides: input.task_role_overrides } : {}),
    ...(input.evidence_metadata !== undefined ? { evidence_metadata: input.evidence_metadata } : {}),
  })
}
