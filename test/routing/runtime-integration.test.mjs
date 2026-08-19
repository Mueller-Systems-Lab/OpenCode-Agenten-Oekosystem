// SPDX-License-Identifier: MIT
/**
 * Canonical runtime + routing integration tests.
 *
 * Proves the deterministic chain inside the runtime:
 *   TASK → ROUTING (policy selects route) → BUILD (real worker artifacts) →
 *   VERIFY → [RETRY same model | ESCALATE model | fallback] → REVIEWS →
 *   CONTROLLER (sole terminal authority).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { runTask } from '../../runtime/run.mjs'
import { decideRouteAction } from '../../runtime/routing/index.mjs'

async function fixtureRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-routing-it-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

const PLAN = '# Plan\n## Targets\n- proof.json — write the proof file\n## Acceptance Criteria\n- proof.json exists with exact JSON\n## Required Tests\n- node check\n## Build Scope\nfiles: proof.json'

function verifyChecks(root) {
  return [{
    command: 'node',
    args: ['-e', "const fs=require('fs');const c=JSON.parse(fs.readFileSync('proof.json','utf8'));if(c.value!==42)process.exit(1)"],
    cwd: root,
  }]
}

describe('canonical runtime routing integration', () => {
  it('primary route: real-style worker success → verify → DONE, no escalation', async (t) => {
    const root = await fixtureRoot(t)
    const calls = []
    const routeExecutor = (route, { attempt }) => async () => {
      calls.push({ provider: route.provider, model: route.model, attempt })
      await fs.writeFile(path.join(root, 'proof.json'), JSON.stringify({ ecosystem_proof: 'multi-model', value: 42 }))
      return { changed_files: ['proof.json'], errors: [], strategy_delta: null }
    }
    const result = await runTask({
      taskInput: { task: 'primary success', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor,
      routing: { enabled: true },
    })
    assert.equal(result.phase, 'PIPELINE')
    assert.equal(result.decision.decision, 'DONE')
    assert.equal(result.route.model, 'deepseek-v4-flash')
    assert.equal(result.route.routing_reason, 'PRIMARY_ROUTE')
    assert.equal(calls.length, 1, 'no unnecessary retry/escalation')
    assert.equal(calls[0].model, 'deepseek-v4-flash')
    const routeEvents = result.events.filter((e) => e.job === 'model.route.selected')
    assert.equal(routeEvents.length, 1)
    assert.ok(result.events.some((e) => e.job === 'model.worker.start'))
    assert.ok(result.events.some((e) => e.job === 'model.worker.result'))
  })

  it('escalation: classified failure on route A → policy escalates to route B → DONE, same run_id', async (t) => {
    const root = await fixtureRoot(t)
    const calls = []
    const routeExecutor = (route, { attempt }) => async () => {
      calls.push({ provider: route.provider, model: route.model, attempt })
      const ok = route.model === 'deepseek-v4-flash' && attempt >= 1
      if (ok) await fs.writeFile(path.join(root, 'proof.json'), JSON.stringify({ ecosystem_proof: 'multi-model', value: 42 }))
      return {
        changed_files: ok ? ['proof.json'] : [],
        errors: ok ? [] : ['missing artifact'],
        strategy_delta: ok ? 'write the exact proof.json' : null,
        failure_class: ok ? null : 'MODEL_CAPABILITY_INSUFFICIENT',
      }
    }
    const onWorkerFailure = async (input) => decideRouteAction({ ...input, requirements: { quality_requirement: 'LOW' } })
    const result = await runTask({
      taskInput: { task: 'escalation proof', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor,
      onWorkerFailure,
      routing: { enabled: true, requirements: { quality_requirement: 'LOW' } },
    })
    assert.equal(result.decision.decision, 'DONE')
    assert.deepEqual(calls.map((c) => c.model), ['deepseek-chat', 'deepseek-v4-flash'])
    assert.equal(result.route.model, 'deepseek-v4-flash')
    // run_id stays stable across the model change.
    const allRunIds = new Set(result.events.map((e) => e.run_id))
    assert.equal(allRunIds.size, 1)
    assert.equal([...allRunIds][0], result.run_id)
    const escalationEvents = result.events.filter((e) => e.job === 'model.escalation')
    assert.equal(escalationEvents.length, 1)
    assert.equal(escalationEvents[0].failure_signature, 'ESCALATION:MODEL_CAPABILITY_INSUFFICIENT')
  })

  it('same-model retry: retry on route A is NOT an escalation', async (t) => {
    const root = await fixtureRoot(t)
    const calls = []
    const routeExecutor = (route, { attempt }) => async () => {
      calls.push({ provider: route.provider, model: route.model, attempt })
      if (attempt >= 1) await fs.writeFile(path.join(root, 'proof.json'), JSON.stringify({ ecosystem_proof: 'multi-model', value: 42 }))
      return {
        changed_files: attempt >= 1 ? ['proof.json'] : [],
        errors: attempt >= 1 ? [] : ['incomplete output'],
        // Meaningful strategy delta on attempt 0 → canonical retry policy
        // allows a same-route retry (RETRY != ESCALATION).
        strategy_delta: attempt >= 1 ? 'write the exact proof.json content' : 'write the exact proof.json content with value 42',
        failure_class: attempt >= 1 ? null : 'MODEL_OUTPUT_INVALID',
      }
    }
    const onWorkerFailure = async (input) => decideRouteAction({ ...input, requirements: { quality_requirement: 'LOW' } })
    const result = await runTask({
      taskInput: { task: 'same worker retry', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor,
      onWorkerFailure,
      routing: { enabled: true, requirements: { quality_requirement: 'LOW' } },
    })
    assert.equal(result.decision.decision, 'DONE')
    assert.deepEqual(calls.map((c) => c.model), ['deepseek-chat', 'deepseek-chat'], 'RETRY stays on the same model')
    assert.equal(result.events.filter((e) => e.job === 'model.escalation').length, 0, 'retry must not emit an escalation event')
    assert.equal(result.events.filter((e) => e.job === 'model.worker.failure').length, 1)
  })

  it('unavailable route + exhausted budget → controlled BLOCKED, no unbounded hopping', async (t) => {
    const root = await fixtureRoot(t)
    const calls = []
    const routeExecutor = (route) => async () => {
      calls.push(`${route.provider}/${route.model}`)
      return { changed_files: [], errors: ['missing'], strategy_delta: null, failure_class: 'MODEL_CAPABILITY_INSUFFICIENT' }
    }
    const onWorkerFailure = async (input) => decideRouteAction({ ...input, requirements: { needs_mcp: true } })
    const result = await runTask({
      taskInput: { task: 'budget exhaustion', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor,
      onWorkerFailure,
      routing: { enabled: true, requirements: { needs_mcp: true } },
    })
    // needs_mcp → v4-flash directly; v4-flash fails; no better MCP model → BLOCKED.
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'ROUTING_NO_ESCALATION_TARGET')
    assert.equal(calls.length, 1, 'no unbounded model hopping')
  })

  it('worker cannot replace the run_id even under routing', async (t) => {
    const root = await fixtureRoot(t)
    const routeExecutor = (route) => async () => {
      await fs.writeFile(path.join(root, 'proof.json'), JSON.stringify({ ecosystem_proof: 'multi-model', value: 42 }))
      return { changed_files: ['proof.json'], errors: [], run_id: 'ATTACKER-REPLACED-RUN-ID' }
    }
    const result = await runTask({
      taskInput: { task: 'run-id attack', repository: root },
      repoRoot: root,
      nativePlan: { planText: PLAN },
      verifyChecks: verifyChecks(root),
      routeExecutor,
      routing: { enabled: true },
    })
    assert.equal(result.phase, 'ABORTED')
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'CONTRACT_INVALID')
  })
})
