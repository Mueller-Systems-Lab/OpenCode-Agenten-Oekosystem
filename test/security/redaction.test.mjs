import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { redactText, redactValue, safeRedactText, safeSerialize, secretValuesFromEnv } from '../../scripts/lib/security/redaction.mjs';

const sentinel = ['sk-test-', 'OPEN_CODE_SECRET_SENTINEL', '-9f61c2'].join('');
const shortSecret = 'q7';
const regexSecret = 'a.$[b]';
const options = { secrets: [sentinel, shortSecret, regexSecret] };

async function runNodeChild(code, { encoding = 'utf8', env = {} } = {}) {
  const captureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redaction-child-'));
  const stdoutPath = path.join(captureRoot, 'stdout.bin');
  const stderrPath = path.join(captureRoot, 'stderr.bin');
  const stdoutHandle = await fs.open(stdoutPath, 'w');
  const stderrHandle = await fs.open(stderrPath, 'w');
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ['ignore', stdoutHandle.fd, stderrHandle.fd],
      timeout: 5_000,
      killSignal: 'SIGTERM'
    });
    await Promise.all([stdoutHandle.sync(), stderrHandle.sync()]);
    const [stdout, stderr] = await Promise.all([fs.readFile(stdoutPath), fs.readFile(stderrPath)]);
    const decode = (value) => encoding === 'buffer' ? value : value.toString(encoding);
    return { ...result, stdout: decode(stdout), stderr: decode(stderr) };
  } finally {
    await Promise.all([stdoutHandle.close(), stderrHandle.close()]);
    await fs.rm(captureRoot, { recursive: true, force: true });
  }
}

describe('central credential redaction', () => {
  it('redacts an API key in an object', () => {
    assert.equal(redactValue({ apiKey: sentinel }, options).apiKey, '[REDACTED]');
  });

  it('redacts a bearer token in an authorization header', () => {
    assert.match(redactText(`Authorization: Bearer ${sentinel}`, options), /Bearer \[REDACTED\]/);
  });

  it('preserves harmless token prose', () => {
    const prose = 'token is a harmless identifier';
    assert.equal(redactText(prose, options), prose);
  });

  it('redacts an unconfigured API-key-shaped value', () => {
    const output = redactText('key=sk-proj-ABCDEFGH12345678', options);
    assert.doesNotMatch(output, /sk-proj-ABCDEFGH12345678/);
  });

  it('redacts a nested password', () => {
    const value = redactValue({ nested: { credentials: { password: 'pw' } } }, options);
    assert.equal(value.nested.credentials.password, '[REDACTED]');
  });

  it('redacts a secret in arrays', () => {
    assert.equal(redactValue(['safe', { secret: sentinel }], options)[1].secret, '[REDACTED]');
  });

  it('redacts an Error message', () => {
    const error = new Error(`request failed with ${sentinel}`);
    assert.doesNotMatch(safeSerialize(error, options), new RegExp(sentinel));
  });

  it('redacts an Error stack', () => {
    const error = new Error('stack sentinel');
    error.stack = `Error: ${sentinel}\n at test (file:///tmp/test.mjs:1:1)`;
    assert.doesNotMatch(safeSerialize(error, options), new RegExp(sentinel));
  });

  it('redacts secret URL query values while preserving the path', () => {
    const output = redactText(`https://example.test/callback?token=${sentinel}&page=2`, options);
    assert.match(output, /example\.test\/callback/);
    assert.doesNotMatch(output, new RegExp(sentinel));
  });

  it('redacts a connection-string password', () => {
    const output = redactText(`postgres://alice:${sentinel}@db.example.test/app`, options);
    assert.doesNotMatch(output, new RegExp(sentinel));
    assert.match(output, /postgres:\/\/alice:\[REDACTED\]@/);
  });

  it('redacts cookies', () => {
    assert.match(redactText(`Cookie: session=${sentinel}; theme=dark`, options), /Cookie: \[REDACTED\]/);
  });

  it('redacts private-key blocks', () => {
    const key = '-----BEGIN PRIVATE KEY-----\nsecret material\n-----END PRIVATE KEY-----';
    assert.equal(redactText(key, options), '[REDACTED]');
  });

  it('redacts a very short configured secret', () => {
    assert.equal(redactText(`value=${shortSecret}`, options), 'value=[REDACTED]');
  });

  it('redacts a configured secret containing regex metacharacters', () => {
    assert.doesNotMatch(redactText(`value=${regexSecret}`, options), new RegExp('\\.\\$\\[b\\]'));
  });

  it('redacts repeated occurrences', () => {
    const output = redactText(`${sentinel}|${sentinel}`, options);
    assert.equal(output.split('[REDACTED]').length - 1, 2);
  });

  it('handles cyclic objects without leaking values', () => {
    const value = { secret: sentinel };
    value.self = value;
    const output = safeSerialize(value, options);
    assert.doesNotMatch(output, new RegExp(sentinel));
    assert.match(output, /CIRCULAR/);
  });

  it('fails closed for non-serializable values', () => {
    const value = { secret: sentinel, amount: 1n };
    assert.doesNotThrow(() => safeSerialize(value, options));
    assert.doesNotMatch(safeSerialize(value, options), new RegExp(sentinel));
  });

  it('redacts stdout payloads', () => {
    assert.doesNotMatch(redactText(`stdout ${sentinel}`, options), new RegExp(sentinel));
  });

  it('redacts stderr payloads', () => {
    assert.doesNotMatch(redactText(`stderr ${sentinel}`, options), new RegExp(sentinel));
  });

  it('writes only redacted evidence files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redaction-evidence-'));
    try {
      await fs.writeFile(path.join(root, 'evidence.json'), safeSerialize({ output: sentinel }, options));
      const content = await fs.readFile(path.join(root, 'evidence.json'), 'utf8');
      assert.doesNotMatch(content, new RegExp(sentinel));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('redacts in a fresh process after restart', () => {
    const code = "import { redactText, secretValuesFromEnv } from './scripts/lib/security/redaction.mjs'; process.stdout.write(redactText(process.env.TEST_SECRET_SENTINEL, { secrets: secretValuesFromEnv() }));";
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { PATH: process.env.PATH, TEST_SECRET_SENTINEL: sentinel },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, new RegExp(sentinel));
  });

  it('discovers only configured secret-like environment values', () => {
    const values = secretValuesFromEnv({ SAFE_PATH: '/tmp/safe', TEST_SECRET_SENTINEL: sentinel });
    assert.ok(values.includes(sentinel));
    assert.equal(values.includes('/tmp/safe'), false);
  });

  it('supports a recursive sentinel scan with zero unredacted matches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redaction-scan-'));
    try {
      await fs.mkdir(path.join(root, 'nested'));
      await fs.writeFile(path.join(root, 'nested', 'output.txt'), redactText(`result=${sentinel}`, options));
      const files = [path.join(root, 'nested', 'output.txt')];
      const matches = [];
      for (const file of files) {
        if ((await fs.readFile(file, 'utf8')).includes(sentinel)) matches.push(file);
      }
      assert.deepEqual(matches, []);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('redacts a Unicode and newline secret across nested JSON and free text', () => {
    const unicodeSecret = 'Ünicode🔐\nline-secret';
    const value = {
      outer: {
        details: {
          authorization: unicodeSecret,
          message: `diagnostic text: ${unicodeSecret}`
        }
      }
    };
    const output = safeSerialize(value, { secrets: [unicodeSecret] });
    assert.doesNotMatch(output, /Ünicode|line-secret/);
    assert.match(output, /REDACTED/);
  });

  it('redacts a child-process exception transported on stderr while preserving status', async () => {
    const childSecret = 'child-process-secret';
    const result = await runNodeChild(
      'const e = new Error(`child failure ${process.env.TEST_REDACTION_VALUE}`); process.stderr.write(JSON.stringify({ error: e.message, stack: e.stack })); process.exitCode = 37;',
      { env: { TEST_REDACTION_VALUE: childSecret } }
    );
    const output = safeRedactText(result.stderr, { secrets: [childSecret] });
    assert.equal(result.status, 37);
    assert.equal(result.signal, null);
    assert.doesNotMatch(output, new RegExp(childSecret));
    assert.match(output, /child failure/);
  });

  it('redacts invalid UTF-8 child output without exposing the byte payload', async () => {
    const childSecret = 'binary-child-secret';
    const result = await runNodeChild(
      'process.stdout.write(Buffer.concat([Buffer.from(process.env.TEST_REDACTION_VALUE), Buffer.from([0xff, 0xfe, 0x00])])); process.exitCode = 23;',
      { env: { TEST_REDACTION_VALUE: childSecret }, encoding: 'buffer' }
    );
    const output = safeRedactText(result.stdout.toString('utf8'), { secrets: [childSecret] });
    assert.equal(result.status, 23);
    assert.equal(result.signal, null);
    assert.doesNotMatch(output, new RegExp(childSecret));
    assert.match(output, /REDACTED/);
  });

  it('fails closed when the redaction function itself throws', () => {
    const throwingSecrets = { filter() { throw new Error('secret option failure'); } };
    const output = safeRedactText('untrusted diagnostic payload', { secrets: throwingSecrets });
    assert.equal(output, '[REDACTED_UNSERIALIZABLE]');
    assert.doesNotMatch(output, /untrusted diagnostic payload/);
  });

  it('does not replay a previous raw log into a fresh bridge process', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redaction-restart-log-'));
    const oldSecret = 'old-raw-log-secret';
    try {
      await fs.writeFile(path.join(root, 'old.log'), oldSecret, 'utf8');
      const launcher = path.resolve(import.meta.dirname, '../../integrations/spec-kit/extensions/opencode-evidence/scripts/run-bridge.mjs');
      const result = spawnSync(process.execPath, [
        launcher, '--phase', 'reality', '--runtime', 'opencode', '--json'
      ], {
        cwd: root,
        env: { PATH: process.env.PATH, OPENCODE_AGENT_ECOSYSTEM_ROOT: path.resolve(import.meta.dirname, '../..'), OLD_LOG_SECRET: oldSecret },
        encoding: 'utf8'
      });
      assert.equal(result.stdout.includes(oldSecret), false);
      assert.equal(result.stderr.includes(oldSecret), false);
      assert.ok([0, 10].includes(result.status));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
