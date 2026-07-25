// SPDX-License-Identifier: MIT
import fs from 'node:fs'

export function loadCapabilityRegistry(filePath) {
  const registry = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!registry || registry._generated_notice !== 'GENERATED FROM governance/policy-core.yaml — DO NOT EDIT DIRECTLY' || registry.schema_version !== 'governance-v2.capability-registry.1' || !registry.tools) throw new Error('RED_BLOCK_INVALID_CAPABILITY_REGISTRY')
  return Object.freeze(registry)
}

export function resolveToolCapability({ tool, action, registry } = {}) {
  const key = `${tool}.${action}`
  const capability = registry?.tools?.[key]
  if (!capability) return { allowed: false, decision_class: 'D_TECHNICAL_BLOCK', code: 'RED_BLOCK_UNKNOWN_TOOL_EFFECT', key }
  return { allowed: true, key, capability: Object.freeze({ ...capability }), tool_output: 'UNTRUSTED' }
}
