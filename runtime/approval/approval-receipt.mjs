// SPDX-License-Identifier: MIT
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value ?? null)
}

function sign(receipt, signingKey) {
  const payload = { ...receipt }
  delete payload.signature
  return `hmac-sha256:${crypto.createHmac('sha256', signingKey).update(stable(payload)).digest('hex')}`
}

function capsuleHash(capsule) {
  return `sha256:${crypto.createHash('sha256').update(stable(capsule || {})).digest('hex')}`
}

export function createApprovalReceipt(input = {}) {
  if (!input.signing_key) throw new Error('A signing_key is required to issue an approval receipt.')
  const issuedAt = input.issued_at || new Date().toISOString()
  const expiresAt = input.expires_at || new Date(Date.parse(issuedAt) + 60 * 60 * 1000).toISOString()
  const receipt = {
    schema_version: 'governance-v2.approval-receipt.1',
    approval_id: input.approval_id || crypto.randomUUID(),
    owner_intent_id: input.owner_intent_id || input.intent?.intent_id,
    task_id: input.task_id || input.capsule?.task_id,
    task_capsule_hash: input.task_capsule_hash || capsuleHash(input.capsule),
    effect_classes: [...new Set(input.effect_classes || [])].sort(),
    resource_scope: [...new Set(input.resource_scope || [])].sort(),
    allowed_actions: [...new Set(input.allowed_actions || [])].sort(),
    denied_actions: [...new Set(input.denied_actions || [])].sort(),
    environment: input.environment || 'local',
    repository: input.repository || input.capsule?.baseline?.repository || null,
    branch: input.branch || input.capsule?.baseline?.branch || 'DETACHED_HEAD',
    base_sha: input.base_sha || input.capsule?.baseline?.base_sha || null,
    issued_at: issuedAt,
    expires_at: expiresAt,
    max_uses: Number.isInteger(input.max_uses) ? input.max_uses : 1,
    uses: 0,
    delegation_allowed: input.delegation_allowed === true,
    delegation_depth: Number.isInteger(input.delegation_depth) ? input.delegation_depth : 0,
    revocation_status: 'ACTIVE',
    nonce: input.nonce || crypto.randomBytes(16).toString('hex'),
    status: 'APPROVED',
  }
  if (!receipt.owner_intent_id || !receipt.task_id || receipt.effect_classes.length === 0) throw new Error('Approval receipt requires intent, task, and effect classes.')
  return Object.freeze({ ...receipt, signature: sign(receipt, input.signing_key) })
}

export function validateApprovalReceipt(receipt, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
  if (!receipt || typeof receipt !== 'object') return invalid('RED_BLOCK_RECEIPT_MISSING')
  if (!receipt.signature || !options.signing_key) return invalid('RED_BLOCK_RECEIPT_UNSIGNED')
  if (receipt.revocation_status === 'REVOKED') return invalid('RED_BLOCK_RECEIPT_REVOKED')
  if (!receipt.expires_at || Date.parse(receipt.expires_at) <= now.getTime()) return invalid('RED_BLOCK_RECEIPT_EXPIRED')
  if (receipt.repository && options.repository && receipt.repository !== options.repository) return invalid('RED_BLOCK_CROSS_REPOSITORY')
  if (Number(receipt.uses || 0) >= Number(receipt.max_uses || 1)) return invalid('RED_BLOCK_RECEIPT_REPLAY')
  const expected = sign(receipt, options.signing_key)
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(receipt.signature)))) return invalid('RED_BLOCK_RECEIPT_TAMPERED')
  if (options.store && receipt.approval_id && options.store.isRevoked?.(receipt.approval_id)) return invalid('RED_BLOCK_RECEIPT_REVOKED')
  return { valid: true, code: 'APPROVED', receipt }
}

function invalid(code) {
  return { valid: false, code }
}

export async function revokeApprovalReceipt(approvalId, store) {
  if (!store || typeof store.revoke !== 'function') throw new Error('A receipt store is required for revocation.')
  return store.revoke(approvalId)
}

export function consumeApprovalReceipt(receipt, { signing_key, store, now } = {}) {
  const validation = validateApprovalReceipt(receipt, { signing_key, store, now })
  if (!validation.valid) return validation
  return { valid: true, code: 'CONSUMED', receipt: Object.freeze({ ...receipt, uses: Number(receipt.uses || 0) + 1, status: 'CONSUMED' }) }
}

export class ApprovalReceiptStore {
  constructor(directory) {
    this.directory = path.resolve(directory)
    this.revoked = new Set()
  }

  async save(receipt) {
    await fs.mkdir(this.directory, { recursive: true })
    await fs.writeFile(path.join(this.directory, `${receipt.approval_id}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
  }

  async get(approvalId) {
    return JSON.parse(await fs.readFile(path.join(this.directory, `${approvalId}.json`), 'utf8'))
  }

  async revoke(approvalId) {
    this.revoked.add(approvalId)
    await fs.mkdir(this.directory, { recursive: true })
    await fs.writeFile(path.join(this.directory, `${approvalId}.revoked`), 'REVOKED\n', { mode: 0o600 })
  }

  isRevoked(approvalId) {
    return this.revoked.has(approvalId) || existsSync(path.join(this.directory, `${approvalId}.revoked`))
  }
}
