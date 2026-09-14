/**
 * Swarm packaging drift tests (T2).
 *
 * Guards the T1 finding: the canonical Blackboard skill tree under
 * `.agents/skills/coordinate-blackboard-swarm/` must be part of the built
 * wheel payload AND must be materialized into install targets by the
 * canonical installer. Fails fast on either drift direction:
 *
 * 1. A canonical skill file exists in source but is absent from the built
 *    payload (`build_backend._payload_files()` — the exact list the payload
 *    manifest and archive are derived from).
 * 2. A fresh `install-governance.mjs --apply` target is missing any
 *    mechanically derived swarm runtime file.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { repoRoot } from '../helpers.mjs'

const SKILL_ROOT = path.join(repoRoot, '.agents', 'skills', 'coordinate-blackboard-swarm')

async function canonicalSkillFiles() {
  const files = []
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (entry.name === '__pycache__') continue
        await walk(absolute)
        continue
      }
      if (!entry.isFile() || entry.name.endsWith('.pyc')) continue
      files.push(path.relative(repoRoot, absolute).split(path.sep).join('/'))
    }
  }
  await walk(SKILL_ROOT)
  return files.sort()
}

function payloadFiles() {
  const probe = spawnSync('python3', ['-c', 'import build_backend, json; print(json.dumps(build_backend._payload_files()))'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  })
  assert.equal(probe.status, 0, probe.stderr || 'payload file probe failed')
  return JSON.parse(probe.stdout)
}

async function createIsolatedTarget(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-swarm-drift-home-'))
  const target = path.join(home, 'project')
  await fs.mkdir(target)
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  return {
    target,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, 'xdg-config'),
      XDG_DATA_HOME: path.join(home, 'xdg-data'),
      XDG_CACHE_HOME: path.join(home, 'xdg-cache'),
      OPENCODE_DISABLE_MODELS_FETCH: '1',
    },
  }
}

function install(target, env) {
  return spawnSync(process.execPath, [
    path.join(repoRoot, 'scripts', 'install-governance.mjs'),
    '--target', target,
    '--apply',
    '--json',
  ], { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
}

test('payload covers every canonical Blackboard skill file', async () => {
  const canonical = await canonicalSkillFiles()
  assert.ok(canonical.length >= 7, `expected at least 7 canonical skill files, got ${canonical.length}`)
  const payload = new Set(payloadFiles())
  const missing = canonical.filter((relative) => !payload.has(relative))
  assert.deepEqual(missing, [], `canonical skill files absent from built payload: ${missing.join(', ')}`)
})

test('fresh install materializes the derived swarm runtime byte-identical', async (t) => {
  const { target, env } = await createIsolatedTarget(t)
  const result = install(target, env)
  assert.equal(result.status, 0, result.stderr || result.stdout)

  const { getSwarmFileList } = await import('../../scripts/install-governance.mjs')
  const derived = getSwarmFileList()
  assert.ok(derived.length >= 7, `expected at least 7 derived swarm files, got ${derived.length}`)
  for (const { source, dest } of derived) {
    const installed = path.join(target, ...dest.split('/'))
    const stat = await fs.stat(installed).catch(() => null)
    assert.ok(stat?.isFile(), `derived swarm file missing in target: ${dest}`)
    const expected = await fs.readFile(path.join(repoRoot, ...source.split('/')), 'utf8')
    const actual = await fs.readFile(installed, 'utf8')
    assert.equal(actual, expected, `derived swarm file differs from canonical source: ${dest}`)
  }

  // Engine resolution anchor: swarm.ts candidate #2 must resolve in the target.
  const engine = path.join(target, '.agents', 'skills', 'coordinate-blackboard-swarm', 'scripts', 'blackboard.py')
  assert.ok((await fs.stat(engine).catch(() => null))?.isFile(), 'blackboard.py engine missing at canonical target path')

  // Source lock binds the derived files.
  const lock = JSON.parse(await fs.readFile(path.join(target, '.agent-governance', 'source-lock.json'), 'utf8'))
  const kinds = new Set(lock.files.map((entry) => entry.kind))
  assert.ok(kinds.has('swarm_runtime'), 'source-lock.json has no swarm_runtime entries')
})

test('second apply with swarm runtime stays NOOP_IDEMPOTENT', async (t) => {
  const { target, env } = await createIsolatedTarget(t)
  const first = install(target, env)
  assert.equal(first.status, 0, first.stderr || first.stdout)
  const second = install(target, env)
  assert.equal(second.status, 0, second.stderr || second.stdout)
  const parsed = JSON.parse(second.stdout)
  assert.equal(parsed.mode, 'NOOP_IDEMPOTENT', `expected NOOP_IDEMPOTENT, got ${parsed.mode}`)
})
