#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** One bounded cross-provider transport canary; it does not tune the canary model. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createModelTransportRequest, createOpenCodeModelTransportAdapter, HOST_TRANSPORT, MODEL_TRANSPORT, MODEL_TRANSPORT_CONTRACT_ID, MODEL_TRANSPORT_CONTRACT_VERSION, runOpenAICompatibleAdapterConformance, transportFingerprint } from '../runtime/harness/openai-compatible-model-transport.mjs'
import { invokeOpenCode, parseOpenCodeEvents, sanitizeDebugLog } from '../runtime/harness/live-qualification.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const provider = process.env.OCAE_PORTABILITY_PROVIDER || null
const model = process.env.OCAE_PORTABILITY_MODEL || null
const apiFamily = process.env.OCAE_PORTABILITY_API_FAMILY || 'UNKNOWN'
const opencodeBin = process.env.OCAE_OPENCODE_BIN || 'opencode'
const timeoutMs = 90_000

const base = {
  HOST_TRANSPORT,
  MODEL_TRANSPORT,
  MODEL_TRANSPORT_CONTRACT_ID,
  MODEL_TRANSPORT_CONTRACT_VERSION,
  MODEL_TRANSPORT_FINGERPRINT: 'NOT_RUN',
  OPENAI_COMPATIBLE_API_FAMILY: apiFamily,
  OPENAI_COMPATIBLE_ADAPTER_PRESENT: 'YES',
  OPENAI_COMPATIBLE_ADAPTER_ENFORCED: 'YES',
  DIRECT_PROVIDER_SDK_IN_CANONICAL_PATH: 'NO',
  DIRECT_PROVIDER_HTTP_SCHEMA_IN_CANONICAL_PATH: 'NO',
  GLM53_FLASH_MODEL_TRANSPORT: MODEL_TRANSPORT,
  FREE_MODEL_TRANSPORT: MODEL_TRANSPORT,
  TRANSPORT_ARCHITECTURE_CLASSIFICATION: 'OPENAI_COMPATIBLE_TRANSPORT_ALREADY_CANONICAL',
}

if (!provider || !model) {
  console.log(JSON.stringify({ ...base, OPENAI_COMPATIBLE_ADAPTER_CONFORMANCE: 'NOT_RUN', SAME_TRANSPORT_CONTRACT: 'NOT_RUN', CROSS_PROVIDER_TRANSPORT_PORTABILITY: 'NOT_RUN', status: 'NOT_RUN', reason: 'Set OCAE_PORTABILITY_PROVIDER and OCAE_PORTABILITY_MODEL to run the bounded canary.' }, null, 2))
} else {
  const hostVersion = execFileSync(opencodeBin, ['--version'], { encoding: 'utf8' }).trim()
  const root = await fs.mkdtemp('/tmp/ocae-issue-43-portability-')
  const adapter = createOpenCodeModelTransportAdapter({
    provider, model, api_family: apiFamily,
    base_endpoint_identity: process.env.OCAE_PORTABILITY_BASE_ENDPOINT_IDENTITY || null,
    authentication_reference: process.env.OCAE_PORTABILITY_AUTH_ENVIRONMENT ? { kind: 'ENVIRONMENT', name: process.env.OCAE_PORTABILITY_AUTH_ENVIRONMENT } : null,
    invoke: request => invokeOpenCode({ opencode_bin: opencodeBin, provider: request.provider, model: request.model, root: request.metadata.host_root, prompt: request.messages.find(message => message.role === 'user')?.content || '', timeout_ms: request.timeout_ms, use_plugins: false }),
    normalize_host_response: response => {
      const events = parseOpenCodeEvents(response.stdout)
      return { text: events.filter(event => event.type === 'text').map(event => event.part?.text || '').join(''), finish_reason: response.ok ? 'stop' : 'error', structured_metadata: { event_types: events.map(event => event.type || null) } }
    },
  })
  try {
    const conformance = await runOpenAICompatibleAdapterConformance()
    const request = createModelTransportRequest({ identity: adapter.identity, messages: [{ role: 'user', content: 'Reply with exactly TRANSPORT_PORTABILITY_OK and nothing else. Do not use tools.' }], timeout_ms: timeoutMs, metadata: { host_root: root } })
    const response = await adapter.sendHost(request)
    const answer = response.normalized_response?.text || ''
    const pass = conformance.status === 'PASS' && adapter.contract.id === MODEL_TRANSPORT_CONTRACT_ID && adapter.contract.version === MODEL_TRANSPORT_CONTRACT_VERSION && response.ok === true && answer.includes('TRANSPORT_PORTABILITY_OK') && provider !== 'zai-coding-plan'
    const report = {
      ...base,
      PROVIDER: provider,
      MODEL: model,
      OPENCODE_VERSION: hostVersion,
      MODEL_TRANSPORT_FINGERPRINT: adapter.contract.fingerprint,
      OPENAI_COMPATIBLE_API_FAMILY: apiFamily,
      OPENAI_COMPATIBLE_ADAPTER_CONFORMANCE: conformance.status,
      SAME_TRANSPORT_CONTRACT: adapter.contract.id === MODEL_TRANSPORT_CONTRACT_ID && adapter.contract.version === MODEL_TRANSPORT_CONTRACT_VERSION ? 'YES' : 'NO',
      CROSS_PROVIDER_TRANSPORT_PORTABILITY: pass ? 'PASS' : 'FAIL',
      response: { ok: response.ok, answer_fingerprint: answer ? transportFingerprint(answer) : null, failure_class: response.failure_class || null, transport_error: response.transport_error || null, debug_excerpt: sanitizeDebugLog(response.stderr, 4000) },
      status: pass ? 'PASS' : 'FAIL',
    }
    const outputPath = path.join(repoRoot, 'docs', 'reports', `issue-43-transport-portability-canary-${Date.now()}.json`)
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log(JSON.stringify({ output_path: path.relative(repoRoot, outputPath), ...report }, null, 2))
    if (!pass) process.exitCode = 1
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}
