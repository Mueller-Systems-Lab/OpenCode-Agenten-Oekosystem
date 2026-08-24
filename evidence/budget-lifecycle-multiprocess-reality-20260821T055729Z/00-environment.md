# Environment & Baseline — OCAE-RUN-CARD-BUDGET-LIFECYCLE-MULTIPROCESS-REALITY

## Tool Manifest (Anti-Fake-Execution, live detected)
- OS: Linux 6.8.0-85-generic (Ubuntu, x86_64)
- Shell: /bin/bash
- Node: v22.23.2
- NPM: 10.9.8
- Python: 3.12.3
- Git: 2.43.0
- gh: **TOOL_GAP** (not installed)
- docker: **TOOL_GAP** (not installed)

## Git Baseline
- Start HEAD (full): `4e3fce7dca9adc16de69b9251434461f32fcbb79`
- Expected prefix from run card: `4e3fce7` ✓
- Previous milestone HEAD (claimed): `4e3fce7` ✓

## Phantom Stat / Index Effect (verified)
- `git status --short` reports 455 files as ` M` (worktree)
- `git diff --name-only` = 0, `git diff HEAD --name-only` = 0
- Direct blob comparison for package.json: index blob md5 `a6c97944...` == worktree md5 `a6c97944...` == HEAD md5 `a6c97944...`
- Cause: index entries carry `ino: 0 / dev: 0 / uid: 0 / gid: 0` → git cannot stat-trust them and reports phantom modifications; content hashes are identical.
- RULE FOR THIS RUN: real diffs are detected ONLY via `git diff` / `git diff HEAD`, never via `git status --short`.
- `git update-index --refresh` reports "needs update" for all (stat-only mismatch), exit 0 — no content change.

## Remote
- `git fetch --all --prune` exit 0, no new refs (repo up to date).
- GitHub CLI not available → no issue lifecycle comments possible. Local run report is the temporary source of truth.

## Claimed Regression Baseline (from run card, to be re-verified at the end)
- npm test → 82/82 test files, 1054 PASS, 0 FAIL, 0 SKIP
- Production Sentinel → 53/53 PASS
- Fresh Install Sentinel → PASS
