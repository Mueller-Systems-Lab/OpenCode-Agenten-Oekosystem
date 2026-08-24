/**
 * Resident Runtime Tests
 *
 * Validates:
 * - .agent-governance/runtime/evaluate-all.mjs works from installed location
 * - .agent-governance/bin/evaluate.mjs runs and returns valid JSON
 * - Kernel gates work from installed copy
 * - Runtime detection works from installed copy
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repoRoot, runNodeScript } from '../helpers.mjs';

const INSTALL_SCRIPT = 'scripts/install-governance.mjs';

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gov-resident-'));
}

async function installGovernance(target) {
  const approval = {
    version: '1.0.0', action: 'apply', runtime: 'opencode',
    scope: { branch: 'main', commit: 'abc', paths: [], repository: 'test', targetRoot: 'test' },
    riskTier: 'MEDIUM_REVIEW',
    contextFingerprint: 'a'.repeat(64),
    approvedBy: 'owner', approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    singleUse: true, nonce: `resident-${Date.now()}`, status: 'APPROVED'
  };
  const approvalPath = path.join(target, 'approval.json');
  await fs.writeFile(approvalPath, JSON.stringify(approval), 'utf8');

  // Initialize git if possible
  spawnSync('git', ['init'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });

  const result = runNodeScript(INSTALL_SCRIPT, [
    '--target', target, '--apply', '--approval-file', approvalPath, '--json'
  ], { cwd: repoRoot });
  return { result, approvalPath };
}

describe('Resident Runtime', () => {
  const tempDirs = [];

  after(async () => {
    for (const dir of tempDirs) {
      try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  let target;

  before(async () => {
    target = await createTempDir();
    tempDirs.push(target);
    await fs.mkdir(path.join(target, 'src'), { recursive: true });
    await fs.writeFile(path.join(target, 'README.md'), '# Test\n', 'utf8');
    await installGovernance(target);
  });

  // ── evaluate-all.mjs works from installed location ──────────

  it('evaluate-all.mjs is installed as a file', async () => {
    const evalAllPath = path.join(target, '.agent-governance', 'runtime', 'gates', 'evaluate-all.mjs');
    assert.ok(existsSync(evalAllPath), 'evaluate-all.mjs should be installed in runtime/gates/');

    // Runtime preserves gates/ and runtimes/ subdirectory structure
    // so that ../runtimes/imports resolve correctly
    const content = readFileSync(evalAllPath, 'utf8');
    assert.ok(content.includes('evaluateAllGates'), 'Should contain evaluateAllGates');
    assert.ok(content.includes('export'), 'Should contain exports');
  });

  it('installed command classifier preserves native shell compatibility', async () => {
    const classifierPath = path.join(target, '.agent-governance', 'runtime', 'gates', 'command-effect-classifier.mjs');
    assert.ok(existsSync(classifierPath), 'command-effect-classifier.mjs should be installed');
    const classifier = await import(pathToFileURL(classifierPath).href);
    assert.equal(classifier.classifyCommand('git status').effect_class, 'LOCAL_GIT_READ');
    assert.equal(classifier.classifyCommand('pnpm build').effect_class, 'LOCAL_BUILD');
    assert.equal(classifier.classifyCommand('git status; git push').governance_effect, 'PUSH');
    const realityRefresh = classifier.classifyCommand('git fetch origin --prune; git status --short; git branch --show-current; git rev-parse HEAD; git rev-parse origin/master');
    assert.equal(classifier.isColdNetworkRead(realityRefresh), true);

    const evaluatePath = path.join(target, '.agent-governance', 'runtime', 'gates', 'evaluate-action.mjs');
    const evaluate = await import(pathToFileURL(evaluatePath).href);
    const result = await evaluate.evaluateAction({ tool: 'bash', command: realityRefresh.command, runtime: 'opencode' });
    assert.equal(result.allowed, true);
    assert.equal(result.task_id, 'cold-network-read');
  });

  // ── bin/evaluate.mjs runs and returns valid JSON ────────────

  it('bin/evaluate.mjs runs and returns valid JSON', async () => {
    const evalBinPath = path.join(target, '.agent-governance', 'bin', 'evaluate.mjs');
    assert.ok(existsSync(evalBinPath), 'bin/evaluate.mjs should exist');

    const result = spawnSync(process.execPath, [evalBinPath, '--target', target, '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024,
    });

    // The key assertion: bin/evaluate.mjs must not crash with ERR_MODULE_NOT_FOUND
    // A non-zero exit for AMBER_REVIEW is legitimate (not a crash)
    // Crashes produce status null (signal) or status > 128
    assert.ok(
      result.status !== null,
      'bin/evaluate.mjs must not be terminated by a signal (crash)'
    );

    // Verify stderr does NOT contain ERR_MODULE_NOT_FOUND
    const stderr = result.stderr || '';
    assert.ok(
      !stderr.includes('ERR_MODULE_NOT_FOUND'),
      `bin/evaluate.mjs must not have import errors. stderr: ${stderr.slice(0, 200)}`
    );

    // Verify stdout is valid JSON (regardless of exit code)
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (e) {
      assert.fail(
        `bin/evaluate.mjs must produce valid JSON on stdout. ` +
        `Parse error: ${e.message}. Raw stdout: ${result.stdout?.slice(0, 200)}`
      );
    }

    assert.ok(parsed.classification, 'Must include classification field');
    // Reaching here proves the import chain is intact (no ERR_MODULE_NOT_FOUND)
  });

  // ── Kernel gates work from installed copy ──────────────────

  it('kernel gates are evaluable from installed copy', async () => {
    const kernelPath = path.join(target, '.agent-governance', 'runtime', 'gates', 'kernel.mjs');
    assert.ok(existsSync(kernelPath), 'kernel.mjs should be installed in runtime/gates/');

    const mod = await import(pathToFileURL(kernelPath).href);
    assert.ok(typeof mod.evaluateKernelGates === 'function', 'evaluateKernelGates should export');
    assert.ok(typeof mod.getKernelGates === 'function', 'getKernelGates should export');
    assert.ok(typeof mod.isKernelGate === 'function', 'isKernelGate should export');

    // Verify 19 kernel gates
    const gates = mod.getKernelGates();
    assert.strictEqual(gates.length, 19, `Expected 19 kernel gates, got ${gates.length}`);

    // Verify a kernel gate works
    const result = mod.evaluateKernelGates({ command: 'git push --force origin main' });
    assert.strictEqual(result.allowed, false, 'Force push should be blocked');
    assert.strictEqual(result.classification, mod.CLASSIFICATIONS?.RED_BLOCK || 'RED_BLOCK');
  });

  // ── Runtime detection files are installed ─────────────

  it('runtime adapter files are installed', async () => {
    const runtimesDir = path.join(target, '.agent-governance', 'runtime', 'runtimes');
    const expectedAdapters = ['contract.mjs', 'generic.mjs', 'opencode.mjs', 'hermes.mjs', 'odysseus.mjs'];
    for (const file of expectedAdapters) {
      const fp = path.join(runtimesDir, file);
      assert.ok(existsSync(fp), `Runtime adapter ${file} should be installed in runtime/runtimes/`);

      // Verify it's a real file with content
      const content = readFileSync(fp, 'utf8');
      assert.ok(content.length > 100, `${file} should have content`);
    }
  });

  // ── Security/redaction adapter is installed ─────────────

  it('redaction.mjs is installed and importable', async () => {
    const redactionPath = path.join(
      target, '.agent-governance', 'runtime', 'security', 'redaction.mjs'
    );
    assert.ok(existsSync(redactionPath), 'redaction.mjs must be installed');

    const mod = await import(pathToFileURL(redactionPath).href);
    assert.ok(typeof mod.safeRedactText === 'function', 'safeRedactText must be a function');
    assert.ok(typeof mod.safeSerialize === 'function', 'safeSerialize must be a function');
    assert.ok(typeof mod.secretValuesFromEnv === 'function', 'secretValuesFromEnv must be a function');
  });

  it('opencode adapter import chain is intact', async () => {
    const opencodePath = path.join(
      target, '.agent-governance', 'runtime', 'runtimes', 'opencode.mjs'
    );
    // This import should resolve without ERR_MODULE_NOT_FOUND
    // (it imports ../security/redaction.mjs which must be installed)
    const mod = await import(pathToFileURL(opencodePath).href);
    assert.strictEqual(mod.ADAPTER_ID, 'opencode', 'opencode adapter must identify itself');
    assert.ok(typeof mod.detect === 'function', 'detect must be a function');
  });

  it('evaluate-all.mjs imports all transitive dependencies', async () => {
    const evalAllPath = path.join(
      target, '.agent-governance', 'runtime', 'gates', 'evaluate-all.mjs'
    );
    // Full import chain: evaluate-all → runtimes/opencode → security/redaction
    const mod = await import(pathToFileURL(evalAllPath).href);
    assert.ok(typeof mod.evaluateAllGates === 'function', 'evaluateAllGates must export');
  });

  // ── Installed files match manifest ──────────────────────────

  it('manifest.json describes installed state accurately', async () => {
    const manifestPath = path.join(target, '.agent-governance', 'manifest.json');
    assert.ok(existsSync(manifestPath), 'manifest.json should exist');

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.version, '1.0.0');
    assert.strictEqual(manifest.name, 'canonical-agent-governance');
    assert.strictEqual(manifest.kernel_gates, 19);
    assert.ok(manifest.enforcement_level, 'should have enforcement_level');
  });

  // ── Policies are copied ──────────────────────────────────────

  it('policy files are installed', async () => {
    const policiesDir = path.join(target, '.agent-governance', 'policies');
    assert.ok(existsSync(policiesDir), 'policies/ should exist');

    const entries = await fs.readdir(policiesDir);
    assert.ok(entries.length >= 1, `Expected at least 1 policy file, got ${entries.length}`);
  });

  // ── Classifications module works from installed copy ───────

  it('classification resolution works from installed copy', async () => {
    const classificationsPath = path.join(target, '.agent-governance', 'runtime', 'gates', 'classifications.mjs');
    assert.ok(existsSync(classificationsPath), 'classifications.mjs should exist in runtime/gates/');

    const mod = await import(pathToFileURL(classificationsPath).href);
    assert.strictEqual(mod.CLASSIFICATIONS.RED_BLOCK, 'RED_BLOCK');
    assert.strictEqual(mod.CLASSIFICATIONS.GREEN_SAFE, 'GREEN_SAFE');

    // Test classificationToExitCode
    assert.strictEqual(mod.classificationToExitCode('GREEN_SAFE'), 0);
    assert.strictEqual(mod.classificationToExitCode('RED_BLOCK'), 2);
    assert.strictEqual(mod.classificationToExitCode('AMBER_REVIEW'), 1);
  });
});
