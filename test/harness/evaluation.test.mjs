import test from 'node:test'
import assert from 'node:assert/strict'
import { frozenCorpus, createEvaluationPlan, runEvaluation, decidePromotion, createFixtureExecutor, createCanonicalRuntimeExecutor, comparePaired, validateEvaluationIntegrity, calculateMetrics } from '../../runtime/harness/evaluation.mjs'

const models = [{ provider: 'opencode', model: 'hy3-free' }, { provider: 'opencode', model: 'muse-spark-1.2-contributor-free' }]

function fixtureWorker(request) {
  if (request.case_id === 'controlled-retry' && request.repetition === 2 && request.arm === 'generic') return { rate_limited: true, failure_retained: true }
  if (request.case_id === 'isolated-bugfix') return { changed_files: ['proof.json'] }
  if (request.case_id === 'multi-file-change') return { targets: ['a.mjs', 'b.mjs'] }
  if (request.case_id === 'structured-output-exactness') return { structured: true }
  return { tools_added: false, failure_retained: true }
}

test('bounded evaluation plans and executes paired fixture rows with retained failures', async () => {
  const corpus = frozenCorpus()
  assert.equal(corpus.cases.length, 5)
  const plan = createEvaluationPlan({ corpus, models, repetitions: 2 })
  assert.equal(plan.rows.length, 40)
  assert.equal(new Set(plan.rows.map((row) => `${row.model.model}|${row.case_id}|${row.repetition}`)).size, 20)
  const evaluation = await runEvaluation({ plan, corpus, executor: createFixtureExecutor(fixtureWorker) })
  assert.equal(evaluation.records.length, 40)
  assert.equal(evaluation.comparison.complete, true)
  assert.ok(evaluation.records.some((row) => row.rate_limited && row.retained))
  for (const row of evaluation.records) {
    assert.equal(row.paid_calls, null)
    assert.equal(row.fallback, null)
    assert.match(row.harness_fingerprint, /^[0-9a-f]{64}$/)
    assert.ok(row.provider && row.model && row.case_id && row.repetition && row.arm)
  }
})

test('metrics retain the frozen value dimensions used by promotion hypotheses', () => {
  const metrics = calculateMetrics([
    { arm: 'generic', verified_success: true, input_context_volume: 100, tool_result_volume: 20, tool_calls: 2, retry_count: 1, runtime_failures: ['x'] },
    { arm: 'candidate', verified_success: true, input_context_volume: 80, tool_result_volume: 10, tool_calls: 1, retry_count: 0, runtime_failures: [] },
  ])
  assert.equal(metrics.generic.average_input_context_volume, 100)
  assert.equal(metrics.candidate.average_input_context_volume, 80)
  assert.equal(metrics.candidate.average_tool_result_volume, 10)
  assert.equal(metrics.candidate.average_runtime_failures, 0)
})

test('evaluation invariants keep route and permissions outside the profile arm', async () => {
  const corpus = frozenCorpus(); const plan = createEvaluationPlan({ corpus, models: [models[0]], repetitions: 1 })
  const requests = []
  await runEvaluation({ plan, corpus, executor: createFixtureExecutor(async (request) => { requests.push(request); return { changed_files: ['proof.json'], tools_added: false } }) })
  for (const pair of [requests.slice(0, 2), requests.slice(2, 4)]) {
    assert.deepEqual(pair[0].model, pair[1].model)
    assert.deepEqual(pair[0].exposed_tools, pair[1].exposed_tools)
  }
})

test('synthetic relabelled promotion evidence is blocked before policy decisions', () => {
  const corpus = frozenCorpus(); const plan = createEvaluationPlan({ corpus, models: [models[0]], repetitions: 2 })
  const records = plan.rows.map((row) => ({ sequence: row.sequence, plan_fingerprint: plan.fingerprint, corpus_fingerprint: corpus.fingerprint, provider: row.model.provider, model: row.model.model, case_id: row.case_id, task_role: row.task_role, repetition: row.repetition, arm: row.arm, profile_id: 'profile', profile_version: '1', harness_fingerprint: 'h'.repeat(64), effective_harness_fingerprint: 'h'.repeat(64), verified_success: row.arm === 'candidate', outcome: row.arm === 'candidate' ? 'VERIFIED_SUCCESS' : 'FAILURE', paid_calls: 0, fallback: false, failure_class: null, canonical_execution: true, provenance: 'canonical-ocae-runtime', run_id: `run-${row.sequence}` }))
  const make = (overrides = {}) => ({ contract: 'ecosystem.model-harness-evaluation.v1', plan, corpus, plan_fingerprint: plan.fingerprint, corpus_fingerprint: corpus.fingerprint, live_status: 'LIVE_ATTEMPTED', records, metrics: { generic: { rows: 10, verified_success: 0, success_rate: 0, failures: 10 }, candidate: { rows: 10, verified_success: 10, success_rate: 1, failures: 0 } }, comparison: comparePaired(records), ...overrides })
   assert.equal(decidePromotion({ evaluation: make() }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
  const noValueRecords = records.map((row) => ({ ...row, verified_success: false, outcome: 'FAILURE' }))
   assert.equal(decidePromotion({ evaluation: make({ records: noValueRecords, metrics: { generic: { rows: 10, verified_success: 0, success_rate: 0, failures: 10 }, candidate: { rows: 10, verified_success: 0, success_rate: 0, failures: 10 } }, comparison: comparePaired(noValueRecords) }) }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
  const regressionRecords = records.map((row) => ({ ...row, verified_success: row.arm === 'generic', outcome: row.arm === 'generic' ? 'VERIFIED_SUCCESS' : 'FAILURE' }))
   assert.equal(decidePromotion({ evaluation: make({ records: regressionRecords, metrics: { generic: { rows: 10, verified_success: 10, success_rate: 1, failures: 0 }, candidate: { rows: 10, verified_success: 0, success_rate: 0, failures: 10 } }, comparison: comparePaired(regressionRecords) }) }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
   assert.equal(decidePromotion({ evaluation: make({ comparison: { complete: false, candidate_wins: 1, pairs: [] } }) }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
  assert.equal(decidePromotion({ evaluation: make(), live: false }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
  assert.equal(decidePromotion({ evaluation: make({ live_status: 'FIXTURE_ONLY' }) }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
  assert.equal(decidePromotion({ evaluation: make({ records: records.map((row) => ({ ...row, failure_class: 'TOOL_GAP' })), metrics: make().metrics, comparison: comparePaired(records) }) }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
})

test('forbidden paid calls and fallback are retained and reject promotion', async () => {
  const corpus = frozenCorpus(); const plan = createEvaluationPlan({ corpus, models: [models[0]], repetitions: 1 })
  const evaluation = await runEvaluation({ plan, corpus, executor: createFixtureExecutor(() => ({ changed_files: ['x'], paid_calls: 2, fallback: true })) })
  assert.equal(evaluation.records[0].paid_calls, 2)
  assert.equal(evaluation.records[0].fallback, true)
  assert.equal(evaluation.records[0].failure_class, 'FORBIDDEN_EFFECT')
  assert.equal(evaluation.records[0].retained, true)
  assert.equal(decidePromotion({ evaluation }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
})

test('live mode rejects fixture callbacks and canonical adapter marks provider gaps', async () => {
  const corpus = frozenCorpus(); const plan = createEvaluationPlan({ corpus, models: [models[0]], repetitions: 2, max_rows: 20 })
  await assert.rejects(() => runEvaluation({ plan, corpus, mode: 'live', execute: fixtureWorker }), /canonical executor/)
  let seamCalls = 0
  const evaluation = await runEvaluation({ plan, corpus, mode: 'live', executor: createCanonicalRuntimeExecutor({ repoRoot: process.cwd(), runTaskImpl: async () => { seamCalls += 1; return { run_id: 'canonical-test-run' } } }) })
  assert.equal(evaluation.live_status, 'TOOL_GAP')
  assert.equal(seamCalls, plan.rows.length)
  assert.ok(evaluation.records.every((row) => row.canonical_execution && row.provenance === 'canonical-ocae-runtime'))
  assert.ok(evaluation.records.every((row) => row.failure_class === 'TOOL_GAP'))
})

test('canonical executor passes candidate authorization additively while runtime owns routing', async () => {
  const calls = []
  const providerContexts = []
  const executor = createCanonicalRuntimeExecutor({
    providerExecutor: { canonicalProviderExecutor: true, contract: 'ecosystem.provider-executor.v1', metadata: { connector_id: 'test-seam', provider: 'opencode', model: 'hy3-free', live_capable: true }, execute: async (_request, context) => { providerContexts.push(context); return { changed_files: ['proof.json'] } } },
    runTaskImpl: async (options) => {
      calls.push(options)
      const worker = await options.routeExecutor({}, { tool_grant: { allowed_tools: [] } })
      await worker({}, { tool_grant: { allowed_tools: [] } })
      return { run_id: `canonical-${calls.length}` }
    },
  })
  const common = { provider: 'opencode', model: 'hy3-free', case_id: 'isolated-bugfix', task_role: 'BUILD', task_text: 'test' }
  await executor.execute({ ...common, arm: 'generic' })
  await executor.execute({ ...common, arm: 'candidate' })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].routing.harness.allow_candidate, false)
  assert.equal(calls[1].routing.harness.allow_candidate, true)
  assert.deepEqual(calls[0].routing.explicit_override, calls[1].routing.explicit_override)
  assert.equal(calls[0].routing.enabled, true)
  assert.equal(calls[1].routing.enabled, true)
  assert.equal(providerContexts.length, 2)
  assert.ok(Object.hasOwn(providerContexts[0], 'tool_grant'), 'provider seam receives runtime-owned grant input')
})

test('unmarked provider callbacks are rejected and cannot become live evidence', () => {
  assert.throws(() => createCanonicalRuntimeExecutor({ providerExecutor: async () => ({ changed_files: ['fake'] }) }), /CONTRACT_INVALID:evaluation:provider executor/)
})

test('marked connector attribution must match the request or retained mismatch blocks promotion', async () => {
  const corpus = frozenCorpus()
  const plan = createEvaluationPlan({ corpus, models: [{ provider: 'opencode', model: 'model-b' }], repetitions: 1, max_rows: 10 })
  let runtimeCalls = 0
  const executor = createCanonicalRuntimeExecutor({
    providerExecutor: {
      canonicalProviderExecutor: true,
      contract: 'ecosystem.provider-executor.v1',
      metadata: { connector_id: 'marked-model-a', provider: 'opencode', model: 'model-a', live_capable: true },
      execute: async () => ({ changed_files: ['must-not-run'] }),
    },
    runTaskImpl: async () => { runtimeCalls += 1; return { run_id: 'must-not-run' } },
  })
  const evaluation = await runEvaluation({ plan, corpus, mode: 'live', executor })
  assert.equal(runtimeCalls, 0)
  assert.ok(evaluation.records.every((row) => row.failure_class === 'PROVIDER_MISMATCH' && row.retained && row.outcome === 'FAILURE'))
  assert.equal(decidePromotion({ evaluation }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
})

test('evaluation integrity rejects duplicate, unstable, and forged evidence', async () => {
  const corpus = frozenCorpus(); const plan = createEvaluationPlan({ corpus, models: [models[0]], repetitions: 2, max_rows: 20 })
  const evaluation = await runEvaluation({ plan, corpus, executor: createFixtureExecutor(() => ({ changed_files: ['proof.json'] })) })
  const live = {
    ...evaluation,
    live_status: 'LIVE_ATTEMPTED',
    records: evaluation.records.map((row, index) => ({ ...row, canonical_execution: true, provenance: 'canonical-ocae-runtime', run_id: `run-${index}` })),
  }
  live.metrics = evaluation.metrics
  live.comparison = evaluation.comparison
   assert.equal(validateEvaluationIntegrity({ evaluation: live, plan, corpus }).ok, false)
   assert.ok(validateEvaluationIntegrity({ evaluation: live, plan, corpus }).issues.some((issue) => issue.includes('provenance binding')))
  const forged = { ...live, records: [...live.records.slice(0, -1), { ...live.records[0], sequence: live.records[0].sequence }] }
  const result = decidePromotion({ evaluation: forged })
  assert.equal(result.decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
  assert.ok(result.integrity_issues.some((issue) => issue.includes('does not map') || issue.includes('duplicate') || issue.includes('exactly once')))
  const unstable = { ...live, records: live.records.map((row, index) => index === 10 ? { ...row, harness_fingerprint: 'x'.repeat(64) } : row) }
   assert.equal(validateEvaluationIntegrity({ evaluation: unstable, plan, corpus }).ok, false)
})

test('genuine canonical adapter records bind structurally but do not claim live model value by seam marking alone', async () => {
  const corpus = frozenCorpus(); const plan = createEvaluationPlan({ corpus, models: [models[0]], repetitions: 1, max_rows: 10 })
  let seamRuns = 0
  const executor = createCanonicalRuntimeExecutor({
    providerExecutor: {
      canonicalProviderExecutor: true,
      contract: 'ecosystem.provider-executor.v1',
      metadata: { connector_id: 'marked-test-seam', provider: models[0].provider, model: models[0].model, live_capable: true },
      execute: async () => ({ changed_files: ['proof.json'] }),
    },
    runTaskImpl: async (options) => {
      const worker = await options.routeExecutor({}, {})
      await worker({}, {})
      seamRuns += 1
      return { run_id: `canonical-structural-${seamRuns}` }
    },
  })
  const evaluation = await runEvaluation({ plan, corpus, mode: 'live', executor })
  assert.equal(validateEvaluationIntegrity({ evaluation, plan, corpus }).ok, true)
  assert.equal(decidePromotion({ evaluation }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
})

test('non-cancellable executor timeout is retained as TIMEOUT and later rows continue', async () => {
  const corpus = frozenCorpus(); const plan = createEvaluationPlan({ corpus, models: [models[0]], repetitions: 1, max_rows: 10 })
  let calls = 0
  const evaluation = await runEvaluation({ plan, corpus, budgets: { timeout_ms: 5 }, executor: createFixtureExecutor(async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { changed_files: ['late'] } }) })
  assert.equal(evaluation.records.length, 10)
  assert.ok(evaluation.records.some((row) => row.failure_class === 'TIMEOUT' && row.retained))
  assert.ok(calls > 1)
})

test('canonical records expose the complete paired-run metric contract', async () => {
  const corpus = frozenCorpus()
  const plan = createEvaluationPlan({ corpus, models: [models[0]], repetitions: 1, max_rows: 10 })
  const evaluation = await runEvaluation({
    plan,
    corpus,
    executor: createFixtureExecutor(() => ({
      changed_files: ['proof.json'],
      first_tool_correct: null,
      required_tool_used: null,
      invalid_tool_calls: 0,
      unnecessary_tool_calls: 0,
      tool_call_count: 0,
    })),
  })
  const record = evaluation.records[0]
  for (const field of [
    'run_id', 'provider', 'model', 'variant', 'profile_id', 'profile_version',
    'task_role', 'effective_harness_fingerprint', 'verified_success',
    'functional_correctness', 'first_tool_correct', 'required_tool_used',
    'invalid_tool_calls', 'unnecessary_tool_calls', 'tool_call_count',
    'retry_count', 'runtime_failures', 'input_context_volume',
    'tool_result_volume', 'latency_ms', 'failure_class', 'verifier_type',
    'verifier_result',
  ]) assert.ok(Object.hasOwn(record, field), `missing canonical record field: ${field}`)
  assert.equal(record.verifier_type, 'changed_file')
  assert.equal(record.tool_call_count, 0)
})

test('live timeout records retain canonical identity but cannot become promotion evidence', async () => {
  const corpus = frozenCorpus()
  const plan = createEvaluationPlan({ corpus, models: [models[0]], repetitions: 1, max_rows: 10 })
  const evaluation = await runEvaluation({
    plan,
    corpus,
    mode: 'live',
    budgets: { timeout_ms: 5 },
    executor: createCanonicalRuntimeExecutor({
      providerExecutor: {
        canonicalProviderExecutor: true,
        contract: 'ecosystem.provider-executor.v1',
        metadata: { connector_id: 'timeout-test', provider: models[0].provider, model: models[0].model, live_capable: true },
        execute: async () => new Promise(() => {}),
      },
      runTaskImpl: async (options) => {
        const worker = await options.routeExecutor({}, {})
        return worker({}, {})
      },
    }),
  })
  assert.ok(evaluation.records.every((record) => record.failure_class === 'TIMEOUT' && record.retained))
  assert.ok(evaluation.records.every((record) => typeof record.run_id === 'string' && record.run_id.length > 0))
  assert.equal(validateEvaluationIntegrity({ evaluation, plan, corpus }).ok, true)
  assert.equal(decidePromotion({ evaluation }).decision, 'E_BLOCKED_NO_LIVE_EVIDENCE')
})
