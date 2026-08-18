# LEGACY_COMPATIBILITY_RETIREMENT — Closure Report

Milestone: `LEGACY_COMPATIBILITY_RETIREMENT`

Target:
`GREEN_OCAE_LEGACY_COMPATIBILITY_RETIRED` / `LEGACY_EXECUTION_STATUS=RETIRED`

## 1. Test Harness (Linux)

- Development host: Linux 6.8.0-85-generic (Ubuntu 24.04), x86_64.
- Workspace `/media/xxammaxx/software` on ext4 (`/dev/sdb6`, `rw,nosuid,nodev`);
  `/tmp` on the root ext4 filesystem. Symlink probes (workspace + temp + probe
  helper) all report `HOST_SYMLINK_CAPABILITY_AVAILABLE`.
- Symlink EPERM: the two historical `EPERM` tests
  (`test/security/bootstrap-secret-isolation.test.mjs`,
  `test/security/bootstrap-bypass-red-team.test.mjs`) run for REAL on Linux and
  PASS (8/8 and 1/1, 0 skipped). Root cause of the historical failures: Windows
  host capability gap (no Developer Mode / `SeCreateSymbolicLinkPrivilege`),
  documented as platform-bound evidence. On Linux a new `EPERM` is a bug, never
  an automatic Windows exception.
- Capability handling: `test/lib/symlink-capability.mjs` performs a real
  reversible symlink probe; only a proven-absent capability produces an explicit
  skip. No `process.platform`-based skip logic.
- Runner: `scripts/run-tests.mjs` runs ALL manifest groups and aggregates at the
  end; a failing group does not abort the remaining groups; the final exit code
  is non-zero on any real failure. Machine-readable `--json` aggregate.
- Validator timeout: outer suite timeout in `scripts/validate-ecosystem.mjs` is
  now manifest-aware (sum of effective per-file timeouts + grace), replacing the
  hard 120 s cutoff.
- Additional Linux fix: `test/bootstrap/existing-installation-automigration.test.mjs`
  reconstructs a genuine pre-v1.0.2 fixture via `git archive <old commit>`; in a
  clean single-commit checkout (post-merge scenario) that history object is
  genuinely absent. A real git-history capability probe now gates those two
  tests as explicitly unsupported there, while they still run for real and pass
  in the full-history dev repo.

### DoD Test Harness

```text
DEVELOPMENT_HOST_LINUX=PASS
SYMLINK_FAILURE_ROOT_CAUSE=PASS            (Windows host gap; Linux real capability)
SYMLINK_SECURITY_TESTS_REAL_EXECUTION=PASS (8/8 + 1/1 real, 0 skips)
CANONICAL_TEST_COMMAND_SINGLE_RUN=PASS     (npm test)
ALL_TEST_GROUPS_EXECUTED=PASS              (63/63 files)
GROUP_FAILURE_DOES_NOT_ABORT_REMAINING_GROUPS=PASS
FINAL_FAILURE_EXIT_CODE=PASS
MACHINE_READABLE_AGGREGATE=PASS            (--json)
VALIDATOR_OUTER_TIMEOUT_CONSISTENT=PASS
REAL_FAILURE_NOT_CONVERTED_TO_SKIP=PASS
SECURITY_ASSERTIONS_UNCHANGED=PASS
```

## 2. Legacy Retirement

- The canonical plugin entry (`.opencode/plugins/canonical-governance.mjs` and
  the installer-generated hook) is the only executable standard path:
  `chat.message → bootstrapTask → enterRun`. No silent legacy fallback.
- Runtime unavailable / import failure / init failure / entry contract failure
  → explicit `RUNTIME_ENTRY_BLOCKED:CANONICAL_RUNTIME_UNAVAILABLE`, observable
  `ocae.runtime-entry-failure.v1` record, `fallback_attempted=false`,
  `legacy_fallback_used=false`.
- Installer installs only the canonical runtime/contracts/controller/pipeline and
  the canonical hook; `run-state.mjs`/`agent/start.mjs` are not installed.
- Guard rails: `validateNoSilentLegacyFallback()` (validator) and
  `validatePostApply` legacy-fallback drift check (installer).
- Negative tests: RUNTIME_MISSING, RUNTIME_IMPORT_FAILURE, INVALID_CONTRACT
  (→ CONTRACT_INVALID, no fallback), BYPASS (run-state/startAgent not installed)
  — all in `test/controller/no-silent-fallback.test.mjs`; plan-gate/verify/retry/
  security-hard-block/worker-fake-success invariants covered by the controller
  and real-worker-soak suites.

### DoD Legacy Retirement

```text
PRE_RETIREMENT_BASELINE=PASS
SILENT_FALLBACK_REMOVED=PASS
CANONICAL_RUNTIME_MANDATORY=PASS
FAIL_FAST_RUNTIME_UNAVAILABLE=PASS
NORMAL_PLUGIN_ENTRY_CANONICAL_ONLY=PASS
LEGACY_HOOK_REMOVED_FROM_NORMAL_PATH=PASS
RUNTIME_MISSING_TEST=PASS
RUNTIME_IMPORT_FAILURE_TEST=PASS
INVALID_CONTRACT_NO_FALLBACK=PASS
NO_SILENT_FALLBACK_TEST=PASS
INSTALLER_CANONICAL_ONLY=PASS
FRESH_INSTALL_CANONICAL_ENTRY=PASS
PLAN_GATE_UNBYPASSABLE=PASS
VERIFY_MANDATORY=PASS
RETRY_AUTHORITY_CANONICAL=PASS
CONTROLLER_SOLE_TERMINAL_AUTHORITY=PASS
SECURITY_HARD_BLOCK=PASS
WORKER_FAKE_SUCCESS_DENIED=PASS
REAL_PLUGIN_SESSIONS_MIN_5=PASS  (6 sessions)
NORMAL_LEGACY_FALLBACK_COUNT=0
RUN_ID_CORRELATION=PASS
FIRST_BAD_BOUNDARY=PASS
NO_SECRET_LEAK=PASS
LEGACY_ARTIFACT_INVENTORY=PASS
DOCUMENTATION=PASS
REGRESSION_TESTS=PASS
```

## 3. Evidence

- `evidence/legacy-retirement-soak/` — 6 real plugin sessions
  (all `canonical_runtime_used=true`, `legacy_fallback_used=false`; 4 DONE,
  1 SPLIT, 1 BLOCKED, 1 controlled retry) + forced-canonical-failure proof
  (`fail_fast=true`, `no_fallback=true`, `run_context_created=false`).
- `evidence/legacy-retirement-repeat/` — round-2 repeat, 0 fallbacks.
- `docs/reports/legacy-artifact-inventory.md` — artifact classification
  (`LEGACY_ARTIFACT_CLEANUP_READINESS=PARTIAL`).

## 4. Classification

```text
GREEN_OCAE_LEGACY_COMPATIBILITY_RETIRED
LEGACY_EXECUTION_STATUS=RETIRED
LEGACY_ARTIFACT_CLEANUP_READINESS=PARTIAL
```
