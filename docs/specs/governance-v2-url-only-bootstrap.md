# Governance V2 URL-only Bootstrap Specification

## Goal

A foreign AI that receives only a public GitHub repository URL can discover, dry-run, apply, verify, repeat, and roll back the Governance V2 project-local installation without local source paths or prior chat context.

## Scope

- Root discovery: `README.md`, `AI-BOOTSTRAP.md`.
- Machine contract: `bootstrap/manifest.json` and `bootstrap/manifest.schema.json`.
- Existing V2 installer extension: `scripts/install-governance.mjs`.
- Contract verifier: `bootstrap/verify.mjs`.
- URL/ref helpers and conflict/installation metadata helpers under `bootstrap/lib/`.
- Contract, integration, adversarial, remote-clone, and rollback tests.

Out of scope: merge, auto-merge, deployment, release/tag creation, CT 108, VM 106, Odysseus, productive MCP servers, and productive project data.

## Acceptance criteria

1. The README's upper section directs AI-assisted installation to exactly `AI-BOOTSTRAP.md`.
2. `AI-BOOTSTRAP.md` defines deterministic discovery, ref pinning, preflight, dry-run, apply, verify, second apply, fresh-process verification, and rollback for `INSTALL_NEW`, `UPDATE_EXISTING`, `VERIFY_ONLY`, and `ROLLBACK`.
3. The manifest validates against its schema and references existing installer, verifier, and rollback paths.
4. The installer rejects unsafe target paths and symlinks, does not read secret contents, preserves unknown owner files, and fails closed on unknown managed-file conflicts.
5. The target receives `.opencode/ecosystem-installation.json` with source URL/ref/SHA, managed and preserved paths, conflicts, and verification metadata, without private absolute source paths or secrets.
6. Dry-run has no target writes; apply is backed up; verify checks manifest, runtime, policy IR, prompt kernel, capability registry, V2 classifications, provenance, and private-path/secret hygiene.
7. A second apply against the same pinned source is idempotent, and rollback restores only bootstrap-managed changes while preserving later owner edits.
8. Public GitHub branch and commit URLs work without a local source path or file URL.

## Conflict contract

Each planned action is classified as one of `SAFE_CREATE`, `SAFE_GENERATED_UPDATE`, `SAFE_MANAGED_UPDATE`, `OWNER_CONTENT_PRESERVE`, `MANUAL_REVIEW_REQUIRED`, or `FORBIDDEN`. Unknown conflicts never become an implicit overwrite.

## Verification Contract

### Desired behavior

The published branch is a self-describing, reproducible URL-only V2 bootstrap source.

### Red tests

- Root discovery and manifest contract tests fail until the new files and README link exist.
- URL normalization tests fail until repository, branch, commit, and invalid-ref inputs are handled.
- Existing owner-content and rollback-preservation tests fail until the installer stops overwriting unmanaged files.

### Regression tests

- Existing `test/install/url-installer.test.mjs`.
- Existing runtime, gate, validation, and governance test suites.
- Required `node --check` and governance validation commands.

### Reality gate

- `git diff --check`.
- Manifest/schema cross-reference verification.
- Fresh GitHub clone at the published branch and pinned commit.
- Target-project dry-run/apply/verify/second-apply/rollback evidence.
- No `file://`, local source worktree, secrets, or private absolute source paths in published bootstrap artifacts.

### Evidence types

- Captured command output and exit codes.
- JSON installation manifest and verification report.
- GitHub remote SHA and PR metadata.
- Clean-room clone source proof.
- Adversarial target-project results.

### Untestable assumptions

- A real OpenCode model may be unavailable in this environment; if so, the live AI test is classified as the precise runtime tool gap and is not represented as passed.
- GitHub authentication is not needed for this public repository; private-repository behavior is documented but not claimed as unauthenticated.

### Completion gate

Use `VERIFIED_IN_SCOPE` only after the published branch, remote fresh clone, URL-only AI run, idempotence, rollback, and security evidence all pass. Otherwise use the most precise `NEEDS_REVIEW_*`, `TOOL_GAP_*`, or `RED_BLOCK_*` classification.
