import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  createApprovalReceipt,
  approveReceipt,
  consumeReceipt,
  computeReceiptIntegrity,
  getRepositoryContext,
  validateReceiptStructure,
  APPROVAL_STATUSES
} from '../../scripts/lib/gates/approval.mjs';
import { ApprovalIntegrityViolation } from '../../scripts/lib/gates/errors.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempRoots = [];

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-kit-approval-'));
  tempRoots.push(root);
  await fs.writeFile(path.join(root, 'sentinel.txt'), 'initial\n');
  for (const args of [
    ['init'],
    ['config', 'user.email', 'approval-test@example.invalid'],
    ['config', 'user.name', 'Approval Test'],
    ['add', '-A'],
    ['commit', '-m', 'initial']
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return { root, context: getRepositoryContext(root) };
}

function pending(receipt) {
  const next = { ...receipt, status: APPROVAL_STATUSES.PENDING, integrity_hash: null };
  next.integrity_hash = computeReceiptIntegrity(next);
  return next;
}

function approved(repo, overrides = {}) {
  const receipt = createApprovalReceipt({
    action: 'shell_write',
    runtime: 'opencode',
    targetRoot: repo.root,
    gitBranch: repo.context.branch,
    gitCommit: repo.context.head,
    riskTier: 'HIGH_HUMAN_GATE',
    phase: 'before-implement',
    scopePaths: ['sentinel:write'],
    issuedBy: 'owner@example.invalid',
    ...overrides
  });
  return approveReceipt(pending(receipt), 'owner@example.invalid');
}

function consumeContext(repo, receipt, overrides = {}) {
  return {
    ...repo.context,
    action: receipt.action,
    runtime: receipt.runtime,
    phase: receipt.phase,
    risk_tier: receipt.risk_tier,
    scope: [...receipt.scope],
    baseDir: repo.root,
    ...overrides
  };
}

function runChild(receiptFile, context) {
  const code = `
    import fs from 'node:fs';
    import { consumeReceipt } from ${JSON.stringify(path.join(repoRoot, 'scripts/lib/gates/approval.mjs'))};
    const receipt = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const context = JSON.parse(process.argv[2]);
    try {
      consumeReceipt(receipt, context);
      process.stdout.write('SUCCESS\\n');
      process.exitCode = 0;
    } catch (error) {
      process.stdout.write((error.code || error.name || 'ERROR') + '\\n');
      process.exitCode = 1;
    }
  `;
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, receiptFile, JSON.stringify(context)], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolvePromise({ status, stdout: stdout.trim(), stderr }));
  });
}

after(async () => {
  for (const root of tempRoots) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('Approval receipt closure contract', () => {
  it('emits every canonical field and validates the receipt', async () => {
    const repo = await makeRepo();
    const receipt = approved(repo);
    for (const field of [
      'schema_version', 'receipt_id', 'repository_identity', 'project_path',
      'branch', 'head', 'phase', 'action', 'scope', 'risk_tier',
      'issued_by', 'issued_at', 'expires_at', 'single_use'
    ]) assert.ok(field in receipt, `missing ${field}`);
    assert.equal(receipt.single_use, true);
    assert.match(receipt.head, /^[a-f0-9]{40}$/);
    assert.deepEqual(validateReceiptStructure(receipt), []);
  });

  it('rejects each binding mismatch without consuming the receipt', async () => {
    const cases = [
      ['repository_identity', { repository_identity: 'https://example.invalid/other' }],
      ['project_path', { project_path: '/tmp/other-project' }],
      ['branch', { branch: 'other-branch' }],
      ['head', { head: 'b'.repeat(40) }],
      ['phase', { phase: 'verify' }],
      ['action', { action: 'push' }],
      ['risk_tier', { risk_tier: 'MEDIUM_REVIEW' }],
      ['scope', { scope: ['sentinel:other'] }]
    ];
    for (const [field, override] of cases) {
      const repo = await makeRepo();
      const receipt = approved(repo);
      assert.throws(() => consumeReceipt(receipt, consumeContext(repo, receipt, override)), /blocked|mismatch|scope|integrity|does not exist/i, field);
      assert.equal(existsSync(path.join(repo.root, '.opencode', 'approvals')), false, `${field} consumed a receipt`);
    }
  });

  it('rejects scope expansion, expiry and post-issuance tampering', async () => {
    const repo = await makeRepo();
    const receipt = approved(repo);
    assert.throws(() => consumeReceipt(receipt, consumeContext(repo, receipt, { scope: ['sentinel:write', 'sentinel:extra'] })), /scope/i);

    const expiredRepo = await makeRepo();
    const expired = approved(expiredRepo, { expiresInMs: -1 });
    assert.throws(() => consumeReceipt(expired, consumeContext(expiredRepo, expired)), /expired/i);

    const tampered = { ...receipt, head: 'c'.repeat(40) };
    assert.throws(() => consumeReceipt(tampered, consumeContext(repo, receipt)), ApprovalIntegrityViolation);
  });

  it('allows one consume and rejects replay after process restart', async () => {
    const repo = await makeRepo();
    const receipt = approved(repo);
    const receiptFile = path.join(repo.root, 'approval-receipt.json');
    await fs.writeFile(receiptFile, JSON.stringify(receipt));
    const context = consumeContext(repo, receipt);

    const first = await runChild(receiptFile, context);
    assert.equal(first.status, 0, first.stderr);
    assert.throws(() => consumeReceipt(receipt, context), /replay|already consumed|reuse/i);
  });

  it('permits at most one winner in a parallel double-consume race', async () => {
    const repo = await makeRepo();
    const receipt = approved(repo);
    const receiptFile = path.join(repo.root, 'parallel-receipt.json');
    await fs.writeFile(receiptFile, JSON.stringify(receipt));
    const context = consumeContext(repo, receipt);
    const results = await Promise.all([runChild(receiptFile, context), runChild(receiptFile, context)]);
    assert.equal(results.filter((result) => result.status === 0).length, 1);
    assert.equal(results.filter((result) => result.status === 1).length, 1);
  });

  it('resumes the bridge with one valid receipt and stops after a HEAD change', async () => {
    const bridge = path.join(repoRoot, 'scripts', 'evaluate-operation.mjs');
    const repo = await makeRepo();
    const receipt = approved(repo);
    const receiptFile = path.join(repo.root, 'resume-receipt.json');
    await fs.writeFile(receiptFile, JSON.stringify(receipt));
    const args = [
      bridge, '--project', repo.root, '--phase', 'before-implement',
      '--runtime', 'opencode', '--action', 'shell_write',
      '--risk-tier', 'HIGH_HUMAN_GATE', '--scope', 'sentinel:write',
      '--approval-file', receiptFile, '--json'
    ];
    const resumed = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
    assert.doesNotThrow(() => JSON.parse(resumed.stdout));
    const resumedDecision = JSON.parse(resumed.stdout);
    assert.equal(resumedDecision.consumed_approvals.length, 1, `${resumed.status}: ${resumed.stderr} ${resumed.stdout}`);

    await fs.appendFile(path.join(repo.root, 'sentinel.txt'), 'changed\n');
    assert.equal(spawnSync('git', ['add', '-A'], { cwd: repo.root }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'head-change'], { cwd: repo.root }).status, 0);
    const changedHead = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(changedHead.status, 30);
    const changedDecision = JSON.parse(changedHead.stdout);
    assert.equal(changedDecision.allowed, false);
    assert.match(JSON.stringify(changedDecision.blocked_by), /APPROVAL|HEAD|SCOPE|INTEGRITY/i);
  });

  it('rejects a symlinked ledger root', async () => {
    const repo = await makeRepo();
    const receipt = approved(repo);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-kit-ledger-outside-'));
    tempRoots.push(outside);
    await fs.mkdir(path.join(repo.root, '.opencode'), { recursive: true });
    symlinkSync(outside, path.join(repo.root, '.opencode', 'approvals'));
    assert.throws(() => consumeReceipt(receipt, consumeContext(repo, receipt)), /symlink|ledger/i);
  });
});
