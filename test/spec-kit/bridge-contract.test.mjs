import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from '../helpers.mjs';
import { skipIfHostCannotSymlink } from '../lib/symlink-capability.mjs';

const bridge = path.join(repoRoot, 'scripts', 'evaluate-operation.mjs');
const dirs = [];

async function project() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-kit-bridge-contract-'));
  dirs.push(dir);
  await fs.writeFile(path.join(dir, 'opencode.jsonc'), JSON.stringify({ permission: { external_directory: 'deny' } }));
  return dir;
}

function run(args) {
  return spawnSync(process.execPath, [bridge, ...args, '--json'], { encoding: 'utf8' });
}

after(async () => {
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('Spec-Kit bridge security and contract', () => {
  it('rejects a relative project path as INVALID_INPUT', async () => {
    const result = run(['--project', '.', '--phase', 'reality', '--runtime', 'opencode']);
    assert.equal(result.status, 40);
    assert.equal(JSON.parse(result.stdout).classification, 'RED_BLOCK');
    assert.match(result.stderr, /absolute path/);
  });

  it('rejects an unknown phase and runtime', async () => {
    const dir = await project();
    const phase = run(['--project', dir, '--phase', 'unknown', '--runtime', 'opencode']);
    assert.equal(phase.status, 40);
    const runtime = run(['--project', dir, '--phase', 'reality', '--runtime', 'unknown']);
    assert.equal(runtime.status, 40);
  });

  it('rejects a write path outside project scope', async () => {
    const dir = await project();
    const result = run(['--project', dir, '--phase', 'before-implement', '--runtime', 'opencode', '--write-path', '/tmp']);
    assert.equal(result.status, 40);
    assert.match(result.stderr, /escapes project scope/);
  });

  it('rejects a symlink project root', async (t) => {
    if (await skipIfHostCannotSymlink(t, { type: 'dir' })) return
    const dir = await project();
    const link = `${dir}-link`;
    await fs.symlink(dir, link);
    dirs.push(link);
    const result = run(['--project', link, '--phase', 'reality', '--runtime', 'opencode']);
    assert.equal(result.status, 40);
  });

  it('keeps stdout parseable and puts validation diagnostics on stderr', async () => {
    const dir = await project();
    const result = run(['--project', dir, '--phase', 'reality', '--runtime', 'opencode']);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
    assert.doesNotMatch(result.stdout, /FATAL|Error|undefined/);
  });

  it('redacts secret-shaped kernel evidence', async () => {
    const dir = await project();
    const result = run([
      '--project', dir, '--phase', 'before-implement', '--runtime', 'opencode',
      '--action', 'evaluate', '--command', 'token=ghp_123456789012345678901234567890123456'
    ]);
    assert.equal(/ghp_123456789012345678901234567890123456/.test(result.stdout), false);
    assert.match(result.stdout, /REDACTED_SECRET/);
  });

  it('maps invalid input and internal failure classes to non-allowing decisions', async () => {
    const result = run(['--project', '/does/not/exist', '--phase', 'reality', '--runtime', 'opencode']);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.allowed, false);
    assert.ok([40, 50].includes(result.status));
  });

  it('does not document raw argument echoing in the supported preflight command', async () => {
    const promptPath = path.join(repoRoot, 'integrations', 'spec-kit', 'extensions', 'opencode-evidence', 'commands', 'speckit.opencode-evidence.preflight.md');
    const prompt = await fs.readFile(promptPath, 'utf8');
    assert.doesNotMatch(prompt, /ARGUMENTS_SENTINEL=\$ARGUMENTS/);
    assert.match(prompt, /never.*(content|contents|value)/i);
  });
});
