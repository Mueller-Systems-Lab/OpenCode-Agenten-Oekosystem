/**
 * RED TEST — Resident runtime imports correctly
 *
 * This test MUST FAIL before the fix because the installed
 * runtimes/opencode.mjs imports ../security/redaction.mjs which
 * does not exist in the installed target, causing ERR_MODULE_NOT_FOUND.
 *
 * Desired behavior: evaluate-all.mjs can be imported from the installed
 * location without any module resolution errors. All transitive imports
 * resolve correctly.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repoRoot, runNodeScript } from '../helpers.mjs';

const INSTALL_SCRIPT = 'scripts/install-governance.mjs';

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gov-res-'));
}

async function installGovernance(target) {
  const approval = {
    version: '1.0.0', action: 'apply', runtime: 'opencode',
    scope: { branch: 'main', commit: 'abc', paths: [], repository: 'test', targetRoot: 'test' },
    riskTier: 'MEDIUM_REVIEW',
    contextFingerprint: 'a'.repeat(64),
    approvedBy: 'owner', approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    singleUse: true, nonce: `res-${Date.now()}`, status: 'APPROVED'
  };
  const approvalPath = path.join(target, 'approval.json');
  await fs.writeFile(approvalPath, JSON.stringify(approval), 'utf8');
  spawnSync('git', ['init'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });

  return runNodeScript(INSTALL_SCRIPT, [
    '--target', target, '--apply', '--approval-file', approvalPath, '--json'
  ], { cwd: repoRoot });
}

describe('RED TEST — Resident runtime import (pre-fix: expected FAIL)', () => {
  const tempDirs = [];
  let target;

  before(async () => {
    target = await createTempDir();
    tempDirs.push(target);
    await fs.mkdir(path.join(target, 'src'), { recursive: true });
    await fs.writeFile(path.join(target, 'README.md'), '# Test\n', 'utf8');
    await installGovernance(target);
  });

  after(async () => {
    for (const dir of tempDirs) {
      try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it('evaluate-all.mjs imports without ERR_MODULE_NOT_FOUND', async () => {
    const evalAllPath = path.join(
      target, '.agent-governance', 'runtime', 'gates', 'evaluate-all.mjs'
    );

    // Dynamic import should resolve WITHOUT ERR_MODULE_NOT_FOUND
    await assert.doesNotReject(
      import(pathToFileURL(evalAllPath).href),
      /ERR_MODULE_NOT_FOUND/,
      'evaluate-all.mjs must import all its transitive dependencies'
    );
  });

  it('evaluate-all.mjs exports evaluateAllGates function', async () => {
    const evalAllPath = path.join(
      target, '.agent-governance', 'runtime', 'gates', 'evaluate-all.mjs'
    );
    const mod = await import(pathToFileURL(evalAllPath).href);
    assert.ok(
      typeof mod.evaluateAllGates === 'function',
      'evaluateAllGates must be a function export'
    );
  });

  it('opencode adapter imports without error', async () => {
    const opencodePath = path.join(
      target, '.agent-governance', 'runtime', 'runtimes', 'opencode.mjs'
    );
    const mod = await import(pathToFileURL(opencodePath).href);
    assert.ok(typeof mod.detect === 'function', 'opencode adapter must export detect');
    assert.strictEqual(mod.ADAPTER_ID, 'opencode');
  });

  it('evaluateAllGates returns a valid decision', async () => {
    const evalAllPath = path.join(
      target, '.agent-governance', 'runtime', 'gates', 'evaluate-all.mjs'
    );
    const mod = await import(pathToFileURL(evalAllPath).href);
    // evaluateAllGates works with or without a specific context
    // The key assertion: the function exists and does not throw
    assert.ok(typeof mod.evaluateAllGates === 'function', 'evaluateAllGates must be a function');

    // Call it and verify it returns something (not throws)
    const decision = mod.evaluateAllGates({
      command: 'git push --force origin main',
      repoRoot: target,
      targetRoot: target,
      repository: 'test/repo',
    });
    assert.ok(typeof decision === 'object' && decision !== null,
      'evaluateAllGates must return an object (or empty object for unmatchable inputs)');
  });
});
