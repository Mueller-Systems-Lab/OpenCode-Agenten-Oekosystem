# Fresh Test Evidence

The bundled Node runtime was used because Node was not available on PATH. The
temporary runtime was removed after testing.

| Check | Result |
| --- | --- |
| Contract group | 128 passed, 1 failed; failure is the symlink-ledger test with Windows `EPERM` |
| Governance group | 8 passed, 1 failed; failure is the same symlink capability propagated through the runner |
| E2E group | 124 passed, 2 failed; both are the runner's security files failing on symlink creation |
| Full canonical suite | 210/212 passed, 2 failed |
| Governance drift | `GOVERNANCE_DRIFT_CHECK_OK` |
| Syntax checks for changed tests | exit 0 |
| Ecosystem validator | `RED_BLOCK - TEST_SUITE_FAILED: 210/212 tests passed` |
| Diff check | `git diff --check` passed |

The remaining failures are not weakened or reclassified: they exercise secret
and path-boundary protection that this Windows account cannot set up without
symlink privilege. Enabling a global Windows privilege or developer setting
was outside the authorized scope.
