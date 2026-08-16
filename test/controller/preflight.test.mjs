import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runBaseline } from '../../runtime/baseline/capability-preflight.mjs'
import { createTask } from '../../runtime/contracts/index.mjs'

const RUN_ID = 'preflight-test-run'

function task(taskText, extra = {}) {
  return createTask({ run_id: RUN_ID, task: taskText, repository: '/tmp', ...extra })
}

const baseProfile = (requiredTools = []) => ({
  agent_id: 'preflight-agent', role: 'preflight', required_tools: requiredTools, optional_tools: [],
  allowed_operations: ['read'], denied_operations: ['write'], allowed_paths: ['**'], write_paths: [],
  network_policy: 'deny', egress_policy: 'deny', trust_tier: '1_sandboxed', tool_version_constraints: {},
  auth_requirement: {}, timeout_ms: 5000, preflight_failure_policy: 'FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT',
})

describe('capability preflight — negative and positive cases', () => {
  it('required MCP unavailable → BLOCKED', () => {
    const baseline = runBaseline({
      task: task('implement a github workflow change'),
      repoRoot: process.cwd(),
      inventory: {},
      mcpProfile: baseProfile([{ name: 'github', server: 'github-server' }]),
    })
    assert.equal(baseline.approved, false)
    assert.ok(baseline.errors.some((error) => error.includes('github')))
    assert.equal(baseline.required_mcp.github, 'FAIL')
  })

  it('required skill unavailable → BLOCKED', () => {
    const baseline = runBaseline({
      task: task('apply the migration-review skill'),
      repoRoot: process.cwd(),
      required_skills: ['does-not-exist-skill'],
    })
    assert.equal(baseline.approved, false)
    assert.ok(baseline.errors.some((error) => error.includes('does-not-exist-skill')))
  })

  it('repository inaccessible → BLOCKED', () => {
    const missing = path.join(os.tmpdir(), `ocae-missing-${Date.now()}`)
    const baseline = runBaseline({ task: task('change repository code'), repoRoot: missing })
    assert.equal(baseline.approved, false)
    assert.ok(baseline.errors.some((error) => error.includes('repository')))
  })

  it('write permission denied → BLOCKED when write is required', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-write-deny-'))
    const fileAsRoot = path.join(root, 'not-a-directory')
    await fs.writeFile(fileAsRoot, 'x', 'utf8')
    const baseline = runBaseline({
      task: task('implement a function that writes files'),
      repoRoot: fileAsRoot,
      plan: { build_scope: { files: ['src/a.mjs'] } },
    })
    assert.equal(baseline.required_capabilities.write, 'DENIED')
    assert.equal(baseline.approved, false)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('provider unavailable → BLOCKED when required', () => {
    const baseline = runBaseline({
      task: task('use the anthropic provider'),
      repoRoot: process.cwd(),
      required: ['repository', 'filesystem', 'runtime', 'provider'],
      env: {},
    })
    assert.equal(baseline.approved, false)
    assert.ok(baseline.errors.some((error) => error.includes('provider')))
  })

  it('credential missing → BLOCKED when required; never exposes values', () => {
    const baseline = runBaseline({
      task: task('call an API using credentials'),
      repoRoot: process.cwd(),
      required: ['repository', 'filesystem', 'runtime', 'credentials'],
      env: {},
    })
    assert.equal(baseline.required_capabilities.credentials, 'MISSING')
    assert.equal(baseline.approved, false)
    assert.equal(JSON.stringify(baseline).includes('SECRET_VALUE'), false)
  })

  it('credential present → AVAILABLE and does not leak the value', () => {
    const env = { ANTHROPIC_API_KEY: 'sk-test-secret-value-1234567890abcdef' }
    const baseline = runBaseline({
      task: task('call an API using credentials'),
      repoRoot: process.cwd(),
      required: ['repository', 'filesystem', 'runtime', 'credentials'],
      env,
    })
    assert.equal(baseline.required_capabilities.credentials, 'AVAILABLE')
    assert.equal(baseline.approved, true)
    assert.equal(JSON.stringify(baseline).includes('sk-test-secret-value-1234567890abcdef'), false)
  })

  it('optional capability missing → run continues (approved)', () => {
    const baseline = runBaseline({
      task: task('open a github issue when done'),
      repoRoot: process.cwd(),
      env: {}, // no GITHUB_TOKEN
    })
    assert.equal(baseline.required_capabilities.github, 'MISSING')
    assert.equal(baseline.approved, true)
    assert.equal(baseline.optional_degradations.length, 1)
  })

  it('optional MCP degradation does not block', () => {
    const baseline = runBaseline({
      task: task('inspect code'),
      repoRoot: process.cwd(),
      inventory: {},
      mcpProfile: {
        ...baseProfile(),
        required_tools: [],
        optional_tools: [{ name: 'github', server: 'github-server' }],
      },
    })
    assert.equal(baseline.approved, true)
  })

  it('happy path: all required capabilities pass → approved', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-preflight-ok-'))
    const baseline = runBaseline({
      task: task('implement a small deterministic helper function'),
      repoRoot: root,
      plan: { build_scope: { files: ['src/a.mjs'] } },
    })
    assert.equal(baseline.approved, true)
    assert.equal(baseline.required_capabilities.filesystem, 'PASS')
    assert.equal(baseline.required_capabilities.write, 'PASS')
    await fs.rm(root, { recursive: true, force: true })
  })
})
