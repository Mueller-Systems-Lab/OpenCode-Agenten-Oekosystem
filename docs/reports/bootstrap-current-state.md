# Bootstrap Current State — Reality Refresh

Date: 2026-07-24
Branch: `feat/governance-v2-closure-20260724`
Local source commit: `0f43ef265e05d7dc9afc2f12425452f3b431f360`

## Validated facts

- The repository has two bootstrap-related paths:
  - `scripts/bootstrap-project.mjs` is the older OpenCode/Hermes overlay bootstrap.
  - `scripts/install-governance.mjs` is the Governance V2 resident-runtime installer.
- `scripts/install-governance.mjs` already supports a target path, default dry-run, `--apply`, JSON output, runtime detection, backups, source-lock generation, OpenCode/Hermes adapters, and rollback.
- The V2 installer derives source content from the checkout containing the script and records the current Git commit when available.
- Existing installer tests cover dry-run, apply, backup creation, resident runtime files, source locks, second apply, and basic rollback.
- The root currently has `BOOTSTRAP.md` and `AI-INSTALL.md`, but no `AI-BOOTSTRAP.md` or `bootstrap/manifest.json` contract.
- The root README currently points to `BOOTSTRAP.md` and does not expose one canonical AI entrypoint.
- The public GitHub repository is reachable, has visibility `PUBLIC`, and uses `master` as the default branch.
- The closure branch is not yet present on `origin`; no pull request for it exists.
- PR #8 and PR #11 remain open and were not modified.

## Existing assumptions that are not acceptable for URL-only bootstrap

- A foreign AI cannot discover a machine-readable protocol manifest from the repository root.
- The existing V2 installer does not write the required `.opencode/ecosystem-installation.json` provenance record.
- Existing runtime files can be force-copied over a target file, so an untracked owner edit is not yet fail-closed.
- Existing rollback is backup-based but does not yet prove post-install file ownership and later-edit preservation for every managed path.
- Existing run classifications and help text still contain legacy `GREEN_SAFE` wording in compatibility paths.

## Scope decision

The URL-only contract will point to the existing V2 installer path and extend it with:

1. root discovery documentation;
2. a protocol manifest and schema;
3. URL/ref normalization helpers;
4. conflict classification and owner-content preservation;
5. installation provenance;
6. a contract verifier;
7. managed-file rollback evidence;
8. contract, integration, adversarial, remote-clone, and rollback tests.

The older overlay bootstrap remains documented as a legacy/local overlay path and is not advertised as the canonical URL-only V2 installer.
