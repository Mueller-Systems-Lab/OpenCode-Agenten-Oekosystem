/**
 * RED TEST — redaction.mjs installed
 *
 * This test MUST FAIL before the installer fix because redaction.mjs
 * is currently not included in getRuntimeFileList().
 *
 * Desired behavior: After installation, .agent-governance/runtime/security/redaction.mjs
 * exists and is importable.
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
  return fs.mkdtemp(path.join(os.tmpdir(), 'gov-red-'));
}

async function installGovernance(target) {
  const approval = {
    version: '1.0.0', action: 'apply', runtime: 'opencode',
    scope: { branch: 'main', commit: 'abc', paths: [], repository: 'test', targetRoot: 'test' },
    riskTier: 'MEDIUM_REVIEW',
    contextFingerprint: 'a'.repeat(64),
    approvedBy: 'owner', approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    singleUse: true, nonce: `red-${Date.now()}`, status: 'APPROVED'
  };
  const approvalPath = path.join(target, 'approval.json');
  await fs.writeFile(approvalPath, JSON.stringify(approval), 'utf8');
  spawnSync('git', ['init'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });

  return runNodeScript(INSTALL_SCRIPT, [
    '--target', target, '--apply', '--approval-file', approvalPath, '--json'
  ], { cwd: repoRoot });
}

describe('RED TEST — redaction.mjs installed (pre-fix: expected FAIL)', () => {
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

  it('redaction.mjs is installed in runtime/security/', () => {
    const redactionPath = path.join(
      target, '.agent-governance', 'runtime', 'security', 'redaction.mjs'
    );
    assert.ok(
      existsSync(redactionPath),
      'redaction.mjs MUST be installed in .agent-governance/runtime/security/'
    );
  });

  it('installed redaction.mjs has real content', () => {
    const redactionPath = path.join(
      target, '.agent-governance', 'runtime', 'security', 'redaction.mjs'
    );
    const content = readFileSync(redactionPath, 'utf8');
    assert.ok(content.length > 500, 'redaction.mjs should contain actual code');
    assert.ok(
      content.includes('safeRedactText'),
      'redaction.mjs should export safeRedactText'
    );
    assert.ok(
      content.includes('secretValuesFromEnv'),
      'redaction.mjs should export secretValuesFromEnv'
    );
  });

  it('installed redaction.mjs is importable', async () => {
    const redactionPath = path.join(
      target, '.agent-governance', 'runtime', 'security', 'redaction.mjs'
    );
    const mod = await import(pathToFileURL(redactionPath).href);
    assert.ok(typeof mod.safeRedactText === 'function', 'safeRedactText must be a function');
    assert.ok(typeof mod.safeSerialize === 'function', 'safeSerialize must be a function');
    assert.ok(typeof mod.secretValuesFromEnv === 'function', 'secretValuesFromEnv must be a function');
  });
});
