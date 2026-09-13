// SPDX-License-Identifier: MIT
/** Explicit-only, vendor-neutral local OpenAI-compatible runtime metadata. */
import crypto from 'node:crypto'

export const LOCAL_RUNTIME_STATUS = Object.freeze(['CONFIGURED', 'NOT_CONFIGURED', 'INVALID_CONFIGURATION'])
export const LOCAL_ENDPOINT_ENV = 'OCAE_LOCAL_OPENAI_BASE_URL'
export const LOCAL_MODEL_ENV = 'OCAE_LOCAL_OPENAI_MODEL'

function validLocalUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch { return false }
}

export function getExplicitLocalRuntime({ env = process.env } = {}) {
  const endpoint = env[LOCAL_ENDPOINT_ENV]
  const model = env[LOCAL_MODEL_ENV]
  if (!endpoint && !model) return Object.freeze({ status: 'NOT_CONFIGURED', reason: 'LOCAL_MODEL_QUALIFICATION=NOT_RUN_EXPLICIT_ENDPOINT_REQUIRED' })
  if (!endpoint || !model || !validLocalUrl(endpoint)) return Object.freeze({ status: 'INVALID_CONFIGURATION', reason: 'explicit localhost OpenAI-compatible endpoint and model are required' })
  return Object.freeze({ status: 'CONFIGURED', provider: 'local-openai-compatible', model, runtime_class: 'local-openai-compatible', endpoint, endpoint_fingerprint: `sha256:${sha256(endpoint)}`, discovery: 'EXPLICIT_CONFIGURATION_ONLY' })
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}
