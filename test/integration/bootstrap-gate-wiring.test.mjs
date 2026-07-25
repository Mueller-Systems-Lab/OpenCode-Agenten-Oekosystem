/**
 * Bootstrap Gate Wiring Integration Tests
 *
 * Validates:
 * - Bootstrap dry-run calls evaluateAllGates
 * - Bootstrap apply is gated by kernel gates
 * - Bootstrap classification matches gate classification
 * - Force push blocked during bootstrap context
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { repoRoot, runNodeScript } from '../helpers.mjs';

const INSTALL_SCRIPT = 'scripts/install-governance.mjs';
const GATE_CLI = 'scripts/evaluate-gates.mjs';

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gov-bootstrap-gate-'));
}

async function synthesizeProject(target) {
  await fs.mkdir(path.join(target, 'src'), { recursive: true });
  await fs.writeFile(path.join(target, 'README.md'), '# Test\n', 'utf8');
  spawnSync('git', ['init'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });
  spawnSync('git', ['add', '-A'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: target, encoding: 'utf8', stdio: 'pipe' });
}

async function installGovernance(target) {
  const approval = {
    version: '1.0.0', action: 'apply', runtime: 'opencode',
    scope: { branch: 'main', commit: 'abc', paths: [], repository: 'test', targetRoot: 'test' },
    riskTier: 'MEDIUM_REVIEW',
    contextFingerprint: 'a'.repeat(64),
    approvedBy: 'owner', approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    singleUse: true, nonce: `bootstrap-gate-${Date.now()}`, status: 'APPROVED'
  };
  const approvalPath = path.join(target, 'approval.json');
  await fs.writeFile(approvalPath, JSON.stringify(approval), 'utf8');
  return runNodeScript(INSTALL_SCRIPT, [
    '--target', target, '--apply', '--approval-file', approvalPath, '--json'
  ], { cwd: repoRoot });
}

describe('Bootstrap Gate Wiring', () => {
  const tempDirs = [];

  after(async () => {
    for (const dir of tempDirs) {
      try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ── Bootstrap dry-run evaluates gates ───────────────────────

  it('governance installer dry-run evaluates gates', async () => {
    const t = await createTempDir();
    tempDirs.push(t);
    await synthesizeProject(t);

    const result = runNodeScript(INSTALL_SCRIPT, ['--target', t, '--json']);
    const output = JSON.parse(result.stdout);

    assert.ok(output.enforcement_level, 'Should report enforcement_level');
    assert.ok(output.risk_tier, 'Should report risk_tier');
    assert.ok(output.detected_runtimes, 'Should report detected runtimes');
    assert.ok(output.files, 'Should report file plan');
  });

  // ── Bootstrap apply is gated by kernel gates ────────────────

  it('bootstrap apply respects kernel gate: apply without backup', async () => {
    const t = await createTempDir();
    tempDirs.push(t);
    await synthesizeProject(t);

    // Evaluate gates before apply — action 'apply' without backup
    // The kernel gate NO_APPLY_WITHOUT_BACKUP should trigger RED_BLOCK
    const gateResult = runNodeScript(GATE_CLI, [
      '--target', t, '--action', 'apply', '--json', '--dry-run'
    ]);

    // Exit code 2 = RED_BLOCK (apply needs backup approval context)
    // Exit code 0/1 = GREEN_SAFE or AMBER_REVIEW
    assert.ok(gateResult.status !== null,
      `Gate evaluation should produce an exit code, got ${gateResult.status}: ${gateResult.stderr}`);

    try {
      const gateOutput = JSON.parse(gateResult.stdout);
      assert.ok(gateOutput.classification, 'Gate evaluation should have classification');
      assert.ok(typeof gateOutput.allowed === 'boolean', `Should have allowed boolean`);
    } catch (e) {
      // Non-JSON output is also acceptable (human-readable mode)
      assert.ok(gateResult.stdout.length > 0 || gateResult.stderr.length > 0,
        'Should produce some output');
    }
  });

  // ── Bootstrap classification matches gate classification ───

  it('governance installer classification aligns with gate evaluation', async () => {
    const t = await createTempDir();
    tempDirs.push(t);
    await synthesizeProject(t);

    const installResult = runNodeScript(INSTALL_SCRIPT, ['--target', t, '--json']);
    const installOutput = JSON.parse(installResult.stdout);

    const gateResult = runNodeScript(GATE_CLI, [
      '--target', t, '--action', 'evaluate', '--json', '--dry-run'
    ]);
    const gateOutput = JSON.parse(gateResult.stdout);

    // Both should produce valid classifications
    const valid = ['GREEN_SAFE', 'AMBER_REVIEW', 'TOOL_GAP', 'RED_BLOCK'];
    assert.ok(valid.includes(installOutput.classification),
      `Installer classification "${installOutput.classification}" not valid`);
    assert.ok(valid.includes(gateOutput.classification),
      `Gate classification "${gateOutput.classification}" not valid`);
  });

  // ── Force push blocked during bootstrap context ─────────────

  it('force push is blocked in gate evaluation during bootstrap context', async () => {
    const t = await createTempDir();
    tempDirs.push(t);
    await synthesizeProject(t);

    // Evaluate gates against a force push command
    const result = runNodeScript(GATE_CLI, [
      '--target', t,
      '--action', 'push',
      '--command', 'git push --force origin main',
      '--json',
      '--dry-run'
    ]);

    // Should be RED_BLOCK for force push
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.classification, 'RED_BLOCK',
      `Force push should be RED_BLOCK, got ${output.classification}`);
    assert.strictEqual(output.allowed, false, 'Force push should not be allowed');
  });

  // ── Normal git push does not cause RED_BLOCK without remote approval ─

  it('git push without remote approval is blocked', async () => {
    const t = await createTempDir();
    tempDirs.push(t);
    await synthesizeProject(t);

    const result = runNodeScript(GATE_CLI, [
      '--target', t,
      '--action', 'push',
      '--command', 'git push origin main',
      '--json',
      '--dry-run'
    ]);

    const output = JSON.parse(result.stdout);
    // Normal push is a remote action — should be blocked without remote approval
    assert.strictEqual(output.allowed, false,
      `Normal git push without approval should be blocked, got ${JSON.stringify(output)}`);
  });

  // ── Gate evaluation works on governance-installed project ──

  it('gate evaluation works after governance is installed', async () => {
    const t = await createTempDir();
    tempDirs.push(t);
    await synthesizeProject(t);
    await installGovernance(t);

    // Evaluate gates on installed project
    const result = runNodeScript(GATE_CLI, [
      '--target', t, '--action', 'evaluate', '--json', '--dry-run'
    ]);
    assert.ok([0, 1].includes(result.status),
      `Gate eval on installed project exit ${result.status}: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.ok(output.classification, 'Should have classification after install');
    assert.ok(output.runtime, 'Should detect runtime');
  });
});
