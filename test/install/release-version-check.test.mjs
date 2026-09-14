/**
 * Release version consistency tests (T11).
 *
 * Guards stable releases: `build_backend.check-release` must FAIL when the
 * manifest version differs from the release tag (leading `v` stripped), when
 * the worktree is dirty, or when the built payload manifest disagrees with
 * the release (package version or archive hash). The pure gate
 * `verify_release_consistency` is exercised directly so these tests are
 * deterministic regardless of the developer's current git state; one CLI
 * smoke test asserts the mismatch path fails closed end to end.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { repoRoot } from '../helpers.mjs'

function pyCheck(body) {
  const probe = spawnSync('python3', ['-c', body], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  })
  return probe
}

const PRELUDE = 'import build_backend as b\n'

test('matching version and tag with a clean tree passes', () => {
  const probe = pyCheck(`${PRELUDE}print(b.verify_release_consistency(manifest_version='1.0.7', tag='v1.0.7', dirty=[]))`)
  assert.equal(probe.status, 0, probe.stderr)
  assert.match(probe.stdout, /manifest_version/)
})

test('manifest/tag version drift fails closed', () => {
  const probe = pyCheck(
    `${PRELUDE}b.verify_release_consistency(manifest_version='1.0.7', tag='v9.9.9', dirty=[])`,
  )
  assert.notEqual(probe.status, 0)
  assert.match(probe.stderr, /manifest version/)
})

test('dirty worktree fails closed', () => {
  const probe = pyCheck(
    `${PRELUDE}b.verify_release_consistency(manifest_version='1.0.7', tag='v1.0.7', dirty=['README.md'])`,
  )
  assert.notEqual(probe.status, 0)
  assert.match(probe.stderr, /dirty worktree/)
})

test('payload manifest hash mismatch fails closed', () => {
  const probe = pyCheck(
    `${PRELUDE}b.verify_release_consistency(manifest_version='1.0.7', tag='v1.0.7', dirty=[], ` +
    `payload_manifest={'package_version': '1.0.7', 'archive_sha256': 'aaa'}, archive_sha256='bbb')`,
  )
  assert.notEqual(probe.status, 0)
  assert.match(probe.stderr, /archive_sha256 mismatch/)
})

test('payload manifest version drift fails closed', () => {
  const probe = pyCheck(
    `${PRELUDE}b.verify_release_consistency(manifest_version='1.0.7', tag='v1.0.7', dirty=[], ` +
    `payload_manifest={'package_version': '0.0.0', 'archive_sha256': 'aaa'}, archive_sha256='aaa')`,
  )
  assert.notEqual(probe.status, 0)
  assert.match(probe.stderr, /package_version/)
})

test('CLI check-release fails closed on version drift', () => {
  const probe = spawnSync('python3', [
    'build_backend.py', 'check-release',
    '--manifest-version', '1.0.7', '--tag', 'v9.9.9',
  ], { cwd: repoRoot, encoding: 'utf8' })
  assert.notEqual(probe.status, 0)
  assert.match(probe.stdout + probe.stderr, /FAIL/)
})
