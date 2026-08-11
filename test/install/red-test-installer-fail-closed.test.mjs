/**
 * RED TEST — Installer fail-closed on missing redaction.mjs
 *
 * This test MUST FAIL before the fix because the installer currently
 * reports GREEN_SAFE even when redaction.mjs would be missing from the
 * resident runtime.
 *
 * Desired behavior: When redaction.mjs is removed from the source tree
 * (before installation), the installer must report a non-GREEN classification
 * and return a non-zero exit code. GREEN_SAFE must only be returned when
 * ALL runtime files are present and importable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repoRoot, runNodeScript } from '../helpers.mjs';

const INSTALL_SCRIPT = 'scripts/install-governance.mjs';

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gov-fc-'));
}

describe('RED TEST — Installer fail-closed (pre-fix: expected FAIL)', () => {
  it('installer includes redaction.mjs in runtime file list', async () => {
    const target = await createTempDir();
    await fs.mkdir(path.join(target, 'src'), { recursive: true });
    await fs.writeFile(path.join(target, 'README.md'), '# Test\n', 'utf8');
    spawnSync('git', ['init'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });

    const approval = {
      version: '1.0.0', action: 'apply', runtime: 'opencode',
      scope: { branch: 'main', commit: 'abc', paths: [], repository: 'test', targetRoot: 'test' },
      riskTier: 'MEDIUM_REVIEW',
      contextFingerprint: 'a'.repeat(64),
      approvedBy: 'owner', approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      singleUse: true, nonce: `fc-${Date.now()}`, status: 'APPROVED'
    };
    const approvalPath = path.join(target, 'approval.json');
    await fs.writeFile(approvalPath, JSON.stringify(approval), 'utf8');

    // Run the installer — after the fix, it should include redaction.mjs
    const result = runNodeScript(INSTALL_SCRIPT, [
      '--target', target, '--apply', '--approval-file', approvalPath, '--json'
    ], { cwd: repoRoot });

    // After the fix: installer correctly reports GREEN because all files are present
    let classification = 'UNKNOWN';
    let exitCode = result.status;
    try {
      const parsed = JSON.parse(result.stdout);
      classification = parsed.classification || 'UNKNOWN';
    } catch { /* not JSON */ }

    // Verify installer succeeds (GREEN) when all files are present
    assert.strictEqual(
      exitCode, 0,
      `Installer must exit 0 when all runtime files are present. Got: ${exitCode}`
    );

    // Verify redaction.mjs is in the installed target
    const installedRedaction = path.join(
      target, '.agent-governance', 'runtime', 'security', 'redaction.mjs'
    );
    assert.ok(
      existsSync(installedRedaction),
      'redaction.mjs must be installed after the fix'
    );

    // Verify the source-lock includes security/redaction.mjs
    try {
      const output = JSON.parse(result.stdout);
      const files = output?.source_lock?.files || [];
      const redactionEntry = files.find(f => f.path === 'security/redaction.mjs');
      assert.ok(redactionEntry, 'source_lock must include security/redaction.mjs');
    } catch {
      assert.fail('Installer output must be valid JSON with source_lock');
    }
  });

  it('post-validation checks all installed runtime files are present', async () => {
    const target = await createTempDir();
    await fs.mkdir(path.join(target, 'src'), { recursive: true });
    await fs.writeFile(path.join(target, 'README.md'), '# Test\n', 'utf8');
    spawnSync('git', ['init'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });

    const approval = {
      version: '1.0.0', action: 'apply', runtime: 'opencode',
      scope: { branch: 'main', commit: 'abc', paths: [], repository: 'test', targetRoot: 'test' },
      riskTier: 'MEDIUM_REVIEW',
      contextFingerprint: 'a'.repeat(64),
      approvedBy: 'owner', approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      singleUse: true, nonce: `fc2-${Date.now()}`, status: 'APPROVED'
    };
    const approvalPath = path.join(target, 'approval.json');
    await fs.writeFile(approvalPath, JSON.stringify(approval), 'utf8');

    const result = runNodeScript(INSTALL_SCRIPT, [
      '--target', target, '--apply', '--approval-file', approvalPath, '--json'
    ], { cwd: repoRoot });

    // After installation, verify ALL expected runtime files exist
    const expectedFiles = [
      '.agent-governance/runtime/gates/evaluate-all.mjs',
      '.agent-governance/runtime/gates/kernel.mjs',
      '.agent-governance/runtime/gates/policy.mjs',
      '.agent-governance/runtime/gates/decision.mjs',
      '.agent-governance/runtime/gates/approval.mjs',
      '.agent-governance/runtime/gates/evidence.mjs',
      '.agent-governance/runtime/gates/classifications.mjs',
      '.agent-governance/runtime/gates/errors.mjs',
      '.agent-governance/runtime/gates/context-fingerprint.mjs',
      '.agent-governance/runtime/runtimes/contract.mjs',
      '.agent-governance/runtime/runtimes/generic.mjs',
      '.agent-governance/runtime/runtimes/opencode.mjs',
      '.agent-governance/runtime/runtimes/hermes.mjs',
      '.agent-governance/runtime/runtimes/odysseus.mjs',
      // THIS IS THE KEY FILE — currently not installed before the fix
      '.agent-governance/runtime/security/redaction.mjs',
    ];

    for (const relPath of expectedFiles) {
      const absPath = path.join(target, relPath);
      assert.ok(
        existsSync(absPath),
        `Runtime file ${relPath} must be installed`
      );
    }
  });

  it('post-validation verifies runtime imports are resolvable', async () => {
    const target = await createTempDir();
    await fs.mkdir(path.join(target, 'src'), { recursive: true });
    await fs.writeFile(path.join(target, 'README.md'), '# Test\n', 'utf8');
    spawnSync('git', ['init'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });

    const approval = {
      version: '1.0.0', action: 'apply', runtime: 'opencode',
      scope: { branch: 'main', commit: 'abc', paths: [], repository: 'test', targetRoot: 'test' },
      riskTier: 'MEDIUM_REVIEW',
      contextFingerprint: 'a'.repeat(64),
      approvedBy: 'owner', approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      singleUse: true, nonce: `fc3-${Date.now()}`, status: 'APPROVED'
    };
    const approvalPath = path.join(target, 'approval.json');
    await fs.writeFile(approvalPath, JSON.stringify(approval), 'utf8');

    const result = runNodeScript(INSTALL_SCRIPT, [
      '--target', target, '--apply', '--approval-file', approvalPath, '--json'
    ], { cwd: repoRoot });

    // PRE-FIX: This import fails with ERR_MODULE_NOT_FOUND
    const evalAllPath = path.join(
      target, '.agent-governance', 'runtime', 'gates', 'evaluate-all.mjs'
    );

    await assert.doesNotReject(
      import(pathToFileURL(evalAllPath).href),
      /ERR_MODULE_NOT_FOUND/,
      'Installed evaluate-all.mjs must import all transitive dependencies without ERR_MODULE_NOT_FOUND'
    );
  });
});
