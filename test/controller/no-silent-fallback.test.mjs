// SPDX-License-Identifier: MIT
/**
 * No-Silent-Fallback regression tests.
 *
 * Central invariant:
 *
 *   CANONICAL_RUNTIME_FAILURE
 *   MUST NEVER
 *   INVOKE LEGACY_EXECUTION
 *
 * After the legacy-compatibility retirement the canonical contract-first
 * runtime is the ONLY executable standard path. If the canonical runtime
 * cannot be entered — unavailable, import failure, initialization failure,
 * contract failure at entry — execution FAILS FAST and remains observable.
 * legacy_fallback_used is always false.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { repoRoot, runNodeScript } from '../helpers.mjs'

const PLUGIN_SOURCE = path.join(repoRoot, '.opencode', 'plugins', 'canonical-governance.mjs')
const INSTALLER_SOURCE = path.join(repoRoot, 'scripts', 'install-governance.mjs')

async function makeTarget(prefix = 'ocae-nosfb-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  spawnSync('git', ['init', '--initial-branch=master'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'nosfb@example.invalid'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'No Sfb'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: root, stdio: 'ignore' })
  return root
}

async function installGovernance(root) {
  const install = runNodeScript('scripts/install-governance.mjs', ['--target', root, '--apply', '--json'])
  assert.equal(install.status, 0, install.stderr || install.stdout)
}

async function loadInstalledPlugin(root) {
  const pluginPath = path.join(root, '.agent-governance', 'hooks', 'opencode', 'canonical-governance.mjs')
  const plugin = await import(pathToFileURL(pluginPath).href)
  return plugin.default({ directory: root, worktree: root })
}

function invokeChatMessage(hooks, sessionId, messageId, text) {
  return hooks['chat.message'](
    { sessionID: sessionId, messageID: messageId },
    { message: { role: 'user', id: messageId, sessionID: sessionId }, parts: [{ type: 'text', text }] },
  )
}

describe('no silent fallback — canonical runtime is mandatory', () => {
  it('canonical entry does not reference legacy execution (structural)', async () => {
    const plugin = await fs.readFile(PLUGIN_SOURCE, 'utf8')
    const installer = await fs.readFile(INSTALLER_SOURCE, 'utf8')
    assert.match(plugin, /CANONICAL_RUNTIME_UNAVAILABLE/, 'fail-fast reason must be present in the canonical entry')
    assert.doesNotMatch(plugin, /Legacy compatibility[\s\S]*LEGACY_COMPATIBILITY_PATH/, 'silent legacy fallback catch must be gone')
    assert.match(installer, /CANONICAL_RUNTIME_UNAVAILABLE/, 'installed-hook template must be fail-fast')
    assert.doesNotMatch(plugin, /run-state\.mjs/, 'normal plugin entry must not import legacy run-state')
    assert.doesNotMatch(plugin, /agent\/start\.mjs/, 'normal plugin entry must not import legacy startAgent')
  })

  it('RUNTIME_MISSING: runtime module unavailable → fail fast, no fallback', async (t) => {
    const root = await makeTarget()
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    await installGovernance(root)
    const runMjs = path.join(root, '.agent-governance', 'runtime', 'run.mjs')
    const moved = path.join(root, '.agent-governance', 'runtime', 'run.mjs.disabled')
    await fs.rename(runMjs, moved)
    try {
      const hooks = await loadInstalledPlugin(root)
      await assert.rejects(
        () => invokeChatMessage(hooks, 'nosfb-missing-session', 'nosfb-missing-msg', 'Implement add(a, b).'),
        /CANONICAL_RUNTIME_UNAVAILABLE/,
      )
      const runContextExists = await fs.access(path.join(root, '.agent-governance', 'runtime', 'run-context.json')).then(() => true).catch(() => false)
      assert.equal(runContextExists, false, 'no silent run-context creation')
      const evidenceDir = path.join(root, '.agent-governance', 'evidence')
      const records = (await fs.readdir(evidenceDir)).filter((name) => name.startsWith('runtime-entry-failure-'))
      assert.ok(records.length >= 1, 'expected a runtime-entry-failure observability record')
      const record = JSON.parse(await fs.readFile(path.join(evidenceDir, records[0]), 'utf8'))
      assert.equal(record.entry_source, 'plugin:chat.message')
      assert.equal(record.runtime_availability, 'IMPORT_FAILURE')
      assert.equal(record.failure_reason, 'CANONICAL_RUNTIME_UNAVAILABLE')
      assert.equal(record.fallback_attempted, false)
      assert.ok(record.timestamp, 'timestamp must be recorded')
    } finally {
      await fs.rename(moved, runMjs).catch(() => {})
    }
  })

  it('RUNTIME_IMPORT_FAILURE: runtime module exists but fails to load → explicit failure, no fallback', async (t) => {
    const root = await makeTarget()
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    await installGovernance(root)
    const runMjs = path.join(root, '.agent-governance', 'runtime', 'run.mjs')
    await fs.writeFile(runMjs, 'export const broken = => {\n', 'utf8')
    const hooks = await loadInstalledPlugin(root)
    await assert.rejects(
      () => invokeChatMessage(hooks, 'nosfb-import-session', 'nosfb-import-msg', 'Implement add(a, b).'),
      /CANONICAL_RUNTIME_UNAVAILABLE/,
    )
    const runContextExists = await fs.access(path.join(root, '.agent-governance', 'runtime', 'run-context.json')).then(() => true).catch(() => false)
    assert.equal(runContextExists, false, 'no silent run-context creation')
  })

  it('INVALID_CONTRACT: invalid entry contract → CONTRACT_INVALID, never legacy', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-nosfb-invalid-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const { runTask } = await import('../../runtime/run.mjs')
    const result = await runTask({
      taskInput: { contract: 'ecosystem.task.v1', run_id: '   ', task: '', attempt: -1 },
      repoRoot: root,
    })
    assert.equal(result.phase, 'FAILED_ENTRY')
    assert.equal(result.decision.decision, 'BLOCKED')
    assert.equal(result.decision.reason_code, 'CONTRACT_INVALID')
    assert.equal(result.decision.first_bad_boundary, 'TASK')
  })

  it('BYPASS: legacy run-state/startAgent are not installed and not reachable from the canonical entry', async () => {
    const { getRuntimeFileList } = await import('../../scripts/install-governance.mjs')
    const installed = getRuntimeFileList().map((entry) => entry.dest)
    assert.ok(installed.includes('run.mjs'), 'canonical run.mjs must be installed')
    assert.equal(installed.some((entry) => entry.includes('run-state')), false, 'legacy run-state must not be installed')
    assert.equal(installed.some((entry) => entry.includes('agent/start')), false, 'legacy startAgent must not be installed')
  })
})
