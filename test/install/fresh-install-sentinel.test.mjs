// SPDX-License-Identifier: MIT
/**
 * OCAE Fresh-Install Sentinel regression test.
 *
 * Reproducibly proves against an isolated temporary target:
 *   - the installer completes successfully (VERIFIED_IN_SCOPE)
 *   - the canonical runtime artifacts are installed
 *   - the canonical entry resolves (real module import probe)
 *   - a harmless runtime canary executes (CONTRACT_INVALID abort)
 *   - no legacy execution path is reachable from the installed runtime
 *
 * The same runFreshInstallSentinel() function is available as the CLI
 * `node scripts/fresh-install-sentinel.mjs` for on-demand revalidation.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { repoRoot } from '../helpers.mjs'
import { runFreshInstallSentinel, FRESH_INSTALL_ARTIFACTS } from '../../scripts/fresh-install-sentinel.mjs'

describe('fresh install sentinel — canonical runtime installs into an isolated target', () => {
  it('full fresh-install proof passes on the current baseline', async (t) => {
    const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ocae-fresh-install-test-'))
    t.after(() => fs.rm(targetRoot, { recursive: true, force: true }))

    const result = await runFreshInstallSentinel({ repoRoot, targetRoot })

    assert.equal(result.status, 'PASS', JSON.stringify(result, null, 2))
    assert.equal(result.install.exit_code, 0, 'installer must exit 0')

    const failed = Object.entries(result.checks).filter(([, entry]) => entry.status === 'FAIL')
    assert.deepEqual(failed, [], 'all fresh-install checks must pass')

    // Explicit DoD assertions for the documented checks.
    assert.equal(result.checks.installer.status, 'PASS')
    assert.equal(result.checks.entry_resolves.status, 'PASS')
    assert.equal(result.checks.canary.status, 'PASS')
    assert.equal(result.checks.no_legacy_runtime_files.status, 'PASS')
    assert.equal(result.checks.no_legacy_entry.status, 'PASS')
    assert.equal(result.checks.no_legacy_manifest.status, 'PASS')
    for (const [label, rel] of Object.entries(FRESH_INSTALL_ARTIFACTS)) {
      assert.equal(result.checks[`artifact_${label}`].status, 'PASS', `${label} (${rel}) must be installed`)
    }
  })
})
