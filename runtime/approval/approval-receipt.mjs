// SPDX-License-Identifier: MIT
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { constants as fsConstants, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

const RECEIPT_FIELDS = new Set([
  'schema_version', 'approval_id', 'owner_intent_id', 'task_id', 'task_capsule_hash',
  'project_id', 'runtime', 'run_id', 'session_id', 'call_id', 'tool', 'normalized_action',
  'capability', 'effect', 'resource', 'scope', 'effect_classes', 'resource_scope',
  'allowed_actions', 'denied_actions', 'environment', 'repository', 'branch', 'base_sha',
  'issued_at', 'expires_at', 'max_uses', 'uses', 'single_use', 'delegation_allowed',
  'delegation_depth', 'revocation_status', 'nonce', 'status', 'approval_authority',
  'integrity_proof', 'signature',
])
const APPROVAL_AUTHORITIES = new Set(['OWNER_INTENT', 'APPROVAL_AUTHORITY', 'SYSTEM_POLICY'])
const APPROVAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/
const NOFOLLOW = fsConstants.O_NOFOLLOW || 0x20000
const LOCK_RETRIES = 80
const LOCK_DELAY_MS = 10

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

export function isSafeApprovalId(approvalId) {
  return typeof approvalId === 'string' && APPROVAL_ID_PATTERN.test(approvalId)
}

function assertApprovalId(approvalId) {
  if (!isSafeApprovalId(approvalId)) throw new Error('RED_BLOCK_RECEIPT_ID_INVALID')
  return approvalId
}

export function createApprovalReceipt(input = {}) {
  if (!input.signing_key) throw new Error('A signing_key is required to issue an approval receipt.')
  const approvalId = input.approval_id || crypto.randomUUID()
  assertApprovalId(approvalId)
  const issuedAt = input.issued_at || new Date().toISOString()
  const expiresAt = input.expires_at || new Date(Date.parse(issuedAt) + 60 * 60 * 1000).toISOString()
  const effectClasses = [...new Set(input.effect_classes || [])].sort()
  const resourceScope = [...new Set(input.resource_scope || input.scope || [])].sort()
  const maxUses = Number.isInteger(input.max_uses) ? input.max_uses : 1
  const receipt = {
    schema_version: 'governance-v2.approval-receipt.2',
    approval_id: approvalId,
    owner_intent_id: input.owner_intent_id || input.intent?.intent_id,
    task_id: input.task_id || input.capsule?.task_id,
    task_capsule_hash: input.task_capsule_hash || capsuleHash(input.capsule),
    project_id: input.project_id || input.capsule?.project_id || input.repository || input.capsule?.baseline?.repository || null,
    runtime: input.runtime || null,
    run_id: input.run_id || null,
    session_id: input.session_id || null,
    call_id: input.call_id || null,
    tool: input.tool || null,
    normalized_action: input.normalized_action || input.action || null,
    capability: input.capability || null,
    effect: input.effect || effectClasses[0] || null,
    resource: input.resource || resourceScope[0] || null,
    scope: [...new Set(input.scope || resourceScope)].sort(),
    effect_classes: effectClasses,
    resource_scope: resourceScope,
    allowed_actions: [...new Set(input.allowed_actions || [])].sort(),
    denied_actions: [...new Set(input.denied_actions || [])].sort(),
    environment: input.environment || 'local',
    repository: input.repository || input.capsule?.baseline?.repository || null,
    branch: input.branch || input.capsule?.baseline?.branch || 'DETACHED_HEAD',
    base_sha: input.base_sha || input.capsule?.baseline?.base_sha || null,
    issued_at: issuedAt,
    expires_at: expiresAt,
    max_uses: maxUses,
    uses: 0,
    single_use: input.single_use === undefined ? maxUses === 1 : input.single_use === true,
    delegation_allowed: input.delegation_allowed === true,
    delegation_depth: Number.isInteger(input.delegation_depth) ? input.delegation_depth : 0,
    revocation_status: 'ACTIVE',
    nonce: input.nonce || crypto.randomBytes(16).toString('hex'),
    status: 'APPROVED',
    approval_authority: input.approval_authority || 'OWNER_INTENT',
    integrity_proof: 'hmac-sha256',
  }
  if (!receipt.owner_intent_id || !receipt.task_id || receipt.effect_classes.length === 0) throw new Error('Approval receipt requires intent, task, and effect classes.')
  return Object.freeze({ ...receipt, signature: sign(receipt, input.signing_key) })
}

export function validateApprovalReceipt(receipt, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return invalid('RED_BLOCK_RECEIPT_MISSING')
  const unknown = Object.keys(receipt).filter((key) => !RECEIPT_FIELDS.has(key))
  if (unknown.length > 0) return invalid('RED_BLOCK_RECEIPT_UNKNOWN_FIELD')
  if (!isSafeApprovalId(receipt.approval_id)) return invalid('RED_BLOCK_RECEIPT_ID_INVALID')
  if (!receipt.signature || !options.signing_key) return invalid('RED_BLOCK_RECEIPT_UNSIGNED')
  if (receipt.revocation_status === 'REVOKED') return invalid('RED_BLOCK_RECEIPT_REVOKED')
  if (!receipt.expires_at || Date.parse(receipt.expires_at) <= now.getTime()) return invalid('RED_BLOCK_RECEIPT_EXPIRED')
  if (receipt.repository && options.repository && receipt.repository !== options.repository) return invalid('RED_BLOCK_CROSS_REPOSITORY')
  if (Number(receipt.uses || 0) >= Number(receipt.max_uses || 1)) return invalid('RED_BLOCK_RECEIPT_REPLAY')
  const expected = sign(receipt, options.signing_key)
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(String(receipt.signature))
  if (expectedBytes.length !== actualBytes.length || !crypto.timingSafeEqual(expectedBytes, actualBytes)) return invalid('RED_BLOCK_RECEIPT_TAMPERED')
  if (options.task_id && receipt.task_id !== options.task_id) return invalid('RED_BLOCK_RECEIPT_CONTEXT_TASK')
  if (options.owner_intent_id && receipt.owner_intent_id !== options.owner_intent_id) return invalid('RED_BLOCK_RECEIPT_CONTEXT_INTENT')
  if (options.capsule && receipt.task_capsule_hash !== capsuleHash(options.capsule)) return invalid('RED_BLOCK_RECEIPT_CONTEXT_CAPSULE')
  if (options.branch && receipt.branch !== options.branch) return invalid('RED_BLOCK_RECEIPT_CONTEXT_BRANCH')
  if (options.base_sha && receipt.base_sha !== options.base_sha) return invalid('RED_BLOCK_RECEIPT_CONTEXT_BASE_SHA')
  if (options.store && receipt.approval_id && options.store.isRevoked?.(receipt.approval_id)) return invalid('RED_BLOCK_RECEIPT_REVOKED')
  if (options.store && receipt.approval_id && options.store.isConsumed?.(receipt.approval_id)) return invalid('RED_BLOCK_RECEIPT_REPLAY')
  if (options.requireRuntimeBinding) {
    const required = [
      'project_id', 'runtime', 'run_id', 'session_id', 'call_id', 'tool', 'normalized_action',
      'capability', 'effect', 'resource', 'scope', 'effect_classes', 'resource_scope',
      'approval_authority', 'integrity_proof', 'nonce', 'issued_at', 'expires_at',
    ]
    if (required.some((key) => receipt[key] === null || receipt[key] === undefined || receipt[key] === '' || (Array.isArray(receipt[key]) && receipt[key].length === 0))) return invalid('RED_BLOCK_RECEIPT_CONTEXT_MISSING')
    if (receipt.single_use !== true || receipt.max_uses !== 1) return invalid('RED_BLOCK_RECEIPT_NOT_SINGLE_USE')
    if (!APPROVAL_AUTHORITIES.has(receipt.approval_authority)) return invalid('RED_BLOCK_RECEIPT_AUTHORITY')
    for (const key of ['project_id', 'runtime', 'run_id', 'session_id', 'call_id', 'tool', 'capability', 'effect', 'resource']) {
      if (options[key] !== undefined && options[key] !== null && receipt[key] !== options[key]) {
        const codeKey = key === 'project_id' ? 'PROJECT' : key === 'run_id' ? 'RUN' : key === 'session_id' ? 'SESSION' : key === 'call_id' ? 'CALL_ID' : key.toUpperCase()
        return invalid(`RED_BLOCK_RECEIPT_CONTEXT_${codeKey}`)
      }
    }
    if (options.resource && (!Array.isArray(receipt.scope) || !receipt.scope.includes(options.resource) || !receipt.resource_scope.includes(options.resource))) return invalid('RED_BLOCK_RECEIPT_CONTEXT_SCOPE')
    if (receipt.effect !== receipt.effect_classes[0] || receipt.resource !== receipt.resource_scope[0]) return invalid('RED_BLOCK_RECEIPT_CONTEXT_BINDING')
    if (options.action && (!receipt.allowed_actions.includes(options.action) || receipt.normalized_action !== options.action)) return invalid('RED_BLOCK_RECEIPT_CONTEXT_ACTION')
  }
  return { valid: true, code: 'APPROVED', receipt }
}

function invalid(code) {
  return { valid: false, code }
}

export function readSigningKeyFileSync(keyPath) {
  if (!keyPath || typeof keyPath !== 'string') return null
  try {
    const stat = lstatSync(keyPath)
    const mode = stat.mode & 0o777
    const owner = typeof process.getuid === 'function' ? process.getuid() : stat.uid
    if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== owner || mode !== 0o600 || stat.size < 32) return null
    const key = readFileSync(keyPath, 'utf8').trim()
    return key.length >= 32 ? key : null
  } catch {
    return null
  }
}

export async function revokeApprovalReceipt(approvalId, store) {
  assertApprovalId(approvalId)
  if (!store || typeof store.revoke !== 'function') throw new Error('A receipt store is required for revocation.')
  return store.revoke(approvalId)
}

export function consumeApprovalReceipt(receipt, { signing_key, store, now, ...context } = {}) {
  const validation = validateApprovalReceipt(receipt, { signing_key, store, now, ...context })
  if (!validation.valid) return validation
  return { valid: true, code: 'CONSUMED', receipt: Object.freeze({ ...receipt, uses: Number(receipt.uses || 0) + 1, status: 'CONSUMED' }) }
}

export class ApprovalReceiptStore {
  constructor(directory) {
    if (!directory || typeof directory !== 'string') throw new Error('Receipt store directory is required.')
    if (String(directory).split(path.sep).includes('..')) throw new Error('RED_BLOCK_RECEIPT_PATH_ESCAPE')
    this.directory = path.resolve(directory)
  }

  async assertDirectory() {
    await assertNoSymlinkComponents(this.directory)
    try {
      const stat = await fs.lstat(this.directory)
      if (stat.isSymbolicLink()) throw new Error('RED_BLOCK_RECEIPT_STORE_SYMLINK')
      if (!stat.isDirectory()) throw new Error('RED_BLOCK_RECEIPT_STORE_NOT_DIRECTORY')
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
  }

  activePath(approvalId) { return path.join(this.directory, `${assertApprovalId(approvalId)}.json`) }
  consumedPath(approvalId) { return path.join(this.directory, `${assertApprovalId(approvalId)}.consumed`) }
  revokedPath(approvalId) { return path.join(this.directory, `${assertApprovalId(approvalId)}.revoked`) }
  lockPath(approvalId) { return path.join(this.directory, `${assertApprovalId(approvalId)}.lock`) }

  isConsumed(approvalId) { return markerExists(this.consumedPath(approvalId)) }
  isRevoked(approvalId) { return markerExists(this.revokedPath(approvalId)) }

  async save(receipt) {
    assertApprovalId(receipt?.approval_id)
    await this.ensureDirectory()
    await assertAbsentOrRegular(this.activePath(receipt.approval_id))
    await fs.writeFile(this.activePath(receipt.approval_id), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await fs.chmod(this.activePath(receipt.approval_id), 0o600)
  }

  async get(approvalId) {
    await this.assertDirectory()
    return readJsonRegular(this.activePath(approvalId))
  }

  async listActive() {
    await this.assertDirectory()
    let entries
    try { entries = await fs.readdir(this.directory, { withFileTypes: true }) } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const receipts = []
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.json'))) {
      const id = entry.name.slice(0, -5)
      assertApprovalId(id)
      try { receipts.push(await readJsonRegular(path.join(this.directory, entry.name))) } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
    }
    return receipts
  }

  async listConsumed() {
    await this.assertDirectory()
    let entries
    try { entries = await fs.readdir(this.directory, { withFileTypes: true }) } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const consumed = []
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.consumed'))) {
      const id = entry.name.slice(0, -9)
      assertApprovalId(id)
      consumed.push(await readJsonRegular(path.join(this.directory, entry.name)))
    }
    return consumed
  }

  async consume(receipt, options = {}) {
    assertApprovalId(receipt?.approval_id)
    await this.ensureDirectory()
    const release = await acquireLock(this.lockPath(receipt.approval_id))
    try {
      if (this.isRevoked(receipt.approval_id)) return invalid('RED_BLOCK_RECEIPT_REVOKED')
      if (this.isConsumed(receipt.approval_id)) return invalid('RED_BLOCK_RECEIPT_REPLAY')
      const validation = validateApprovalReceipt(receipt, { ...options, store: this })
      if (!validation.valid) return validation
      const marker = this.consumedPath(receipt.approval_id)
      const handle = await fs.open(marker, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify({
          approval_id: receipt.approval_id,
          consumed_at: new Date().toISOString(),
          run_id: receipt.run_id || null,
          session_id: receipt.session_id || null,
          call_id: receipt.call_id || null,
          nonce_fingerprint: capsuleHash({ nonce: receipt.nonce }).slice(0, 24),
        })}\n`)
      } finally {
        await handle.close()
      }
      const active = this.activePath(receipt.approval_id)
      const stat = await fs.lstat(active).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (!stat) return invalid('RED_BLOCK_RECEIPT_STORE_UNAVAILABLE')
      if (stat.isSymbolicLink()) return invalid('RED_BLOCK_RECEIPT_SYMLINK')
      if (!stat.isFile()) return invalid('RED_BLOCK_RECEIPT_NOT_REGULAR_FILE')
      await fs.unlink(active)
      return { valid: true, code: 'CONSUMED', receipt: Object.freeze({ ...receipt, uses: Number(receipt.uses || 0) + 1, status: 'CONSUMED' }) }
    } catch (error) {
      if (error.code === 'EEXIST' && this.isConsumed(receipt.approval_id)) return invalid('RED_BLOCK_RECEIPT_REPLAY')
      throw error
    } finally {
      await release()
    }
  }

  async revoke(approvalId) {
    assertApprovalId(approvalId)
    await this.ensureDirectory()
    const release = await acquireLock(this.lockPath(approvalId))
    try {
      const revoked = this.revokedPath(approvalId)
      const existing = await fs.lstat(revoked).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (existing) {
        if (existing.isSymbolicLink()) throw new Error('RED_BLOCK_RECEIPT_REVOKE_SYMLINK')
        if (!existing.isFile()) throw new Error('RED_BLOCK_RECEIPT_REVOKE_NOT_REGULAR_FILE')
        return { revoked: true, approval_id: approvalId, idempotent: true }
      }
      const handle = await fs.open(revoked, 'wx', 0o600)
      await handle.writeFile('REVOKED\n')
      await handle.close()
      await fs.chmod(revoked, 0o600)
      return { revoked: true, approval_id: approvalId, idempotent: false }
    } finally {
      await release()
    }
  }

  async ensureDirectory() {
    await this.assertDirectory()
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.assertDirectory()
  }
}

function markerExists(filePath) {
  try {
    lstatSync(filePath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    return true
  }
}

async function assertNoSymlinkComponents(absolutePath) {
  const parsed = path.parse(path.resolve(absolutePath))
  let current = parsed.root
  const rest = path.relative(parsed.root, path.resolve(absolutePath)).split(path.sep).filter(Boolean)
  for (const segment of rest) {
    current = path.join(current, segment)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) throw new Error('RED_BLOCK_RECEIPT_PATH_SYMLINK')
    } catch (error) {
      if (error.code === 'ENOENT') break
      throw error
    }
  }
}

async function assertAbsentOrRegular(filePath) {
  const stat = await fs.lstat(filePath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!stat) return
  if (stat.isSymbolicLink()) throw new Error('RED_BLOCK_RECEIPT_SYMLINK')
  if (!stat.isFile()) throw new Error('RED_BLOCK_RECEIPT_NOT_REGULAR_FILE')
  throw new Error('RED_BLOCK_RECEIPT_EXISTS')
}

async function readJsonRegular(filePath) {
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('RED_BLOCK_RECEIPT_NOT_REGULAR_FILE')
    return JSON.parse(await handle.readFile('utf8'))
  } catch (error) {
    if (error.code === 'ELOOP') throw new Error('RED_BLOCK_RECEIPT_SYMLINK')
    throw error
  } finally {
    await handle.close()
  }
}

async function acquireLock(lockPath) {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx', 0o600)
      await handle.writeFile(`${process.pid}\n`)
      await handle.close()
      return async () => { await fs.rm(lockPath, { force: true }).catch(() => {}) }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      await new Promise((resolve) => setTimeout(resolve, LOCK_DELAY_MS))
    }
  }
  throw new Error('RED_BLOCK_RECEIPT_LOCK_UNAVAILABLE')
}
