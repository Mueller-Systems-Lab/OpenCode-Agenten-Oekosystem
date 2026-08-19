#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * OCAE Fresh-Install Sentinel.
 *
 * Proves, against a real isolated temporary target:
 *
 *   Installer Source
 *     ↓
 *   Fresh Target
 *     ↓
 *   Canonical Runtime Installed
 *     ↓
 *   Canonical Entry Resolvable
 *     ↓
 *   Runtime Canary Executes
 *     ↓
 *   No Legacy Execution Reachability
 *
 * Usage:
 *   node scripts/fresh-install-sentinel.mjs            # temp target, auto-cleanup
 *   node scripts/fresh-install-sentinel.mjs --keep     # keep the temp target for inspection
 *
 * The exported runFreshInstallSentinel() is reused by
 * test/install/fresh-install-sentinel.test.mjs so the proof stays reproducible.
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const FRESH_INSTALL_ARTIFACTS = Object.freeze({
  'run.mjs': '.agent-governance/runtime/run.mjs',
  contracts: '.agent-governance/runtime/contracts/index.mjs',
  controller: '.agent-governance/runtime/controller/controller.mjs',
  pipeline: '.agent-governance/runtime/pipeline/pipeline.mjs',
  baseline: '.agent-governance/runtime/baseline/capability-preflight.mjs',
  adapters: '.agent-governance/runtime/adapters/native-opencode.mjs',
  reviews: '.agent-governance/runtime/reviews/analyze.mjs',
  observability: '.agent-governance/runtime/observability/run-events.mjs',
  mcp_tool_grant: '.agent-governance/runtime/mcp/tool-grant.mjs',
  mcp_tool_executor: '.agent-governance/runtime/mcp/tool-executor.mjs',
  mcp_error_classifier: '.agent-governance/runtime/mcp/error-classifier.mjs',
  mcp_server_registry: '.agent-governance/runtime/mcp/server-registry.mjs',
  plugin: '.agent-governance/hooks/opencode/canonical-governance.mjs',
})

export async function runFreshInstallSentinel({ repoRoot, targetRoot, keep = false }) {
  const checks = {}
  const ok = (name) => { checks[name] = { status: 'PASS' } }
  const fail = (name, detail) => { checks[name] = { status: 'FAIL', detail } }

  // 1. Installer runs into the fresh target.
  const install = spawnSync(process.execPath, [
    path.join(repoRoot, 'scripts', 'install-governance.mjs'),
    '--target', targetRoot,
    '--apply',
    '--json',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (install.status === 0) ok('installer')
  else fail('installer', `exit ${install.status}: ${(install.stderr || install.stdout || '').slice(0, 600)}`)

  // 2. Canonical runtime artifacts installed.
  for (const [label, rel] of Object.entries(FRESH_INSTALL_ARTIFACTS)) {
    if (fsSync.existsSync(path.join(targetRoot, rel))) ok(`artifact_${label}`)
    else fail(`artifact_${label}`, `missing ${rel}`)
  }

  // 3. Canonical entry resolves (real module import probe).
  try {
    const runModule = await import(pathToFileURLFor(path.join(targetRoot, '.agent-governance', 'runtime', 'run.mjs')))
    const exported = ['enterRun', 'enterTask', 'runTask'].filter((name) => typeof runModule[name] === 'function')
    if (exported.length === 3) ok('entry_resolves')
    else fail('entry_resolves', `missing exports: ${['enterRun', 'enterTask', 'runTask'].filter((n) => !exported.includes(n)).join(', ')}`)
    checks.canary = await runCanary(targetRoot, runModule)
  } catch (error) {
    fail('entry_resolves', error instanceof Error ? error.message : String(error))
    checks.canary = { status: 'FAIL', detail: 'runtime could not be imported' }
  }

  // 4. No legacy execution reachability in the installed runtime.
  const legacyProbe = await probeLegacyExecution(targetRoot)
  for (const [label, result] of Object.entries(legacyProbe)) {
    checks[label] = result
  }

  const failed = Object.values(checks).some((entry) => entry.status === 'FAIL')
  return {
    status: failed ? 'FAIL' : 'PASS',
    checks,
    install: {
      exit_code: install.status,
      stdout_tail: (install.stdout || '').split('\n').slice(-5).join('\n').slice(0, 4000),
    },
  }
}

async function runCanary(targetRoot, runModule) {
  try {
    const result = await runModule.runTask({
      taskInput: { contract: 'ecosystem.task.v1', run_id: ' ', task: '', attempt: -1 },
      repoRoot: targetRoot,
    })
    if (result.phase === 'FAILED_ENTRY' && result.decision?.decision === 'BLOCKED' && result.decision?.reason_code === 'CONTRACT_INVALID') {
      return { status: 'PASS', detail: 'runTask executed; CONTRACT_INVALID abort verified' }
    }
    return { status: 'FAIL', detail: `unexpected canary result: phase=${result.phase} decision=${result.decision?.decision}` }
  } catch (error) {
    return { status: 'FAIL', detail: error instanceof Error ? error.message : String(error) }
  }
}

async function probeLegacyExecution(targetRoot) {
  const out = {}
  const runtimeDir = path.join(targetRoot, '.agent-governance', 'runtime')
  const legacyFiles = ['run-state.mjs', 'agent/start.mjs']
  const found = legacyFiles.filter((file) => fsSync.existsSync(path.join(runtimeDir, file)))
  if (found.length === 0) out.no_legacy_runtime_files = { status: 'PASS' }
  else out.no_legacy_runtime_files = { status: 'FAIL', detail: `legacy file installed: ${found.join(', ')}` }

  const pluginPath = path.join(targetRoot, '.agent-governance', 'hooks', 'opencode', 'canonical-governance.mjs')
  if (fsSync.existsSync(pluginPath)) {
    const pluginSource = fsSync.readFileSync(pluginPath, 'utf8')
    const legacyMarkers = ['startAgent', 'runLegacy', 'legacyRuntime', 'LEGACY_COMPATIBILITY_PATH', 'run-state.mjs', 'agent/start.mjs']
    const hits = legacyMarkers.filter((marker) => pluginSource.includes(marker))
    if (hits.length === 0 && pluginSource.includes('CANONICAL_RUNTIME_UNAVAILABLE')) {
      out.no_legacy_entry = { status: 'PASS' }
    } else {
      out.no_legacy_entry = { status: 'FAIL', detail: hits.length ? `legacy marker in plugin: ${hits.join(', ')}` : 'fail-fast reason missing' }
    }
  } else {
    out.no_legacy_entry = { status: 'FAIL', detail: 'installed plugin hook missing' }
  }

  // Installed manifest must not list legacy execution artifacts.
  const manifestPath = path.join(targetRoot, '.agent-governance', 'manifest.json')
  if (fsSync.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'))
      const files = manifest.files || []
      const legacyInManifest = files.filter((entry) => String(entry.dest || entry.path || '').includes('run-state') || String(entry.dest || entry.path || '').includes('agent/start'))
      if (legacyInManifest.length === 0) out.no_legacy_manifest = { status: 'PASS' }
      else out.no_legacy_manifest = { status: 'FAIL', detail: `legacy entry in installed manifest: ${JSON.stringify(legacyInManifest)}` }
    } catch (error) {
      out.no_legacy_manifest = { status: 'FAIL', detail: `manifest unreadable: ${error.message}` }
    }
  } else {
    out.no_legacy_manifest = { status: 'FAIL', detail: 'installed manifest missing' }
  }
  return out
}

function pathToFileURLFor(filePath) {
  return new URL(`file://${filePath.startsWith('/') ? '' : '/'}${filePath.split(path.sep).join('/')}`)
}

// CLI mode
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)))) {
  const keep = process.argv.includes('--keep')
  const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-fresh-install-'))
  try {
    const result = await runFreshInstallSentinel({ repoRoot, targetRoot, keep })
    console.log(JSON.stringify({ ...result, target_root: targetRoot }, null, 2))
    process.exitCode = result.status === 'PASS' ? 0 : 2
  } finally {
    if (!keep) await fs.rm(targetRoot, { recursive: true, force: true })
    else console.error(`Fresh-install target kept at: ${targetRoot}`)
  }
}
