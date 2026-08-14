# OCAE Existing-Installation Pre-Task Auto-Migration Specification

Status: implementation contract for the existing-installation reconciliation lifecycle.

## Goal

Before the first normal top-level user task reaches project-local governance,
the trusted global OCAE/OpenCode adapter reconciles an older compatible OCAE
installation to the globally bound OCAE runtime. The original user message is
then processed by the normal task-bootstrap and governance lifecycle without
manual project repair or prompt resubmission.

## Scope

- the already-installed global OpenCode adapter;
- a small canonical project runtime compatibility marker;
- canonical installer/update/verify metadata and doctor classifications;
- migration observability and precise blocked classifications;
- managed-file drift, source-lock, target-path, symlink, downgrade, and
  no-OCAE security boundaries;
- disposable old-installation and current-installation regressions.

All project mutations remain owned by `scripts/install-governance.mjs` through
the bound OCAE CLI. The adapter only inspects metadata and orchestrates the
trusted CLI with structured arguments, `shell=false`, and an explicit target.

## Out of scope

- installing OCAE into projects without an OCAE installation on ordinary user
  messages;
- modifying user source code, `.env`, credentials, foreign plugins, agents,
  MCP/provider configuration, or feature files;
- downgrading a newer project to an older global CLI;
- changing the existing bare canonical-URL handoff intent;
- moving or rewriting the v1.0.2 tag.

## Product invariants

1. `PROJECT_OCAE_RUNTIME_COMPATIBLE=true` is established before the first
   normal governed task.
2. A stale compatible installation is migrated before the old local governance
   hook can become the task's decisive gate.
3. `NOT_INSTALLED` ordinary messages pass through unchanged; only the existing
   bare OCAE URL path installs OCAE.
4. A valid current marker is a fast path and does not invoke full verify.
5. Corrupt, incompatible, tampered, symlinked, or unsafe states fail closed
   with a precise migration classification.
6. The top-level user message is never logged in reconciliation output and is
   not lost during migration.
7. The trusted migration boundary ends after canonical update and verify;
   normal task bootstrap and effect governance remain mandatory.

## Compatibility marker

The canonical installer owns `.agent-governance/runtime-state.json`. Its
machine-readable body contains:

- `schema_version`;
- `ocae_version`;
- `source_commit`;
- `governance_runtime_version`;
- `task_bootstrap_contract_version`;
- `installer_contract_version`;
- required runtime metadata and a SHA-256 integrity binding over the canonical
  body.

The marker is an optimization and provenance signal, not an authorization
source. The adapter still validates its shape, target boundary, and trusted
desired version before accepting `CURRENT`.

## State matrix

| Installation state | Ordinary top-level message | Bare canonical OCAE URL |
| --- | --- | --- |
| `NOT_INSTALLED` | pass through; no install | existing installation handoff |
| `CURRENT` | task bootstrap / normal governance | existing handoff |
| `MIGRATION_REQUIRED` | trusted update → verify → task bootstrap | existing handoff |
| `CORRUPT` | fail closed with precise repair classification | existing handoff may still fail closed |
| `INCOMPATIBLE` | fail closed; no downgrade | existing handoff may still fail closed |

## Acceptance criteria

1. A fixture installed from commit `93a779a6fd7da32c937430191570bda2a83ffab4`
   is detected as `MIGRATION_REQUIRED` before normal governance and reaches a
   current verified runtime without manual files.
2. A current project reports `PROJECT_CURRENT`, performs no migration CLI
   calls, and takes the marker fast path.
3. A migrated project contains a valid marker, task-bootstrap runtime,
   `owner-intent.json`, and `task-capsule.json` after the same original message
   is processed; a bounded first write can proceed.
4. Tracked modified user files and untracked user files are byte-for-byte
   unchanged after migration.
5. Managed drift returns `MIGRATION_BLOCKED_MANAGED_DRIFT` and does not fall
   through to normal task processing.
6. `ocae doctor` distinguishes `PROJECT_CURRENT`,
   `PROJECT_MIGRATION_REQUIRED`, `PROJECT_CORRUPT`, and
   `PROJECT_INCOMPATIBLE`; `ocae verify` reports precise pre-migration state
   and `GOVERNANCE_BOOTSTRAP_READY=true` after migration.
7. The adapter uses only the bound absolute CLI path, structured argv,
   `shell=false`, and the captured canonical target root.
8. No-OCAE ordinary messages, bare-URL installation, current-project fast
   path, and fresh v1.0.2 installation remain green.
9. Negative tests cover forged markers, source-lock tampering, global CLI
   binding tampering, target drift, symlinked governance roots, downgrade,
   prompt injection, and migration write-scope violations.

## Red tests

1. `test/bootstrap/existing-installation-automigration.test.mjs` — old
   installation currently remains stale after the global adapter receives an
   ordinary message.
2. `test/bootstrap/existing-installation-automigration.test.mjs` — current
   marker fast path and preservation cases are not yet defined.
3. `test/security/existing-installation-automigration-security.test.mjs` —
   forged metadata, symlink, target-drift, tamper, downgrade, and scope
   negatives are not yet covered.
4. `test/python/test_ocae_cli.py` — doctor/verify state classifications are not
   yet exposed as the migration contract.

## Regression tests

- `test/bootstrap/task-bootstrap.test.mjs`
- `test/bootstrap/task-bootstrap-installer-order.test.mjs`
- `test/bootstrap/url-only-contract.test.mjs`
- `test/bootstrap/url-only-intent-resolution.test.mjs`
- `test/install/url-installer.test.mjs`
- `test/install/runtime-hardening.test.mjs`
- `test/install/tamper-detection.test.mjs`
- `test/security/task-bootstrap-security.test.mjs`
- `test/integration/approval-enforcement.test.mjs`
- `test/contracts/runtime-enforcement-contracts.test.mjs`
- `node scripts/validate-ecosystem.mjs`
