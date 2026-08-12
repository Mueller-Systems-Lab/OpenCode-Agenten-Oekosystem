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

const TOOL_ALIASES = Object.freeze({
  read: ['filesystem', 'read'], grep: ['filesystem', 'read'], glob: ['filesystem', 'read'], lsp: ['filesystem', 'read'],
  write: ['filesystem', 'write'], edit: ['filesystem', 'write'], apply_patch: ['filesystem', 'write'],
  task: ['agent', 'delegate'], skill: ['agent', 'delegate'], webfetch: ['network', 'read'], websearch: ['network', 'read'],
})

function clean(value) { return String(value || '').replaceAll('\\', '/') }

function commandDescriptor(command = '') {
  const value = String(command)
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

function block(code, message, request) {
  return Object.freeze({ decision_class: 'D_TECHNICAL_BLOCK', code, message, allowed: false, requires_owner: false, v2_enforced: true, tool: request.tool || null, action: request.action || null, effect: request.effect || null, resource: request.resource || null })
}

async function audit(input, result) {
  if (!input.auditPath) return
  await new ApprovalAuditLog(input.auditPath).append({ event: 'ACTION_DECISION', ...result })
}

async function auditEarlyBlock(input, result) {
  try {
    await audit(input, result)
  } catch {
    // An audit failure must preserve the deny; callers must never observe fail-open behavior.
  }
}

export async function evaluateAction(input = {}) {
  const request = normalizeRequest(input)
  let registry
  try { registry = loadCapabilityRegistry(capabilityRegistryPath(input)) } catch (error) { return block('RED_BLOCK_CAPABILITY_REGISTRY_UNAVAILABLE', error.message, request) }
  const capability = capabilityFor(request, registry)
  if (!capability.allowed) return block(capability.code, 'No registered capability exists for this tool/action pair.', request)
  if (input.authorization_source && !TRUSTED_AUTH_SOURCES.has(input.authorization_source.source)) return block('RED_BLOCK_UNTRUSTED_AUTHORIZATION_SOURCE', 'Tool output and prose cannot authorize an effect.', request)
  const capsule = validateCapsule(input.capsule, request)
  if (!capsule) {
    const result = Object.freeze({
      ...block('RED_BLOCK_TASK_CAPSULE_MISSING_OR_INVALID', 'A write or external action requires a valid Task Capsule.', request),
      runtime: input.runtime || 'unknown',
      task_id: null,
      v2_enforced: true,
      legacy_alias_used: false,
    })
    await auditEarlyBlock(input, result)
    return result
  }
  if (input.receipt) {
    const receiptCheck = validateApprovalReceipt(input.receipt, {
      signing_key: input.receiptSigningKey,
      repository: input.repository || capsule.baseline?.repository,
      store: input.receiptStore,
      task_id: capsule.task_id,
      owner_intent_id: input.intent?.intent_id || capsule.owner_intent_id,
      capsule,
      branch: input.branch || capsule.baseline?.branch,
      base_sha: input.base_sha || input.baseSha || capsule.baseline?.base_sha,
    })
    if (!receiptCheck.valid) return block(receiptCheck.code, 'Approval Receipt validation failed.', request)
  }
  const decision = evaluateEffect({
    intent: input.intent || {}, capsule, effect: capability.capability.effect_class || request.effect, resource: request.resource,
    receipt: input.receipt, lease: input.lease, authorization_source: input.authorization_source, tool_output: input.toolOutput,
    reversibility: request.reversibility || capability.capability.reversibility, experiment: input.experiment,
    restore_available: input.restoreAvailable, preference: input.preference,
  })
  const result = Object.freeze({ ...decision, tool: request.tool, action: request.action, capability_key: capability.key, resource: request.resource, runtime: input.runtime || 'unknown', task_id: capsule.task_id, v2_enforced: true, legacy_alias_used: false })
  await audit(input, result)
  return result
}

export async function recordActionOutcome({ auditPath, decision, success, output = null } = {}) {
  if (!auditPath) return
  await new ApprovalAuditLog(auditPath).append({ event: 'ACTION_OUTCOME', decision, success: Boolean(success), output: typeof output === 'string' ? output.slice(0, 1000) : output })
}

export { commandDescriptor, normalizeRequest }
