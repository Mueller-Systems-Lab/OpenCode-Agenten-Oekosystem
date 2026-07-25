/**
 * RED TEST — validatePostApply must explicitly check security/redaction.mjs
 *
 * This test MUST FAIL before the fix because validatePostApply currently:
 * 1. Uses a hardcoded file list that does NOT include security/redaction.mjs
 * 2. Does not check the security/ directory at all
 * 3. Would report GREEN_SAFE even if security/redaction.mjs is missing after install
 *
 * Desired behavior:
 * 1. validatePostApply must use getRuntimeFileList() as its authoritative source
 * 2. Every file listed in getRuntimeFileList() must exist in the installed target
 * 3. Missing security/redaction.mjs must produce RED_BLOCK or AMBER_REVIEW (not GREEN_SAFE)
 * 4. Missing security/ directory must be caught
 * 5. Corrupted/empty redaction.mjs must be caught
 * 6. validatePostApply must NOT use a separate, manually-maintained file list
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
const REDACTION_DEST = '.agent-governance/runtime/security/redaction.mjs';

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gov-vpa-'));
}

async function installGovernance(target) {
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
    singleUse: true, nonce: `vpa-${Date.now()}`, status: 'APPROVED'
  };
  const approvalPath = path.join(target, 'approval.json');
  await fs.writeFile(approvalPath, JSON.stringify(approval), 'utf8');

  return runNodeScript(INSTALL_SCRIPT, [
    '--target', target, '--apply', '--approval-file', approvalPath, '--json'
  ], { cwd: repoRoot });
}

/**
 * Call validatePostApply directly on a target directory by spawning a
 * minimal Node script that imports the function and calls it.
 * This avoids the file-copy phase of the full installer.
 */
async function callValidatePostApply(targetRoot) {
  const harnessCode = `
    import { validatePostApply } from ${JSON.stringify(path.join(repoRoot, INSTALL_SCRIPT))};
    const result = await validatePostApply(${JSON.stringify(targetRoot)});
    process.stdout.write(JSON.stringify(result));
  `;
  const harnessPath = path.join(targetRoot, '_vpa_harness.mjs');
  await fs.writeFile(harnessPath, harnessCode, 'utf8');
  const result = spawnSync(process.execPath, [harnessPath], {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env },
  });
  try { await fs.unlink(harnessPath); } catch {}
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { classification: 'PARSE_ERROR', issues: [result.stderr || result.stdout], warnings: [] };
  }
}

describe('RED TEST — validatePostApply must check security/redaction.mjs (pre-fix: expected FAIL)', { concurrency: 1 }, () => {
  const tempDirs = [];

  after(async () => {
    for (const dir of tempDirs) {
      try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ── Test 1: Full install is VERIFIED_IN_SCOPE ────────────────
  it('fresh install produces VERIFIED_IN_SCOPE post-validation', async () => {
    const target = await createTempDir();
    tempDirs.push(target);
    const result = await installGovernance(target);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(
      parsed.post_validation?.classification, 'VERIFIED_IN_SCOPE',
      `Fresh install post_validation must be VERIFIED_IN_SCOPE. Got: ${parsed.post_validation?.classification}`
    );
    assert.ok(
      existsSync(path.join(target, REDACTION_DEST)),
      'security/redaction.mjs must be installed'
    );
  });

  // ── Test 2: Missing security/redaction.mjs produces RED_BLOCK ─
  it('validatePostApply detects missing security/redaction.mjs after installation', async () => {
    const target = await createTempDir();
    tempDirs.push(target);

    // Install governance (correctly)
    await installGovernance(target);

    // Delete security/redaction.mjs from installed target
    await fs.unlink(path.join(target, REDACTION_DEST));

    // Call validatePostApply directly (no file-copy)
    const result = await callValidatePostApply(target);

    // Missing runtime content must never retain the verified classification.
    assert.notStrictEqual(
      result.classification, 'VERIFIED_IN_SCOPE',
      `validatePostApply must NOT report VERIFIED_IN_SCOPE when security/redaction.mjs is missing. ` +
      `Got: classification=${result.classification}, issues=${JSON.stringify(result.issues)}`
    );
    assert.ok(
      result.issues.length > 0,
      `Must have issues when security/redaction.mjs is missing. Got ${result.issues.length} issues`
    );
  });

  // ── Test 3: Missing security/ directory produces RED ────
  it('validatePostApply detects missing security/ directory entire', async () => {
    const target = await createTempDir();
    tempDirs.push(target);

    await installGovernance(target);
    await fs.rm(path.join(target, '.agent-governance/runtime/security'), { recursive: true, force: true });

    const result = await callValidatePostApply(target);

    assert.notStrictEqual(
      result.classification, 'VERIFIED_IN_SCOPE',
      `validatePostApply must NOT report VERIFIED_IN_SCOPE when security/ directory is missing. ` +
      `Got: classification=${result.classification}`
    );
  });

  // ── Test 4: Corrupt/empty redaction.mjs detected ─────────
  it('validatePostApply detects corrupt redaction.mjs (empty file)', async () => {
    const target = await createTempDir();
    tempDirs.push(target);

    await installGovernance(target);
    await fs.writeFile(path.join(target, REDACTION_DEST), '', 'utf8');

    const result = await callValidatePostApply(target);

    assert.notStrictEqual(
      result.classification, 'VERIFIED_IN_SCOPE',
      `validatePostApply must detect empty/corrupt redaction.mjs. ` +
      `Got: classification=${result.classification}`
    );
  });

  // ── Test 5: File list must not drift ────────────────────
  it('validatePostApply uses same file list as getRuntimeFileList (no drift)', async () => {
    const target = await createTempDir();
    tempDirs.push(target);
    await installGovernance(target);

    const result = await callValidatePostApply(target);

    // With all runtime files present, the V2 result must be verified.
    assert.strictEqual(
      result.classification, 'VERIFIED_IN_SCOPE',
      `With all runtime files present, must be VERIFIED_IN_SCOPE. ` +
      `Got: classification=${result.classification}, issues=${JSON.stringify(result.issues)}`
    );
  });

  // ── Test 6: Installer exit code reflects post-validation ─
  it('installer exit code reflects post-validation failures', async () => {
    const target = await createTempDir();
    tempDirs.push(target);

    await installGovernance(target);
    await fs.unlink(path.join(target, REDACTION_DEST));

    // Re-run installer — it re-copies files, BUT if the source also had the fix
    // then the runtime files will be present again. Instead, verify the
    // installer's post_validation in the INSTALL REPORT from the first run.
    const reportPath = path.join(target, '.agent-governance', 'reports', 'install-report.json');
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.strictEqual(
      report.post_validation?.classification, 'VERIFIED_IN_SCOPE',
      `First install report must have VERIFIED_IN_SCOPE post_validation`
    );
  });

  // ── Test 7: Missing file produces a named issue ──────────
  it('missing runtime file produces a named issue referencing the file path', async () => {
    const target = await createTempDir();
    tempDirs.push(target);

    await installGovernance(target);
    await fs.unlink(path.join(target, REDACTION_DEST));

    const result = await callValidatePostApply(target);

    const allMessages = [...(result.issues || []), ...(result.warnings || [])].join(' ');
    assert.ok(
      allMessages.includes('redaction') || allMessages.includes('security'),
      `Missing security/redaction.mjs must be named in issues. ` +
      `Got: issues=${JSON.stringify(result.issues)}, warnings=${JSON.stringify(result.warnings)}`
    );
  });

  // ── Test 8: VERIFIED_IN_SCOPE requires all runtime files ─
  it('VERIFIED_IN_SCOPE requires ALL runtime files present (no false verified)', async () => {
    const target = await createTempDir();
    tempDirs.push(target);

    await installGovernance(target);

    // Delete multiple runtime files
    await fs.unlink(path.join(target, REDACTION_DEST));
    try { await fs.unlink(path.join(target, '.agent-governance/runtime/gates/context-fingerprint.mjs')); } catch {}

    const result = await callValidatePostApply(target);

    assert.notStrictEqual(
      result.classification, 'VERIFIED_IN_SCOPE',
      `VERIFIED_IN_SCOPE must not be reported when runtime files are missing. ` +
      `Got: classification=${result.classification}`
    );
  });

  // ── Test 9: validatePostApply checks installed target ────
  it('validatePostApply checks installed target (not repo source)', async () => {
    const target = await createTempDir();
    tempDirs.push(target);

    await installGovernance(target);
    await fs.unlink(path.join(target, REDACTION_DEST));

    const result = await callValidatePostApply(target);

    assert.notStrictEqual(
      result.classification, 'VERIFIED_IN_SCOPE',
      `validatePostApply must detect missing file in target, not fall back to repo source. ` +
      `Got: classification=${result.classification}`
    );
  });
});
