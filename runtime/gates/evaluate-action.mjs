// SPDX-License-Identifier: MIT
/**
 * Governance V2's single effect gate for real tool, agent, and MCP paths.
 *
 * Adapters may normalize their native input, but they must call this module
 * before execution. Unknown tool/action pairs fail closed. Text returned by a
 * tool is never an authorization source.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateEffect, EFFECTS, REVERSIBILITY } from '../approval/approval-engine.mjs'
import { validateApprovalReceipt } from '../approval/approval-receipt.mjs'
import { loadCapabilityRegistry, resolveToolCapability } from '../approval/capability-registry.mjs'
import { ApprovalAuditLog } from '../approval/approval-audit.mjs'

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REGISTRY_CANDIDATES = [
  path.join(moduleRoot, 'governance', 'generated', 'capability-registry.json'),
  path.join(moduleRoot, 'runtime', 'governance', 'generated', 'capability-registry.json'),
]
const TRUSTED_AUTH_SOURCES = new Set(['SYSTEM_POLICY', 'OWNER_INTENT', 'PROJECT_POLICY', 'TASK_CAPSULE', 'CHANGE_LEASE', 'APPROVAL_RECEIPT'])
const RECEIPT_REQUIRED_EFFECTS = new Set([
  EFFECTS.PUSH,
  EFFECTS.MERGE,
  EFFECTS.PRODUCTION_DEPLOY,
  EFFECTS.EXTERNAL_COMMUNICATION,
  EFFECTS.IRREVERSIBLE_DELETE,
])

const TOOL_ALIASES = Object.freeze({
  read: ['filesystem', 'read'], grep: ['filesystem', 'read'], glob: ['filesystem', 'read'], lsp: ['filesystem', 'read'],
  write: ['filesystem', 'write'], edit: ['filesystem', 'write'], apply_patch: ['filesystem', 'write'],
  task: ['agent', 'delegate'], skill: ['agent', 'delegate'], webfetch: ['network', 'read'], websearch: ['network', 'read'],
})

function clean(value) { return String(value || '').replaceAll('\\', '/') }

function commandDescriptor(command = '') {
  const value = String(command)
  if (/^git\s+status(?:\s+--[a-z-]+(?:=[^\s]+)?)*\s*$/i.test(value.trim())) {
    return { tool: 'git', action: 'status', effect: EFFECTS.LOCAL_READ, reversibility: REVERSIBILITY.FULLY_REVERSIBLE, resource: 'git-working-tree' }
  }
  if (/\bgit\s+push\b/i.test(value)) return { tool: 'git', action: 'push', effect: EFFECTS.PUSH, reversibility: REVERSIBILITY.PARTIALLY_REVERSIBLE, resource: 'git-remote' }
  if (/\bgit\s+merge\b/i.test(value)) return { tool: 'git', action: 'merge', effect: EFFECTS.MERGE, reversibility: REVERSIBILITY.IRREVERSIBLE, resource: 'protected-branch' }
  if (/\bgit\s+commit\b/i.test(value)) return { tool: 'git', action: 'commit', effect: EFFECTS.LOCAL_COMMIT, reversibility: REVERSIBILITY.FULLY_REVERSIBLE, resource: 'git-index' }
  if (/\b(rm|unlink)\s+-rf?\b/i.test(value)) return { tool: 'filesystem', action: 'delete', effect: EFFECTS.IRREVERSIBLE_DELETE, reversibility: REVERSIBILITY.IRREVERSIBLE, resource: value }
  if (/\b(rm|unlink)\b/i.test(value)) return { tool: 'filesystem', action: 'delete', effect: EFFECTS.LOCAL_DELETE, reversibility: REVERSIBILITY.REVERSIBLE_WITH_BACKUP, resource: value }
  if (/\b(node\s+--test|npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|pytest)\b/i.test(value)) return { tool: 'test', action: 'run', effect: EFFECTS.TEST_EXECUTION, reversibility: REVERSIBILITY.FULLY_REVERSIBLE, resource: 'test-run' }
  if (/\b(curl|wget|ssh|nc|telnet)\b/i.test(value)) return { tool: 'network', action: 'read', effect: EFFECTS.NETWORK, reversibility: REVERSIBILITY.FULLY_REVERSIBLE, resource: value }
  return { tool: 'shell', action: 'execute', effect: EFFECTS.LOCAL_EXECUTE, reversibility: REVERSIBILITY.UNKNOWN_REVERSIBILITY, resource: value }
}

function normalizeRequest(input = {}) {
  if (input.command && input.tool === 'bash') return { ...input, ...commandDescriptor(input.command) }
  if (input.effect) return { ...input, resource: clean(input.resource || input.args?.filePath || input.args?.path || input.tool) }
  const alias = TOOL_ALIASES[input.tool]
  if (alias) {
    const [tool, action] = alias
    const effect = tool === 'filesystem' && action === 'read' ? EFFECTS.LOCAL_READ : tool === 'filesystem' ? EFFECTS.LOCAL_WRITE : tool === 'agent' ? EFFECTS.DELEGATE : EFFECTS.NETWORK
    return { ...input, tool, action, effect, reversibility: input.reversibility || REVERSIBILITY.FULLY_REVERSIBLE, resource: clean(input.resource || input.args?.filePath || input.args?.path || input.args?.url || input.tool) }
  }
  if (input.tool === 'bash') return { ...input, ...commandDescriptor(input.args?.command || input.command || '') }
  if (input.tool && input.action) return { ...input, resource: clean(input.resource || input.args?.filePath || input.args?.path || input.tool) }
  return { ...input, effect: 'UNKNOWN_TOOL_EFFECT', resource: clean(input.resource || input.tool || input.action) }
}

function validateCapsule(capsule, request) {
  if (request.effect === EFFECTS.LOCAL_READ && !capsule) return { task_id: 'cold-read', read_scope: ['**'], write_scope: [], forbidden_scope: ['.env', '**/.env', '**/.env.*'], allowed_effects: [EFFECTS.LOCAL_READ] }
  if (!capsule?.task_id) return null
  if (!Array.isArray(capsule.read_scope) || !Array.isArray(capsule.write_scope) || !Array.isArray(capsule.forbidden_scope) || !Array.isArray(capsule.allowed_effects)) return null
  return capsule
}

function capabilityRegistryPath(input) { return input.registryPath || process.env.GOVERNANCE_CAPABILITY_REGISTRY || REGISTRY_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || REGISTRY_CANDIDATES[0] }

function capabilityFor(request, registry) {
  if (request.capabilityKey && registry?.tools?.[request.capabilityKey]) return { allowed: true, key: request.capabilityKey, capability: registry.tools[request.capabilityKey], tool_output: 'UNTRUSTED' }
  const resolved = resolveToolCapability({ tool: request.tool, action: request.action, registry })
  if (resolved.allowed) return resolved
  if (request.effect && registry?.capabilities?.[request.effect]) return { allowed: true, key: request.effect, capability: registry.capabilities[request.effect], tool_output: 'UNTRUSTED' }
  return resolved
}

function block(code, message, request, context = {}) {
  return Object.freeze({ decision_class: 'D_TECHNICAL_BLOCK', code, message, allowed: false, requires_owner: false, v2_enforced: true, tool: request.tool || null, action: request.action || null, effect: request.effect || null, resource: request.resource || null, run_id: context.run_id || null, session_id: context.session_id || null, call_id: context.call_id || null })
}

async function audit(input, result) {
  if (!input.auditPath) return
  await new ApprovalAuditLog(input.auditPath).append({
    event: 'ACTION_DECISION',
    run_id: input.receiptContext?.run_id || process.env.OCAE_RUN_ID || null,
    session_id: input.receiptContext?.session_id || null,
    ...result,
  })
}

function receiptContext(input, request, capability, capsule) {
  const context = input.receiptContext || {}
  return {
    signing_key: input.receiptSigningKey,
    repository: input.repository || capsule.baseline?.repository,
    task_id: capsule.task_id,
    owner_intent_id: input.intent?.intent_id || capsule.owner_intent_id,
    capsule,
    branch: input.branch || capsule.baseline?.branch,
    base_sha: input.base_sha || input.baseSha || capsule.baseline?.base_sha,
    project_id: context.project_id || capsule.project_id || capsule.baseline?.repository,
    runtime: input.runtime || 'unknown',
    run_id: context.run_id || process.env.OCAE_RUN_ID || null,
    session_id: context.session_id || null,
    call_id: context.call_id || null,
    tool: request.tool,
    normalized_action: request.action,
    action: request.action,
    capability: capability.key,
    effect: capability.capability.effect_class || request.effect,
    resource: request.resource,
    requireRuntimeBinding: Boolean(input.receiptStore || input.requireRuntimeReceiptBinding),
  }
}

async function resolveStoredReceipt(input, request, capability, capsule) {
  if (!input.receiptStore) return { receipt: input.receipt || null, fromStore: false, validation: null }
  const options = receiptContext(input, request, capability, capsule)
  if (!options.run_id) return { error: 'RED_BLOCK_RECEIPT_CONTEXT_RUN' }
  const requiresReceipt = RECEIPT_REQUIRED_EFFECTS.has(options.effect)
  if (requiresReceipt && !options.session_id) return { error: 'RED_BLOCK_RECEIPT_CONTEXT_SESSION_REQUIRED' }
  if (requiresReceipt && !options.call_id) return { error: 'RED_BLOCK_RECEIPT_CONTEXT_CALL_ID_REQUIRED' }
  if (!requiresReceipt && !input.receipt) return { receipt: null, fromStore: false, validation: null, options }
  let active
  try { active = await input.receiptStore.listActive() } catch (error) {
    return { error: String(error?.message || '').startsWith('RED_BLOCK_') ? error.message : 'RED_BLOCK_RECEIPT_STORE_UNAVAILABLE' }
  }
  const candidates = active
  if (candidates.length === 0) {
    try {
      const consumed = await input.receiptStore.listConsumed()
      if (consumed.some((marker) => marker?.run_id === options.run_id && (!options.session_id || !marker.session_id || marker.session_id === options.session_id))) {
        return { error: 'RED_BLOCK_RECEIPT_REPLAY', options }
      }
    } catch (error) {
      return { error: String(error?.message || '').startsWith('RED_BLOCK_') ? error.message : 'RED_BLOCK_RECEIPT_STORE_UNAVAILABLE' }
    }
    return { error: requiresReceipt ? 'RED_BLOCK_RECEIPT_MISSING' : null, receipt: input.receipt || null, fromStore: false, validation: null, options }
  }
  let firstFailure = null
  for (const candidate of candidates) {
    const validation = validateApprovalReceipt(candidate, options)
    if (validation.valid) return { receipt: candidate, fromStore: true, validation, options }
    firstFailure ||= validation
  }
  return { error: firstFailure?.code || 'RED_BLOCK_RECEIPT_MISSING', options }
}

export async function evaluateAction(input = {}) {
  const request = normalizeRequest(input)
  let registry
  try { registry = loadCapabilityRegistry(capabilityRegistryPath(input)) } catch (error) { return block('RED_BLOCK_CAPABILITY_REGISTRY_UNAVAILABLE', error.message, request) }
  const capability = capabilityFor(request, registry)
  if (!capability.allowed) return block(capability.code, 'No registered capability exists for this tool/action pair.', request)
  if (input.authorization_source && !TRUSTED_AUTH_SOURCES.has(input.authorization_source.source)) return block('RED_BLOCK_UNTRUSTED_AUTHORIZATION_SOURCE', 'Tool output and prose cannot authorize an effect.', request)
  const capsule = validateCapsule(input.capsule, request)
  if (!capsule) return block('RED_BLOCK_TASK_CAPSULE_MISSING_OR_INVALID', 'A write or external action requires a valid Task Capsule.', request)
  const resolved = await resolveStoredReceipt(input, request, capability, capsule)
  if (resolved.error) {
    const denied = block(resolved.error, 'Approval Receipt was not accepted for this exact runtime action.', request, resolved.options)
    await audit(input, denied)
    return denied
  }
  let receipt = resolved.receipt
  if (receipt && !resolved.validation) {
    const receiptCheck = validateApprovalReceipt(receipt, {
      ...receiptContext(input, request, capability, capsule),
      store: input.receiptStore,
    })
    if (!receiptCheck.valid) {
      const denied = block(receiptCheck.code, 'Approval Receipt validation failed.', request, receiptContext(input, request, capability, capsule))
      await audit(input, denied)
      return denied
    }
  }
  const decision = evaluateEffect({
    intent: input.intent || {}, capsule, effect: capability.capability.effect_class || request.effect, resource: request.resource,
    receipt, lease: input.lease, authorization_source: input.authorization_source, tool_output: input.toolOutput,
    reversibility: request.reversibility || capability.capability.reversibility, experiment: input.experiment,
    restore_available: input.restoreAvailable, preference: input.preference,
  })
  if (decision.allowed && resolved.fromStore) {
    try {
      const consumed = await input.receiptStore.consume(receipt, resolved.options)
      if (!consumed.valid) {
        const denied = block(consumed.code, 'Approval Receipt could not be consumed atomically.', request, resolved.options)
        await audit(input, denied)
        return denied
      }
      receipt = consumed.receipt
    } catch {
      // A concurrent loser may observe the filesystem error after the winner
      // has created the durable marker. Re-read that marker before classifying
      // the failure so the runtime reports replay, never store ambiguity.
      const replay = input.receiptStore.isConsumed?.(receipt?.approval_id)
      const denied = block(replay ? 'RED_BLOCK_RECEIPT_REPLAY' : 'RED_BLOCK_RECEIPT_STORE_UNAVAILABLE', 'Approval Receipt store failed closed.', request, resolved.options)
      await audit(input, denied)
      return denied
    }
  }
  const result = Object.freeze({ ...decision, tool: request.tool, action: request.action, capability_key: capability.key, resource: request.resource, runtime: input.runtime || 'unknown', run_id: resolved.options?.run_id || null, session_id: resolved.options?.session_id || null, call_id: resolved.options?.call_id || null, task_id: capsule.task_id, approval_id: receipt?.approval_id || null, receipt_consumed: Boolean(decision.allowed && resolved.fromStore), v2_enforced: true, legacy_alias_used: false })
  await audit(input, result)
  return result
}

export async function recordActionOutcome({ auditPath, decision, success } = {}) {
  if (!auditPath) return
  await new ApprovalAuditLog(auditPath).append({ event: 'ACTION_OUTCOME', decision, success: Boolean(success) })
}

export { commandDescriptor, normalizeRequest }
