// SPDX-License-Identifier: MIT
/**
 * Task-specific capability preflight.
 *
 * Checks only the capabilities a run actually needs (derived from the task),
 * plus MCP preflight, skills and runtime availability. A missing required
 * capability → BLOCKED (approved:false). A missing optional capability may
 * degrade but does not stop the run.
 *
 * Credential checks are presence checks only (AVAILABLE | MISSING | DENIED).
 * Secret content is never read, logged, or written into any contract.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { create as createBaseline } from '../contracts/baseline.mjs'
import { runMcpPreflight } from '../../scripts/lib/mcp-preflight.mjs'
import { deriveRequiredCapabilities, deriveOptionalCapabilities } from './capability-detector.mjs'

const PROVIDER_CREDENTIAL_KEYS = Object.freeze([
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY', 'AZURE_OPENAI_API_KEY', 'OPENCODE_ANTHROPIC_API_KEY',
])

export function toolAvailable(command, args = ['--version']) {
  try {
    const result = spawnSync(command, args, { timeout: 5000, stdio: 'ignore' })
    return !result.error && result.status === 0
  } catch {
    return false
  }
}

export function credentialStatus(keys, env) {
  const present = keys.some((key) => Object.prototype.hasOwnProperty.call(env, key))
  return present ? 'AVAILABLE' : 'MISSING'
}

export function isWritable(repoRoot) {
  if (!repoRoot) return false
  let stat
  try { stat = fs.statSync(repoRoot) } catch { return false }
  if (!stat.isDirectory()) return false
  const probe = path.join(repoRoot, `.ocae-write-probe-${process.pid}`)
  try {
    fs.writeFileSync(probe, 'probe', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    fs.rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

function shellCommand() {
  if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe'
  return 'sh'
}

export function checkCapability(name, { repoRoot, env = process.env, root } = {}) {
  const target = root || repoRoot
  switch (name) {
    case 'repository':
      return repoRoot && fs.existsSync(repoRoot) ? 'PASS' : 'MISSING'
    case 'filesystem':
      return target && fs.existsSync(target) ? 'PASS' : 'MISSING'
    case 'shell':
      return toolAvailable(shellCommand()) ? 'PASS' : 'MISSING'
    case 'git':
      return toolAvailable('git') ? 'PASS' : 'MISSING'
    case 'github':
      return Object.prototype.hasOwnProperty.call(env, 'GITHUB_TOKEN') ? 'PASS' : 'MISSING'
    case 'runtime':
      return toolAvailable(process.execPath) ? 'PASS' : 'MISSING'
    case 'node':
      return toolAvailable(process.execPath) ? 'PASS' : 'MISSING'
    case 'npm':
      return toolAvailable('npm') ? 'PASS' : 'MISSING'
    case 'test':
      // 'test' is the capability to EXECUTE tests (worker tooling). Whether a test
      // suite exists is discovered in research and enforced by VERIFY; a repo
      // without tests does not lack the test-execution capability.
      return toolAvailable(process.execPath) ? 'PASS' : 'MISSING'
    case 'build':
      return toolAvailable(process.execPath) ? 'PASS' : 'MISSING'
    case 'write':
      return isWritable(repoRoot || target) ? 'PASS' : 'DENIED'
    case 'provider':
      return credentialStatus(PROVIDER_CREDENTIAL_KEYS, env) === 'AVAILABLE' ? 'PASS' : 'MISSING'
    case 'model':
      return credentialStatus(PROVIDER_CREDENTIAL_KEYS, env) === 'AVAILABLE' ? 'PASS' : 'MISSING'
    case 'credentials':
      return credentialStatus(PROVIDER_CREDENTIAL_KEYS, env)
    case 'skills':
      return target && fs.existsSync(path.join(target, '.opencode', 'skills')) ? 'PASS' : 'MISSING'
    case 'policies':
      return target && fs.existsSync(path.join(target, '.opencode', 'policies')) ? 'PASS' : 'MISSING'
    case 'mcp':
      return 'DEGRADED'
    default:
      return 'PASS'
  }
}

function isBlockingStatus(status) {
  return ['FAIL', 'MISSING', 'DENIED', 'UNAVAILABLE'].includes(status)
}

export function runBaseline({
  task,
  plan = null,
  repoRoot,
  root = null,
  env = process.env,
  inventory = {},
  mcpProfile = null,
  required = null,
  optional = null,
  required_skills = [],
  capability_status = {},
} = {}) {
  const runId = task?.run_id || task?.runId || null
  const requiredCapabilities = required || deriveRequiredCapabilities({ task: task?.task, plan })
  const optionalCapabilities = optional || deriveOptionalCapabilities({ task: task?.task, plan })

  const requiredMap = {}
  const errors = []

  for (const name of requiredCapabilities) {
    const status = capability_status[name] || checkCapability(name, { repoRoot, root, env })
    requiredMap[name] = status
    if (isBlockingStatus(status)) errors.push(`required capability ${name}: ${status}`)
  }

  const optionalMap = {}
  const optionalDegradations = []
  for (const name of optionalCapabilities) {
    if (requiredMap[name]) continue
    const status = capability_status[name] || checkCapability(name, { repoRoot, root, env })
    optionalMap[name] = status
    if (isBlockingStatus(status)) optionalDegradations.push(`optional capability ${name}: ${status}`)
  }

  const mcpMap = {}
  let mcpPreflight = null
  if (mcpProfile) {
    mcpPreflight = runMcpPreflight({ profile: mcpProfile, inventory })
    for (const failure of mcpPreflight.required_failures || []) {
      mcpMap[failure.tool] = 'FAIL'
      errors.push(`required mcp ${failure.tool}: ${failure.code}`)
    }
    for (const degradation of mcpPreflight.optional_degradations || []) {
      mcpMap[degradation.tool] = 'DEGRADED'
    }
    if (mcpPreflight.allowed) {
      for (const requirement of [...(mcpProfile.required_tools || [])]) {
        const name = typeof requirement === 'string' ? requirement : requirement.name
        if (!mcpMap[name]) mcpMap[name] = 'PASS'
      }
    }
  }

  const skillErrors = []
  for (const skill of required_skills || []) {
    const skillDir = root ? path.join(root, '.opencode', 'skills', skill) : path.join(repoRoot || '', '.opencode', 'skills', skill)
    if (!fs.existsSync(skillDir)) {
      skillErrors.push(`required skill ${skill}: MISSING`)
      errors.push(`required skill ${skill}: MISSING`)
    }
  }

  const runtimeStatus = capability_status.runtime || checkCapability('runtime', { repoRoot, root, env })
  const runtime = { status: runtimeStatus }
  if (isBlockingStatus(runtimeStatus)) errors.push(`runtime: ${runtimeStatus}`)

  const approved = errors.length === 0
  const baseline = createBaseline({
    run_id: runId,
    required_capabilities: { ...requiredMap, ...optionalMap },
    required_mcp: mcpMap,
    required_skills: [...(required_skills || [])],
    runtime,
    approved,
    errors: [...errors, ...skillErrors],
  })
  return { ...baseline, mcp_preflight: mcpPreflight, optional_degradations: optionalDegradations, required_capability_list: requiredCapabilities, optional_capability_list: optionalCapabilities }
}
