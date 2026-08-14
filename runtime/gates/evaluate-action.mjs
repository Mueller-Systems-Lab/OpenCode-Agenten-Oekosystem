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
import { evaluateEffect, EFFECTS, REVERSIBILITY, matchesScope } from '../approval/approval-engine.mjs'
import { validateApprovalReceipt } from '../approval/approval-receipt.mjs'
import { loadCapabilityRegistry, resolveToolCapability } from '../approval/capability-registry.mjs'
import { ApprovalAuditLog } from '../approval/approval-audit.mjs'
import { COMMAND_EFFECT_CLASSES, classifyCommand } from './command-effect-classifier.mjs'

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REGISTRY_CANDIDATES = [
  path.join(moduleRoot, 'governance', 'generated', 'capability-registry.json'),
  path.join(moduleRoot, 'runtime', 'governance', 'generated', 'capability-registry.json'),
]
const TRUSTED_AUTH_SOURCES = new Set(['SYSTEM_POLICY', 'OWNER_INTENT', 'PROJECT_POLICY', 'TASK_CAPSULE', 'CHANGE_LEASE', 'APPROVAL_RECEIPT'])

const TOOL_ALIASES = Object.freeze({
  read: ['filesystem', 'read'], grep: ['filesystem', 'read'], glob: ['filesystem', 'read'], lsp: ['filesystem', 'read'],
  write: ['filesystem', 'write'], edit: ['filesystem', 'write'], apply_patch: ['filesystem', 'write'],
  task: ['agent', 'delegate'], skill: ['filesystem', 'read'], webfetch: ['network', 'read'], websearch: ['network', 'read'],
})
const OPENCODE_STATE_TOOLS = new Set(['todo', 'todowrite', 'todoread'])

function clean(value) { return String(value || '').replaceAll('\\', '/') }

function commandDescriptor(command = '', shell = 'auto') {
  const classification = classifyCommand(command, { shell })
  return {
    tool: classification.tool,
    action: classification.action,
    effect: classification.governance_effect,
    reversibility: classification.reversibility,
    resource: classification.resource,
    command_effect_class: classification.effect_class,
    command_classification: classification,
    command_paths: classification.paths,
  }
}

function normalizeRequest(input = {}) {
  if (input.command && ['bash', 'shell', 'powershell', 'pwsh', 'cmd', 'cmd.exe'].includes(String(input.tool || '').toLowerCase())) {
    return { ...input, ...commandDescriptor(input.command, String(input.shell || input.tool || 'auto').toLowerCase()) }
  }
  if (input.effect) return { ...input, resource: clean(input.resource || input.args?.filePath || input.args?.path || input.tool) }
  if (OPENCODE_STATE_TOOLS.has(input.tool)) {
    return {
      ...input,
      tool: 'opencode',
      action: 'todo',
      effect: EFFECTS.LOCAL_STATE,
      reversibility: REVERSIBILITY.FULLY_REVERSIBLE,
      resource: 'opencode://todo',
      source_tool: input.tool,
    }
  }
  const alias = TOOL_ALIASES[input.tool]
  if (alias) {
    const [tool, action] = alias
    const effect = tool === 'filesystem' && action === 'read' ? EFFECTS.LOCAL_READ : tool === 'filesystem' ? EFFECTS.LOCAL_WRITE : tool === 'agent' ? EFFECTS.DELEGATE : EFFECTS.NETWORK
    const rawResource = clean(input.resource || input.args?.filePath || input.args?.path || input.args?.url || input.args?.name || input.tool)
    const resource = effect === EFFECTS.NETWORK ? `network://read/${rawResource}` : rawResource
    return { ...input, tool, action, effect, reversibility: input.reversibility || REVERSIBILITY.FULLY_REVERSIBLE, resource }
  }
  if (['bash', 'shell', 'powershell', 'pwsh', 'cmd', 'cmd.exe'].includes(String(input.tool || '').toLowerCase())) return { ...input, ...commandDescriptor(input.args?.command || input.command || '', String(input.shell || input.tool || 'auto').toLowerCase()) }
  if (input.tool === 'git' && input.action && !input.effect && !input.capabilityKey) return { ...input, ...commandDescriptor(['git', input.action, ...(Array.isArray(input.args) ? input.args : [])].join(' ')) }
  if (input.tool && input.action) return { ...input, resource: clean(input.resource || input.args?.filePath || input.args?.path || input.tool) }
  return { ...input, effect: 'UNKNOWN_TOOL_EFFECT', resource: clean(input.resource || input.tool || input.action) }
}

function validateCapsule(capsule, request) {
  if (request.effect === EFFECTS.LOCAL_READ && !capsule) return { task_id: 'cold-read', read_scope: ['**'], write_scope: [], forbidden_scope: ['.env', '**/.env', '**/.env.*'], allowed_effects: [EFFECTS.LOCAL_READ] }
  if (request.effect === EFFECTS.LOCAL_STATE && !capsule) return { task_id: 'cold-opencode-state', read_scope: [], write_scope: [], forbidden_scope: ['.env', '**/.env', '**/.env.*'], allowed_effects: [EFFECTS.LOCAL_STATE] }
  if (request.effect === EFFECTS.DELEGATE && !capsule && readOnlyDelegation(request)) return { task_id: 'cold-delegate', read_scope: ['**'], write_scope: [], external_effect_scope: [], forbidden_scope: ['.env', '**/.env', '**/.env.*', '.git/**', '.agent-governance/**'], allowed_effects: [EFFECTS.DELEGATE] }
  if (!capsule?.task_id) return null
  if (!Array.isArray(capsule.read_scope) || !Array.isArray(capsule.write_scope) || !Array.isArray(capsule.forbidden_scope) || !Array.isArray(capsule.allowed_effects)) return null
  return capsule
}

function readOnlyDelegation(request) {
  const child = request.childCapsule || request.child_capability || null
  if (!child) return true
  const effects = Array.isArray(child.allowed_effects) ? child.allowed_effects : [EFFECTS.LOCAL_READ]
  return effects.every((effect) => [EFFECTS.LOCAL_READ, EFFECTS.NETWORK, EFFECTS.DELEGATE].includes(effect)) && (child.write_scope || []).length === 0
}

function scopeSubset(childScope = [], parentScope = []) {
  return childScope.every((child) => parentScope.some((parent) => child === parent || parent === '**' || matchesScope(child.replace(/\*\*?/g, 'scope'), [parent])))
}

function delegationBoundary(input, capsule, request) {
  if (request.effect !== EFFECTS.DELEGATE || !input.childCapsule) return null
  const child = input.childCapsule
  const childEffects = Array.isArray(child.allowed_effects) ? child.allowed_effects : []
  const parentEffects = Array.isArray(capsule.allowed_effects) ? capsule.allowed_effects : []
  if (!childEffects.every((effect) => parentEffects.includes(effect))) return block('RED_BLOCK_EFFECT_EXPANSION', 'Delegated capability exceeds the parent effect ceiling.', request)
  if (!scopeSubset(child.write_scope || [], capsule.write_scope || [])) return block('RED_BLOCK_SCOPE_EXPANSION', 'Delegated write scope exceeds the parent task scope.', request)
  if (!scopeSubset(child.read_scope || [], capsule.read_scope || [])) return block('RED_BLOCK_READ_SCOPE_EXPANSION', 'Delegated read scope exceeds the parent task scope.', request)
  if (!(capsule.forbidden_scope || []).every((entry) => (child.forbidden_scope || []).includes(entry))) return block('RED_BLOCK_FORBIDDEN_SCOPE_NARROWING', 'Delegation cannot remove a parent forbidden scope.', request)
  if (input.targetRoot && child.target_root && path.resolve(child.target_root) !== path.resolve(input.targetRoot)) return block('RED_BLOCK_TARGET_ROOT_EXPANSION', 'Delegation cannot change the target root.', request)
  return null
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

function targetRootBoundary(request, targetRoot) {
  if (!targetRoot || ![EFFECTS.LOCAL_READ, EFFECTS.LOCAL_WRITE, EFFECTS.LOCAL_DELETE, EFFECTS.LOCAL_EXECUTE, EFFECTS.TEST_EXECUTION, EFFECTS.LOCAL_COMMIT, EFFECTS.IRREVERSIBLE_DELETE].includes(request.effect)) return null
  let root
  try {
    const rootStat = fs.lstatSync(targetRoot)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return block('RED_BLOCK_TARGET_ROOT_ESCAPE', 'Target root is not a canonical directory.', request)
    root = fs.realpathSync(targetRoot)
  } catch {
    return block('RED_BLOCK_TARGET_ROOT_ESCAPE', 'Target root cannot be canonicalized.', request)
  }
  const raw = String(request.resource || '')
  for (const commandPath of request.command_paths || []) {
    const candidatePath = path.isAbsolute(commandPath) ? path.resolve(commandPath) : path.resolve(root, commandPath)
    const candidateRelative = path.relative(root, candidatePath)
    if (candidateRelative === '..' || candidateRelative.startsWith(`${path.sep}..${path.sep}`) || candidateRelative.startsWith(`..${path.sep}`) || path.isAbsolute(candidateRelative)) return block('RED_BLOCK_TARGET_ROOT_ESCAPE', 'Command argument is outside the immutable target root.', request)
  }
  if (raw.startsWith('opencode://') || raw === 'git-index' || raw === 'git-remote' || raw === 'protected-branch') return null
  const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw)
  const relative = path.relative(root, candidate)
  if (relative === '..' || relative.startsWith(`${path.sep}..${path.sep}`) || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return block('RED_BLOCK_TARGET_ROOT_ESCAPE', 'Resource is outside the immutable target root.', request)
  }
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return block('RED_BLOCK_SYMLINK_ESCAPE', 'Resource path contains a symlink.', request)
    } catch (error) {
      if (error.code !== 'ENOENT') return block('RED_BLOCK_TARGET_ROOT_ESCAPE', 'Resource path cannot be safely inspected.', request)
    }
  }
  return null
}

function bootstrapStateBlock(input, request) {
  if (!input.targetRoot || request.effect === EFFECTS.LOCAL_READ || request.effect === EFFECTS.LOCAL_STATE) return null
  try {
    const statePath = path.join(input.targetRoot, '.agent-governance', 'state', 'task-bootstrap-state.json')
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if (state.state === 'TASK_BLOCKED') return block('RED_BLOCK_TASK_BOOTSTRAP_BLOCKED', 'Trusted task bootstrap is blocked; no normal write may proceed.', request)
  } catch {
    // Missing state is handled by the regular fail-closed capsule check.
  }
  return null
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
  const boundary = targetRootBoundary(request, input.targetRoot)
  if (boundary) {
    await auditEarlyBlock(input, boundary)
    return boundary
  }
  const stateBlock = bootstrapStateBlock(input, request)
  if (stateBlock) {
    await auditEarlyBlock(input, stateBlock)
    return stateBlock
  }
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
  const delegationBlock = delegationBoundary(input, capsule, request)
  if (delegationBlock) {
    await auditEarlyBlock(input, delegationBlock)
    return delegationBlock
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
  const governedEffect = request.command_classification ? request.effect : capability.capability.effect_class || request.effect
  const decision = evaluateEffect({
    intent: input.intent || {}, capsule, effect: governedEffect, resource: request.resource,
    receipt: input.receipt, lease: input.lease, authorization_source: input.authorization_source, tool_output: input.toolOutput,
    reversibility: request.reversibility || capability.capability.reversibility, experiment: input.experiment,
    restore_available: input.restoreAvailable, preference: input.preference,
  })
  const result = Object.freeze({ ...decision, ...((request.command_classification || request.effect === EFFECTS.DELEGATE || request.effect === EFFECTS.NETWORK) ? { effect: governedEffect } : {}), tool: request.tool, action: request.action, capability_key: capability.key, resource: request.resource, command_effect_class: request.command_effect_class || null, runtime: input.runtime || 'unknown', task_id: capsule.task_id, v2_enforced: true, legacy_alias_used: false })
  await audit(input, result)
  return result
}

export async function recordActionOutcome({ auditPath, decision, success, output = null } = {}) {
  if (!auditPath) return
  await new ApprovalAuditLog(auditPath).append({ event: 'ACTION_OUTCOME', decision, success: Boolean(success), output: typeof output === 'string' ? output.slice(0, 1000) : output })
}

export { commandDescriptor, normalizeRequest }
