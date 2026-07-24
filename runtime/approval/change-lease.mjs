// SPDX-License-Identifier: MIT
import crypto from 'node:crypto'
import { matchesScope, riskWithin } from './approval-engine.mjs'

export function createChangeLease(input = {}) {
  if (!input.intent?.intent_id || !input.capsule?.task_id) throw new Error('Change lease requires an owner intent and task capsule.')
  if (!Array.isArray(input.allowed_effects) || input.allowed_effects.length === 0) throw new Error('Change lease requires allowed effects.')
  return Object.freeze({
    schema_version: 'governance-v2.change-lease.1',
    lease_id: input.lease_id || `lease-${crypto.randomUUID()}`,
    owner_intent_id: input.intent.intent_id,
    task_id: input.capsule.task_id,
    allowed_effects: [...new Set(input.allowed_effects)].sort(),
    allowed_paths: [...new Set(input.allowed_paths || [])].sort(),
    denied_effects: [...new Set(input.denied_effects || [])].sort(),
    environment: input.environment || 'local',
    repository: input.repository || input.capsule.baseline?.repository || null,
    branch: input.branch || null,
    issued_at: input.issued_at || new Date().toISOString(),
    expires_at: input.expires_at,
    delegation_allowed: input.delegation_allowed !== false,
    delegation_depth: Number.isInteger(input.delegation_depth) ? input.delegation_depth : 2,
    risk_tier: input.risk_tier || input.capsule.risk_tier || 'HIGH_HUMAN_GATE',
    revocation_status: 'ACTIVE',
  })
}

export function delegateAuthorization({ parent, childCapsule } = {}) {
  if (!parent || !childCapsule) return { valid: false, code: 'RED_BLOCK_MISSING_DELEGATION_INPUT' }
  if (parent.revocation_status === 'REVOKED') return { valid: false, code: 'RED_BLOCK_LEASE_REVOKED' }
  if (parent.delegation_allowed !== true || Number(parent.delegation_depth) <= 0) return { valid: false, code: 'RED_BLOCK_DELEGATION_DEPTH' }
  const childScope = childCapsule.write_scope || []
  const parentScope = parent.allowed_paths || []
  const scopeOk = childScope.every((child) => parentScope.some((allowed) => matchesScope(child.replace(/\*\*?$/, 'x'), [allowed]) || child === allowed))
  const effects = childCapsule.allowed_effects || []
  const effectsOk = effects.every((effect) => parent.allowed_effects.includes(effect) && !parent.denied_effects.includes(effect))
  const riskOk = riskWithin(parent.risk_tier || 'HIGH_HUMAN_GATE', childCapsule.risk_tier || 'LOW_LOCAL')
  if (!scopeOk) return { valid: false, code: 'RED_BLOCK_SCOPE_EXPANSION' }
  if (!effectsOk) return { valid: false, code: 'RED_BLOCK_EFFECT_EXPANSION' }
  if (!riskOk) return { valid: false, code: 'RED_BLOCK_RISK_EXPANSION' }
  return {
    valid: true,
    authorization: Object.freeze({
      ...parent,
      lease_id: `${parent.lease_id}:delegated:${childCapsule.task_id}`,
      task_id: childCapsule.task_id,
      allowed_effects: effects,
      allowed_paths: childScope,
      delegation_depth: Number(parent.delegation_depth) - 1,
    }),
  }
}
