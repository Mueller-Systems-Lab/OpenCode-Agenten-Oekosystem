// SPDX-License-Identifier: MIT
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const AUDIT_FIELDS = new Set([
  'event_id', 'timestamp', 'event', 'run_id', 'session_id', 'call_id', 'tool',
  'normalized_action', 'decision', 'classification', 'policy_id', 'resource_fingerprint',
  'effect', 'exit_status_class', 'duration_ms', 'receipt_fingerprint', 'success',
])

function fingerprint(value) {
  if (value === null || value === undefined || value === '') return null
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`
}

function classificationFor(decision) {
  if (decision?.allowed) return 'VERIFIED_IN_SCOPE'
  if (decision?.requires_owner) return 'NEEDS_REVIEW'
  return 'RED_BLOCK'
}

export function toAuditEvidence(event = {}) {
  const decision = event.decision || event
  const record = {
    event_id: event.event_id || crypto.randomUUID(),
    timestamp: event.timestamp || new Date().toISOString(),
    event: event.event || 'ACTION_DECISION',
    run_id: event.run_id || decision.run_id || null,
    session_id: event.session_id || decision.session_id || null,
    call_id: event.call_id || decision.call_id || null,
    tool: decision.tool || event.tool || null,
    normalized_action: decision.action || decision.normalized_action || event.normalized_action || null,
    decision: decision.allowed === true ? 'ALLOW' : 'BLOCK',
    classification: event.classification || classificationFor(decision),
    policy_id: decision.capability_key || event.policy_id || null,
    resource_fingerprint: fingerprint(decision.resource || event.resource),
    effect: decision.effect || event.effect || null,
    exit_status_class: event.exit_status_class || (event.success === true ? 'SUCCESS' : event.success === false ? 'FAILURE' : 'NOT_EXECUTED'),
    duration_ms: Number.isFinite(event.duration_ms) ? event.duration_ms : null,
    receipt_fingerprint: fingerprint(decision.approval_id || event.approval_id),
  }
  if (event.event === 'ACTION_OUTCOME') record.success = Boolean(event.success)
  return Object.fromEntries(Object.entries(record).filter(([key]) => AUDIT_FIELDS.has(key)))
}

export class ApprovalAuditLog {
  constructor(filePath) {
    this.filePath = path.resolve(filePath)
  }

  async append(event) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    await fs.appendFile(this.filePath, `${JSON.stringify(toAuditEvidence(event))}\n`, { mode: 0o600 })
    await fs.chmod(this.filePath, 0o600)
  }

  async read() {
    try {
      const text = await fs.readFile(this.filePath, 'utf8')
      return text.trim() ? text.trim().split('\n').map((line) => JSON.parse(line)) : []
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }
}
