// SPDX-License-Identifier: MIT
/** Reporting-only helpers for the frozen observation-interposition canary. */

function normalizeModelId(value, provider) {
  const text = String(value || '')
  return text.startsWith(`${provider}/`) ? text.slice(provider.length + 1) : text
}

function modelObservations(debugLog) {
  const auxiliaryModels = new Set()
  return String(debugLog || '').split(/\r?\n/u).flatMap((line) => {
    const modelMatch = line.match(/(?:modelID|llm\.model)=([^\s"]+)/u)
    if (!modelMatch) return []
    const providerMatch = line.match(/providerID=([^\s"]+)/u) || line.match(/llm\.provider=([^\s"]+)/u)
    const explicitlyAuxiliary = /(?:\bagent=title\b|\bagent="title"|\bsmall=true\b)/iu.test(line)
    const auxiliary = explicitlyAuxiliary || auxiliaryModels.has(modelMatch[1])
    if (explicitlyAuxiliary) auxiliaryModels.add(modelMatch[1])
    return [{
      model: modelMatch[1],
      provider: providerMatch?.[1] || null,
      auxiliary,
    }]
  })
}

export function classifyModelUsage({ debugLog = '', targetProvider, targetModel } = {}) {
  const observations = modelObservations(debugLog)
  const targetPath = observations.filter((item) => !item.auxiliary)
  const auxiliaryPath = observations.filter((item) => item.auxiliary && normalizeModelId(item.model, targetProvider) !== targetModel)
  const targetModelSwitchUsed = targetPath.some((item) => normalizeModelId(item.model, targetProvider) !== targetModel)
  const targetProviderFallbackUsed = targetPath.some((item) => item.provider && item.provider !== targetProvider)
  const auxiliary = auxiliaryPath[0] || null
  return {
    observed_model_ids: [...new Set(observations.map((item) => item.model))],
    target_model_switch_used: targetModelSwitchUsed,
    target_model_fallback_used: false,
    target_provider_fallback_used: targetProviderFallbackUsed,
    auxiliary_model_used: auxiliary !== null,
    auxiliary_model_provider: auxiliary?.provider || null,
    auxiliary_model: auxiliary ? normalizeModelId(auxiliary.model, auxiliary.provider || targetProvider) : null,
    auxiliary_model_purpose: auxiliary ? 'TITLE_GENERATION' : null,
  }
}

function layerStatus(layer) {
  if (!layer || layer.runs === 0) return 'NOT_RUN'
  return layer.verified_success === layer.runs ? 'PASS' : 'FAIL'
}

/** Distinguish an unreachable prerequisite from a gate that executed negatively. */
export function classifyCanaryGateState({ preflight = {}, plugin = {}, canaries = [] } = {}) {
  const gates = { CONTROL_0: 'NOT_RUN', IDENTITY: 'NOT_RUN', ENVELOPE: 'NOT_RUN' }
  if (preflight.live_model_reachable !== true) {
    return { first_failing_stage: 'PRE_FLIGHT', gates, observation_layer_failure: false }
  }
  if (plugin.pass !== true) {
    return { first_failing_stage: 'PLUGIN_INIT', gates, observation_layer_failure: false }
  }

  const control = canaries.find((layer) => layer.layer === 'CONTROL_0')
  const identity = canaries.find((layer) => layer.layer === 'CANARY_1_IDENTITY')
  const envelope = canaries.find((layer) => layer.layer === 'CANARY_2_ENVELOPE')
  gates.CONTROL_0 = layerStatus(control)
  gates.IDENTITY = layerStatus(identity)
  gates.ENVELOPE = layerStatus(envelope)
  const firstFail = gates.CONTROL_0 === 'FAIL' ? 'CONTROL'
    : gates.IDENTITY === 'FAIL' ? 'IDENTITY'
      : gates.ENVELOPE === 'FAIL' ? 'ENVELOPE' : 'NONE'
  return { first_failing_stage: firstFail, gates, observation_layer_failure: ['IDENTITY', 'ENVELOPE'].includes(firstFail) }
}

export function rateLimitClassification({ failureClass = '', debugLog = '' } = {}) {
  const text = `${failureClass}\n${debugLog}`
  if (/free-models-per-day/iu.test(text)) return 'DAILY_FREE_QUOTA_EXHAUSTED'
  if (/(?:retry-after|reset[-_ ]?(?:at|in|time)|x-ratelimit-reset)/iu.test(text)) return 'TEMPORARY_RATE_LIMIT'
  if (/(?:rate.?limit|\b429\b)/iu.test(text)) return 'PROVIDER_RATE_LIMIT'
  return 'UNKNOWN_RATE_LIMIT'
}

export function rateLimitResetEvidence(debugLog = '') {
  const match = String(debugLog).match(/(?:retry-after|x-ratelimit-reset|reset[-_ ]?(?:at|in|time))\s*[:=]\s*([^\s,;]+)/iu)
  return match ? match[1] : null
}
