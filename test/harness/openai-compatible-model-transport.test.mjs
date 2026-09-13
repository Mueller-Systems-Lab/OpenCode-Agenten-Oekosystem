import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MODEL_TRANSPORT,
  MODEL_TRANSPORT_CONTRACT_ID,
  MODEL_TRANSPORT_CONTRACT_VERSION,
  createModelTransportIdentity,
  createModelTransportRequest,
  createOpenAICompatibleModelAdapter,
  createOpenCodeModelTransportAdapter,
  normalizeTransportError,
  runOpenAICompatibleAdapterConformance,
} from '../../runtime/harness/openai-compatible-model-transport.mjs'

const tool = { type: 'function', function: { name: 'read_file', description: 'Read a fixture file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }

describe('OpenAI-compatible model transport contract', () => {
  it('normalizes identity without exposing credentials and fingerprints the contract', () => {
    const identity = createModelTransportIdentity({ provider: 'zai-coding-plan', model: 'glm-5.3-flash', base_endpoint_identity: 'https://api.z.ai/api/coding/paas/v4', authentication_reference: { kind: 'ENVIRONMENT', name: 'ZAI_CODING_PLAN_API_KEY' }, api_family: 'CHAT_COMPLETIONS' })
    assert.equal(identity.authentication_reference.name, 'ZAI_CODING_PLAN_API_KEY')
    assert.equal(identity.base_endpoint_identity, 'https://api.z.ai/api/coding/paas/v4')
    assert.match(identity.base_endpoint_fingerprint, /^sha256:[0-9a-f]{64}$/u)
    assert.equal(JSON.stringify(identity).includes('sk-'), false)
  })

  it('runs the deterministic adapter conformance lifecycle independent of model quality', async () => {
    const identity = createModelTransportIdentity({ provider: 'fixture', model: 'fixture-model', api_family: 'BOTH_NORMALIZED' })
    const seen = []
    const adapter = createOpenAICompatibleModelAdapter({
      identity,
      resolveModel: async (requested) => requested,
      complete: async (request) => {
        seen.push(request)
        const toolMessage = request.messages.find((message) => message.role === 'tool')
        return toolMessage
          ? { response_id: 'resp-2', text: 'done', finish_reason: 'stop', usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 }, structured_metadata: { resumed: true } }
          : { response_id: 'resp-1', text: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"data.txt"}' } }], finish_reason: 'tool_calls', usage: { input_tokens: 6, output_tokens: 2, total_tokens: 8 } }
      },
    })
    assert.equal(adapter.kind, MODEL_TRANSPORT)
    const resolved = await adapter.resolveExplicitModel()
    assert.deepEqual(resolved, { provider: 'fixture', model: 'fixture-model' })
    const request = createModelTransportRequest({ identity, request_id: 'req-1', messages: [{ role: 'system', content: 'Use tools.' }, { role: 'developer', content: 'Return observed data.' }, { role: 'user', content: 'Read data.txt.' }], tools: [tool], timeout_ms: 1000 })
    const first = await adapter.send(request)
    assert.equal(first.tool_calls[0].id, 'call-1')
    assert.equal(first.finish_reason, 'tool_calls')
    const resumed = await adapter.resume(request, { tool_call_id: first.tool_calls[0].id, content: 'observed=42' })
    assert.equal(resumed.text, 'done')
    assert.equal(resumed.usage.total_tokens, 12)
    assert.equal(seen[1].messages.at(-1).tool_call_id, 'call-1')
    assert.equal(seen[1].messages.at(-1).content, 'observed=42')
    assert.equal(seen[1].request_id, 'req-1')
  })

  it('exposes the required conformance gate as PASS without a model call', async () => {
    const result = await runOpenAICompatibleAdapterConformance()
    assert.equal(result.status, 'PASS', JSON.stringify(result.checks))
    assert.match(result.fingerprint, /^sha256:[0-9a-f]{64}$/u)
  })

  it('classifies timeout and rate-limit failures canonically', () => {
    assert.equal(normalizeTransportError({ code: 'ETIMEDOUT', message: 'request timed out' }).error_class, 'TIMEOUT')
    assert.equal(normalizeTransportError({ status: 429, message: 'too many requests' }).error_class, 'RATE_LIMITED')
    assert.equal(normalizeTransportError({ status: 401, message: 'unauthorized' }).error_class, 'AUTHENTICATION_FAILED')
  })

  it('keeps the OpenCode host callback behind the same contract', async () => {
    const calls = []
    const adapter = createOpenCodeModelTransportAdapter({ provider: 'opencode', model: 'free-model', invoke: async (request) => { calls.push(request); return { text: 'host result', finish_reason: 'stop' } } })
    const request = createModelTransportRequest({ identity: adapter.identity, messages: [{ role: 'user', content: 'hello' }] })
    const response = await adapter.send(request)
    assert.equal(response.text, 'host result')
    assert.equal(calls[0].contract_id, MODEL_TRANSPORT_CONTRACT_ID)
    assert.equal(calls[0].contract_version, MODEL_TRANSPORT_CONTRACT_VERSION)
  })

  it('uses the same contract for different provider/model identities', () => {
    const first = createOpenCodeModelTransportAdapter({ provider: 'provider-a', model: 'model-a', invoke: async () => ({ text: 'a' }) })
    const second = createOpenCodeModelTransportAdapter({ provider: 'provider-b', model: 'model-b', invoke: async () => ({ text: 'b' }) })
    assert.equal(first.contract.id, second.contract.id)
    assert.equal(first.contract.version, second.contract.version)
    assert.notEqual(first.contract.fingerprint, second.contract.fingerprint)
  })

  it('validates host requests and retains a normalized host response plus canonical error status', async () => {
    const adapter = createOpenCodeModelTransportAdapter({ provider: 'opencode', model: 'free-model', invoke: async () => ({ ok: false, failure_class: 'TIMEOUT' }) })
    const request = createModelTransportRequest({ identity: adapter.identity, messages: [{ role: 'user', content: 'hello' }] })
    const response = await adapter.sendHost(request)
    assert.equal(response.normalized_response.finish_reason, 'stop')
    assert.equal(response.transport_error.error_class, 'TIMEOUT')
    await assert.rejects(adapter.sendHost({ ...request, contract_version: '0.0.0' }), /CONTRACT_INVALID:model-transport/u)
  })

  it('rejects raw credentials', () => {
    assert.throws(() => createModelTransportIdentity({ provider: 'fixture', model: 'model', authentication_reference: { kind: 'ENVIRONMENT', name: 'sk-real-secret-value' } }), /CONTRACT_INVALID:model-transport/u)
  })
})
