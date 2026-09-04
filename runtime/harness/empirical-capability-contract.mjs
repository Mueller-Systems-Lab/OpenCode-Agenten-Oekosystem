// SPDX-License-Identifier: MIT
/**
 * Versioned empirical qualification contract.
 *
 * This module is intentionally data-only. Qualification evidence describes
 * observed operating regions; it is never an authorization source. Raw sample
 * counts are retained and every derived rate/claim is recomputed from them.
 */
import crypto from 'node:crypto'

export const EMPIRICAL_CAPABILITY_CONTRACT = 'ecosystem.empirical-capability.v1'
export const EMPIRICAL_CAPABILITY_SCHEMA_VERSION = 1

export const CAPABILITY_FAMILIES = Object.freeze([
  'MODEL_INTERFACE_CAPABILITIES',
  'PROVIDER_RUNTIME_CAPABILITIES',
  'OPENCODE_WORKSPACE_CAPABILITIES',
  'EMPIRICAL_TOOL_CALL_CAPABILITIES',
  'EMPIRICAL_TOOL_OBSERVATION_CAPABILITIES',
  'TASK_COMPLEXITY_CAPABILITIES',
  'SESSION_CAPABILITIES',
  'EFFECTIVE_AGENT_CAPABILITIES',
])

const FAMILY_SET = new Set(CAPABILITY_FAMILIES)
const IDENTITY_KEYS = Object.freeze([
  'provider', 'model', 'runtime_class', 'runtime_version_if_known',
  'opencode_host_version', 'opencode_workspace_capability_fingerprint',
  'tool_contract_fingerprint', 'observation_contract_fingerprint',
  'qualification_corpus_fingerprint', 'holdout_corpus_fingerprint',
  'harness_fingerprint', 'verifier_version',
])
const METRIC_KEYS = new Set(['sample_count', 'success_count', 'failure_count', 'rate', 'claim'])
const SAFE_ID_RE = /^[a-zA-Z0-9._:/-]+$/u
const FINGERPRINT_RE = /^(?:sha256:)?[a-f0-9]{64}$/u

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function fingerprint(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function deepFreeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze))
  if (isObject(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
  }
  return value
}

function fail(message) {
  throw new Error(`CONTRACT_INVALID:empirical-capability:${message}`)
}

function requireSafeString(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || value.length === 0 || !SAFE_ID_RE.test(value)) fail(`${name} must be a non-empty safe identifier`)
  return value
}

function requireFingerprint(value, name) {
  if (typeof value !== 'string' || !FINGERPRINT_RE.test(value)) fail(`${name} must be a sha256 fingerprint`)
  return value
}

function findUnknownKeys(value, allowed, path = '') {
  if (!isObject(value)) return []
  return Object.keys(value).filter((key) => !allowed.has(key)).map((key) => `${path}${key}`)
}

/** Creates the non-secret identity that binds evidence to one operating path. */
export function createQualificationIdentity(input = {}) {
  const allowed = new Set(IDENTITY_KEYS)
  const unknown = findUnknownKeys(input, allowed)
  if (unknown.length) fail(`unknown identity field(s): ${unknown.join(', ')}`)
  const identity = {
    provider: requireSafeString(input.provider, 'provider'),
    model: requireSafeString(input.model, 'model'),
    runtime_class: requireSafeString(input.runtime_class, 'runtime_class'),
    runtime_version_if_known: input.runtime_version_if_known === null || input.runtime_version_if_known === undefined
      ? null : requireSafeString(input.runtime_version_if_known, 'runtime_version_if_known'),
    opencode_host_version: requireSafeString(input.opencode_host_version, 'opencode_host_version'),
    opencode_workspace_capability_fingerprint: requireFingerprint(input.opencode_workspace_capability_fingerprint, 'opencode_workspace_capability_fingerprint'),
    tool_contract_fingerprint: requireFingerprint(input.tool_contract_fingerprint, 'tool_contract_fingerprint'),
    observation_contract_fingerprint: requireFingerprint(input.observation_contract_fingerprint, 'observation_contract_fingerprint'),
    qualification_corpus_fingerprint: requireFingerprint(input.qualification_corpus_fingerprint, 'qualification_corpus_fingerprint'),
    holdout_corpus_fingerprint: requireFingerprint(input.holdout_corpus_fingerprint, 'holdout_corpus_fingerprint'),
    harness_fingerprint: requireFingerprint(input.harness_fingerprint, 'harness_fingerprint'),
    verifier_version: requireSafeString(input.verifier_version, 'verifier_version'),
  }
  if (identity.qualification_corpus_fingerprint === identity.holdout_corpus_fingerprint) {
    fail('qualification and holdout corpus fingerprints must differ')
  }
  return deepFreeze(identity)
}

/** Raw-count metric. A zero-sample metric has a null rate and no claim. */
export function createCapabilityMetric({ sample_count = 0, success_count = 0, failure_count = null } = {}, threshold = 0.8) {
  if (![sample_count, success_count].every((value) => Number.isInteger(value) && value >= 0)) fail('metric counts must be non-negative integers')
  const failures = failure_count === null ? sample_count - success_count : failure_count
  if (!Number.isInteger(failures) || failures < 0 || success_count > sample_count || failures !== sample_count - success_count) fail('metric counts are inconsistent')
  if (!(typeof threshold === 'number' && threshold > 0 && threshold <= 1)) fail('metric threshold must be in (0, 1]')
  const rate = sample_count === 0 ? null : success_count / sample_count
  return deepFreeze({
    sample_count,
    success_count,
    failure_count: failures,
    rate,
    claim: sample_count > 0 && rate >= threshold,
  })
}

function validateMetric(metric, path) {
  if (!isObject(metric)) fail(`${path} must be an object`)
  const unknown = findUnknownKeys(metric, METRIC_KEYS, `${path}.`)
  if (unknown.length) fail(`unknown metric field(s): ${unknown.join(', ')}`)
  const expected = createCapabilityMetric(metric)
  for (const key of ['sample_count', 'success_count', 'failure_count']) if (metric[key] !== expected[key]) fail(`${path}.${key} is inconsistent`)
  if (metric.rate !== expected.rate || metric.claim !== expected.claim) fail(`${path} derived fields are inconsistent`)
}

/** Build a full capability record with fail-closed schema and fingerprints. */
export function createEmpiricalCapabilityRecord({ identity, capabilities = {}, evidence_status = 'COMPLETE' } = {}) {
  if (!isObject(identity)) fail('identity is required')
  createQualificationIdentity(identity)
  if (!isObject(capabilities)) fail('capabilities must be an object')
  if (!['COMPLETE', 'PARTIAL', 'TOOL_GAP'].includes(evidence_status)) fail('invalid evidence_status')
  for (const family of Object.keys(capabilities)) {
    if (!FAMILY_SET.has(family) || !isObject(capabilities[family])) fail(`unknown capability family: ${family}`)
    for (const [metricName, metric] of Object.entries(capabilities[family])) {
      requireSafeString(metricName, `${family} metric name`)
      validateMetric(metric, `${family}.${metricName}`)
    }
  }
  return deepFreeze({
    contract: EMPIRICAL_CAPABILITY_CONTRACT,
    schema_version: EMPIRICAL_CAPABILITY_SCHEMA_VERSION,
    identity: { ...identity },
    evidence_status,
    capabilities: { ...capabilities },
    record_fingerprint: fingerprint({ contract: EMPIRICAL_CAPABILITY_CONTRACT, schema_version: EMPIRICAL_CAPABILITY_SCHEMA_VERSION, identity, evidence_status, capabilities }),
  })
}

export function deriveCapabilityClaims(record, threshold = 0.8) {
  if (!record || record.contract !== EMPIRICAL_CAPABILITY_CONTRACT) fail('record contract mismatch')
  const claims = {}
  for (const [family, metrics] of Object.entries(record.capabilities || {})) {
    claims[family] = {}
    for (const [name, metric] of Object.entries(metrics)) {
      const derived = createCapabilityMetric(metric, threshold)
      claims[family][name] = derived.sample_count > 0 && derived.rate >= threshold
    }
  }
  return deepFreeze(claims)
}

export function assertQualificationFresh(record, identity) {
  if (!record || !identity) return { fresh: false, code: 'QUALIFICATION_IDENTITY_MISSING' }
  const expected = createQualificationIdentity(identity)
  const actual = record.identity || {}
  const mismatches = IDENTITY_KEYS.filter((key) => actual[key] !== expected[key])
  return mismatches.length === 0
    ? { fresh: true, code: 'QUALIFICATION_FRESH', mismatches: [] }
    : { fresh: false, code: 'QUALIFICATION_STALE_FINGERPRINT', mismatches }
}

export function validateEmpiricalCapabilityRecord(record, { allowForwardCompatible = false } = {}) {
  try {
    if (!isObject(record)) fail('record must be an object')
    const allowed = new Set(['contract', 'schema_version', 'identity', 'evidence_status', 'capabilities', 'record_fingerprint'])
    const unknown = findUnknownKeys(record, allowed)
    if (unknown.length && !allowForwardCompatible) fail(`unknown record field(s): ${unknown.join(', ')}`)
    if (record.contract !== EMPIRICAL_CAPABILITY_CONTRACT || record.schema_version !== EMPIRICAL_CAPABILITY_SCHEMA_VERSION) fail('incompatible schema')
    const rebuilt = createEmpiricalCapabilityRecord(record)
    if (record.record_fingerprint !== rebuilt.record_fingerprint) fail('record fingerprint mismatch')
    return { ok: true, issues: [] }
  } catch (error) {
    return { ok: false, issues: [error instanceof Error ? error.message : String(error)] }
  }
}

export const EMPIRICAL_CAPABILITY_IDENTITY_KEYS = IDENTITY_KEYS
