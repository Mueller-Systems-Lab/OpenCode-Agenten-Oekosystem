#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Deterministic, dependency-free Governance V2 generator. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'governance', 'policy-core.yaml')
const generatedDir = path.join(root, 'governance', 'generated')
const generatedNotice = 'GENERATED FROM governance/policy-core.yaml — DO NOT EDIT DIRECTLY'
const required = ['schema_version', 'version', 'authority_layers', 'risk_tiers', 'execution_profiles', 'decision_classes', 'effect_classes', 'reversibility_classes', 'approval_budgets', 'approval_receipts', 'change_leases', 'approval_bundling', 'approval_deduplication', 'scope_rules', 'agent_roles', 'delegation', 'capability_registry', 'evidence_contracts', 'completion_classifications', 'prompt_kernel']

function readPolicy() {
  const text = fs.readFileSync(sourcePath, 'utf8').trim()
  // policy-core.yaml is intentionally JSON-compatible YAML so this generator
  // remains offline and has no parser dependency or network surface.
  const policy = JSON.parse(text)
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'governance', 'policy-core.schema.json'), 'utf8'))
  const schemaRequired = schema.required || required
  const missing = schemaRequired.filter((key) => !(key in policy))
  if (missing.length) throw new Error(`Policy schema invalid; missing: ${missing.join(', ')}`)
  for (const tier of ['LOW_LOCAL', 'MEDIUM_REVIEW', 'HIGH_HUMAN_GATE', 'CRITICAL_BLOCK']) if (!policy.risk_tiers[tier]) throw new Error(`Policy schema invalid; missing risk tier: ${tier}`)
  for (const profile of ['COMPACT', 'STANDARD', 'CRITICAL', 'BLOCKED']) if (!policy.execution_profiles[profile]) throw new Error(`Policy schema invalid; missing execution profile: ${profile}`)
  if (policy.prompt_kernel.permanent_rules !== 8 || policy.prompt_kernel.max_tokens !== 2500) throw new Error('Policy schema invalid; prompt kernel contract changed.')
  return policy
}

function outputs(policy) {
  const capabilities = Object.fromEntries(policy.effect_classes.map((effect) => [effect, {
    effect,
    source_trust: 'action_registry',
    effects: [effect.includes('READ') ? 'READ' : effect.includes('WRITE') || effect.includes('DELETE') ? 'WRITE' : effect.includes('EXECUTE') || effect.includes('TEST') ? 'EXECUTE' : 'EXTERNAL'],
    approval_class: ['MERGE', 'PRODUCTION_DEPLOY', 'EXTERNAL_COMMUNICATION', 'IRREVERSIBLE_DELETE', 'PUSH'].includes(effect) ? 'C_BUNDLED_OWNER_DECISION' : 'A_AUTONOMOUS',
    reversibility: ['MERGE', 'PRODUCTION_DEPLOY', 'EXTERNAL_COMMUNICATION', 'IRREVERSIBLE_DELETE'].includes(effect) ? 'IRREVERSIBLE' : 'UNKNOWN_REVERSIBILITY',
    lease_compatible: !['APPROVAL_ENGINE_MUTATION', 'CAPABILITY_REGISTRY_MUTATION', 'SECRET_ACCESS'].includes(effect),
    validation: 'runtime-effect-check',
    audit_level: ['MERGE', 'PRODUCTION_DEPLOY', 'EXTERNAL_COMMUNICATION', 'IRREVERSIBLE_DELETE', 'SECRET_ACCESS'].includes(effect) ? 'FULL' : 'STANDARD',
  }]))
  const tools = policy.tool_capabilities
  return {
    'policy-core.json': policy,
    'capability-registry.json': { schema_version: 'governance-v2.capability-registry.1', generated_from: 'governance/policy-core.yaml', capabilities, tools },
    'risk-profiles.json': { schema_version: 'governance-v2.risk-profiles.1', generated_from: 'governance/policy-core.yaml', risk_tiers: policy.risk_tiers, execution_profiles: policy.execution_profiles },
  }
}

export function normalizeGeneratedText(text) { return text.replace(/\r\n/g, "\n") }
function rendered(value) { return `${JSON.stringify({ _generated_notice: generatedNotice, ...value }, null, 2)}\n` }
function checkOrWrite(checkOnly) {
  const policy = readPolicy()
  const files = outputs(policy)
  const drift = []
  for (const [name, value] of Object.entries(files)) {
    const target = path.join(generatedDir, name)
    const expected = rendered(value)
    if (checkOnly) {
      if (!fs.existsSync(target) || normalizeGeneratedText(fs.readFileSync(target, 'utf8')) !== expected) drift.push(name)
    } else {
      fs.mkdirSync(generatedDir, { recursive: true })
      fs.writeFileSync(target, expected)
    }
  }
  if (drift.length) throw new Error(`Governance drift detected: ${drift.join(', ')}`)
  return { generated: Object.keys(files), drift }
}

const checkOnly = process.argv.includes('--check')
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkOrWrite(checkOnly)
    process.stdout.write(`${checkOnly ? 'GOVERNANCE_GENERATION_CHECK_OK' : 'GOVERNANCE_GENERATED'} ${result.generated.length}\n`)
  } catch (error) {
    process.stderr.write(`RED_BLOCK_GOVERNANCE_GENERATOR: ${error.message}\n`)
    process.exitCode = 2
  }
}
