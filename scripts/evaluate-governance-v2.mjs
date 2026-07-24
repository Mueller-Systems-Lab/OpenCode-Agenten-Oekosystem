#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCapabilityRegistry, resolveToolCapability } from '../runtime/approval/capability-registry.mjs'
import { evaluateEffect } from '../runtime/approval/approval-engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => value.startsWith('--') ? [...pairs, [value.slice(2), values[index + 1]]] : pairs, []))
const registry = loadCapabilityRegistry(path.join(root, 'governance/generated/capability-registry.json'))
const capability = resolveToolCapability({ tool: args.tool, action: args.action, registry })
const decision = capability.allowed ? evaluateEffect({ intent: { intent_id: 'cli-intent' }, capsule: { task_id: 'cli-task', read_scope: ['**'], write_scope: ['**'], forbidden_scope: ['.env'], allowed_effects: [capability.capability.effect_class] }, effect: capability.capability.effect_class, resource: args.resource || '', reversibility: capability.capability.reversibility, tool_output: { owner_approved: true } }) : capability
process.stdout.write(`${JSON.stringify({ capability, decision }, null, 2)}\n`)
process.exitCode = decision.decision_class === 'D_TECHNICAL_BLOCK' ? 2 : decision.requires_owner ? 1 : 0
