// SPDX-License-Identifier: MIT
/**
 * Boundary observability for contract-first runs.
 *
 * Emits ecosystem.run-event.v1 records keyed by a single run_id. Fingerprints
 * are hashes via the existing sha256/stableJson mechanisms. No secrets, no
 * full prompts, no credential dumps.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { sha256, stableJson } from '../../scripts/lib/mcp-preflight.mjs'
import { create as createRunEvent, validate as validateRunEvent } from '../contracts/run-event.mjs'

export function inputFingerprint(value) {
  return `sha256:${sha256(value === undefined ? null : value)}`
}

export function outputFingerprint(value) {
  return `sha256:${sha256(value === undefined ? null : value)}`
}

export function contentFingerprint(value) {
  return inputFingerprint(stableJson(value))
}

export { createRunEvent }

export async function appendRunEvent(filePath, event) {
  const target = path.resolve(filePath)
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  await fs.appendFile(target, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 })
  return target
}

export async function recordRunEvent(filePath, input) {
  const event = createRunEvent(input)
  const validation = validateRunEvent(event)
  if (!validation.ok) throw new Error(`RUN_EVENT_INVALID: ${validation.issues.join('; ')}`)
  await appendRunEvent(filePath, event)
  return event
}

export async function loadRunEvents(filePath) {
  let content
  try { content = await fs.readFile(filePath, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const events = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try { events.push(JSON.parse(line)) } catch { /* skip malformed */ }
  }
  return events
}

export function runIdsOf(events) {
  return [...new Set((events || []).map((event) => event.run_id).filter(Boolean))]
}

export function hasSecretLeak(events, secretValues = []) {
  const serialized = JSON.stringify(events || [])
  const sensitiveKeys = /(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\\?["'][A-Za-z0-9+/=_-]{12,}\\?["']/i
  if (sensitiveKeys.test(serialized)) return true
  return secretValues.some((value) => typeof value === 'string' && value.length > 0 && serialized.includes(value))
}
