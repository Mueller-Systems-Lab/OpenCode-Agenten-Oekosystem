import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { repoRoot, runNodeScript } from '../helpers.mjs'

const manifestPath = path.join(repoRoot, 'bootstrap', 'manifest.json')

async function createIsolatedTarget(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-product-realignment-home-'))
  const target = path.join(home, 'project')
  await fs.mkdir(target)
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  return {
    home,
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

test('canonical manifest publishes the URL-installable product boundary', async () => {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  assert.equal(manifest.product_contract?.invariant, 'OCAE_IS_AN_OPENCODE_URL_INSTALLABLE_AGENT_ECOSYSTEM')
  assert.equal(manifest.product_contract?.host, 'OPENCODE')
  assert.ok(manifest.product_contract?.artifact_classes?.installable_product_runtime?.length)
  assert.ok(manifest.product_contract?.artifact_classes?.installable_harness_profiles?.includes('.agent-governance/runtime/harness/product-model-harness-profiles.mjs'))
  assert.ok(manifest.product_contract?.artifact_classes?.evaluation_only?.includes('runtime/harness/evaluation.mjs'))
  assert.ok(manifest.product_contract?.artifact_classes?.local_developer_state?.includes('.opencode/memory/**'))
})

test('fresh install excludes evaluation machinery and reports capability status', async (t) => {
  const { target, env } = await createIsolatedTarget(t)
  const result = install(target, env)
  assert.equal(result.status, 0, result.stderr || result.stdout)

  const installation = JSON.parse(await fs.readFile(path.join(target, '.opencode', 'ecosystem-installation.json'), 'utf8'))
  const installedManifest = JSON.parse(await fs.readFile(path.join(target, '.agent-governance', 'manifest.json'), 'utf8'))
  const verification = JSON.parse((runNodeScript('bootstrap/verify.mjs', ['--target', target, '--json'], { env })).stdout)

  assert.equal(installedManifest.product_contract?.invariant, 'OCAE_IS_AN_OPENCODE_URL_INSTALLABLE_AGENT_ECOSYSTEM')
  assert.equal(installedManifest.product_contract?.host, 'OPENCODE')
  assert.ok(installation.installed_harness_profiles?.includes('generic.v1'))
  assert.equal(await fs.stat(path.join(target, '.agent-governance/runtime/harness/evaluation.mjs')).then(() => true).catch(() => false), false)
  assert.equal(await fs.stat(path.join(target, '.agent-governance/runtime/harness/model-harness-profiles.mjs')).then(() => true).catch(() => false), false)
  assert.equal(await fs.stat(path.join(target, '.agent-governance/runtime/harness/product-model-harness-profiles.mjs')).then(() => true).catch(() => false), true)
  assert.equal(verification.post_install_status?.core, 'CORE_READY')
  assert.ok(['PROVIDER_READY', 'PROVIDER_NOT_CONFIGURED'].includes(verification.post_install_status?.provider))
  assert.ok(['TOOLS_READY', 'TOOLS_NOT_CONFIGURED'].includes(verification.post_install_status?.tools))
  assert.ok(Array.isArray(verification.post_install_status?.blockers))
})

test('isolated OpenCode discovers installed OCAE agents without developer auth state', async (t) => {
  const { home, target, env } = await createIsolatedTarget(t)
  const result = install(target, env)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const agents = spawnSync('opencode', ['agent', 'list', '--pure'], { cwd: target, env, encoding: 'utf8', timeout: 15000 })
  assert.equal(agents.status, 0, agents.error?.message || agents.stderr || agents.stdout || 'OpenCode discovery exited without a status')
  for (const id of ['issue-orchestrator', 'review-agent', 'executor']) assert.match(agents.stdout, new RegExp(`^${id} \\((primary|subagent)\\)$`, 'm'))
  assert.equal(await fs.stat(path.join(home, '.local', 'share', 'opencode', 'auth.json')).then(() => true).catch(() => false), false)
})
