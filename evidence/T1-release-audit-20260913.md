# T1 Release/distribution truth — audit 2026-09-13

Branch: `feat/ocae-product-consolidation` · HEAD `87bc626` (ahead of `v1.0.7` @ `4d6d458`).
Read-only audit; no source files edited.

## (1) Version truth

| Source | Value | Ref |
|---|---|---|
| Manifest version | `1.0.7` | `ecosystem.manifest.json:3` |
| Git tag | `v1.0.7` exists; HEAD does **not** match it (`git describe --exact-match HEAD` → fatal) | `git tag --list`, `git rev-list -n 1 v1.0.7` → `4d6d4586e98e60976e89cb426e77edee35a3bfef` |
| `src/ocae_cli/__init__.py` fallback | `__version__ = "0.0.0"` on `ImportError` | `src/ocae_cli/__init__.py:1-4` |
| `_version.py` generation | **From manifest, not from git tag.** `_prepare_payload()` reads `ecosystem.manifest.json["version"]` and writes `src/ocae_cli/_version.py` as `__version__ = "<version>"` (`build_backend.py:206-208`). Pre-built fallback: if manifest is absent (installed wheel context) but a previous `ocae-payload-manifest.json` exists, `_version.py` is re-written from `existing["package_version"]` (`build_backend.py:199-204`); otherwise `RuntimeError`. | `build_backend.py:198-208` |
| Wheel version wiring | `pyproject.toml:8` `dynamic = ["version"]` + `[tool.setuptools.dynamic] version = { attr = "ocae_cli.__version__" }` (`pyproject.toml:37-38`), so the built dist version == generated `_version.py` == manifest version. Package data ships `_payload/*.tar.gz`, `_payload/*.json`, `_version.py` (`pyproject.toml:33-35`). | `pyproject.toml:1-41` |
| Drift note | `v1.0.7..HEAD` diff is large (`143 files changed`, mostly post-tag work incl. swarm docs); manifest still `1.0.7`, so any build from current HEAD stamps `1.0.7` with a **newer** `source_commit`. Provenance distinguishes them via `source_commit`/`source_ref`, not version alone (see §4). | `git diff --stat v1.0.7..HEAD` |

**Conclusion:** version flows manifest → `_version.py` → wheel metadata. Git tag `v1.0.7` is a release marker only; it is never read by the build. `0.0.0` appears only when `_version.py` was never generated (source checkout without build, or broken install).

## (2) Payload completeness — `RUNTIME_FILES` vs canonical Blackboard skill

`RUNTIME_FILES` (`build_backend.py:20-67`, 46 explicit entries) covers: `scripts/install-governance.mjs`, `scripts/lib/**` (16 files), `runtime/approval/*` + `runtime/gates/*` + `runtime/bootstrap/task-bootstrap.mjs`, `governance/**` (generated + policy), `PROMPT-KERNEL.md`, `bootstrap/**`, `scripts/generate-governance.mjs`, `scripts/check-governance-drift.mjs`, `.agent-governance/bin/evaluate.mjs`, `ecosystem.manifest.json`.

Dynamic expansion (`_payload_files`, `build_backend.py:142-162`) additionally globs **entire** `runtime/**`, `scripts/lib/**`, `.opencode/agents/**`, `.opencode/skills/**`, `.opencode/policies/**`. Nothing else is added.

Canonical Blackboard skill tree (observed on disk):
`.agents/skills/coordinate-blackboard-swarm/{SKILL.md, scripts/blackboard.py, adapters/opencode/{swarm.ts, swarm.md, swarm-worker.md, install.py, swarm-ui/index.ts, swarm-ui/tui.ts}, agents/openai.yaml, references/protocol.md}`.

### Gap table

| # | Canonical Blackboard file | In `RUNTIME_FILES`? | In dynamic glob? | Verdict |
|---|---|---|---|---|
| 1 | `.agents/skills/.../SKILL.md` | No | No (glob covers `.opencode/skills`, not `.agents/skills`) | **GAP — not packaged** |
| 2 | `.agents/skills/.../scripts/blackboard.py` | No | No (only `scripts/lib/**`, not `.agents/.../scripts`) | **GAP — not packaged** |
| 3 | `.agents/skills/.../adapters/opencode/swarm.ts` (native swarm tool) | No | No | **GAP — not packaged** |
| 4 | `.agents/skills/.../adapters/opencode/swarm-worker.md` | No | No (`ls .opencode/agents/` shows 13 agents, no `swarm-worker.md`; `.opencode/tools/` does not exist) | **GAP — not packaged** |
| 5 | `.agents/skills/.../adapters/opencode/swarm-ui/` (`index.ts`, `tui.ts`, read-only observer) | No | No | **GAP — not packaged** |
| 6 | `.agents/skills/.../references/protocol.md` | No | No | **GAP — not packaged** |
| 7 | `.agents/skills/.../adapters/opencode/install.py` (the actual swarm delivery vehicle) | No | No | **GAP — not packaged** |

Programmatic check: none of the 46 `RUNTIME_FILES` entries contains `SKILL.md`, `blackboard.py`, `swarm.ts`, `swarm-worker`, `swarm-ui`, `protocol.md`, or `.agents/`. `verify_payload()` (`src/ocae_cli/payload.py:81-124`) enforces exact manifest↔archive correspondence (fails on missing **and** unexpected members), so the omission is structural, not a verification hole: a URL-installed CLI can pass `verify_payload() == PASS` while containing **zero** Blackboard files.

**Conclusion:** the `ocae-cli` wheel distributes the governance/bootstrap runtime only. The Blackboard swarm runtime ships exclusively via the vendored `.agents/skills/coordinate-blackboard-swarm/` tree in a git checkout plus its `install.py` adapter (see §3). Any consumer that installs **only** the wheel/URL payload gets no `blackboard.py`, no `swarm.ts` native tool, no `swarm-worker.md`, no observer UI, no protocol doc.

## (3) Installer — how the swarm runtime is (not) delivered

| Installer | Mechanism | Swarm runtime? | Idempotent second run? |
|---|---|---|---|
| `scripts/install-global.mjs` | Physical **copy** (`copyFile` via `copyTreeSafe`, `install-global.mjs:214-251`; top-level `AGENTS.md`/`CONTRIBUTING.md`/`SECURITY.md` + `opencode.jsonc→opencode.json[c]` via `copyFile`, `:135-156`). Skips symlinks, refuses root/symlinked repo root, backs up existing config to timestamped `.backups/install-<ts>` (`:103-115`). **No symlink, no generation** of swarm files. | **No.** Copies `.opencode/` → global `.opencode/` plus `agents/`, `skills/` mirrors (`:124-133`). Never touches `.agents/skills/coordinate-blackboard-swarm/` and never installs `swarm.ts`/`swarm-worker.md`. | **No idempotence marker.** Re-run copies again and creates a **new** timestamped backup. Safe (backup + boundary checks) but not `NOOP_IDEMPOTENT`. |
| `scripts/bootstrap-project.mjs` | Project-local **copy-if-absent / preserve-on-conflict** (`syncTree`, `:489-524`: copies only missing files; identical content skipped; differing existing files left untouched) + `mergeManagedSections` for `AGENTS.md`-style docs (`:453-487`) + `mergeDeep` config merge. Refuses symlinked sources (`:499`, `:570-572`), records conflicts (`collectTreeFiles`, `:563-600`). Tree scope is `.opencode/{agents,skills,policies,templates,validation,prompts,hooks}` + hermes bundle + optional `.github/workflows` (`buildOverlay`, `:358-433`). | **No.** Overlay source dirs are under `.opencode/`; the Blackboard skill lives under `.agents/skills/` which is outside the overlay. `grep` for `coordinate-blackboard-swarm|.agents/skills` in `scripts/install-governance.mjs`, `scripts/bootstrap-project.mjs`, `src/ocae_cli/` returns **zero** hits. A bootstrapped project receives no `blackboard.py`, no `swarm.ts`, no `swarm-worker.md`. | Second apply **is** idempotent at the `install-governance.mjs` layer: `isIdempotentInstallation()` → `NOOP_IDEMPOTENT` (`install-governance.mjs:2020-2042`), asserted by `test/bootstrap/url-only-contract.test.mjs:108` (`secondResult.mode == "NOOP_IDEMPOTENT"`) and `test/install/*.test.mjs`. `bootstrap-project.mjs` itself returns exit `0` for `VERIFIED_IN_SCOPE`/`NOOP_IDEMPOTENT` (`:550`). |
| Canonical runtime path (`src/ocae_cli/runtime.py:run_canonical`, `:116-165`) | Materializes the wheel payload to a temp dir (`materialize_payload` → `extract_payload` with hash/size re-check, `payload.py:137-165`), runs `scripts/install-governance.mjs --target … [--apply] [--mode …]` via node (`runtime.py:133-152`), propagates `OCAE_BOOTSTRAP_SOURCE_{COMMIT,REPOSITORY,REF}` from the payload manifest (`runtime.py:78-88`). **Copy-based** (`copySourceIfSafe`: temp-file + rename, `:1117-1140`); **no symlinks** anywhere in the write path. | Same gap as above: payload has no Blackboard files, so the canonical installer cannot deliver them either. | Yes — `NOOP_IDEMPOTENT` with `post_validation` + `idempotence: "PASS"` (`install-governance.mjs:2020-2042`). Downgrades refused (`:2014-2017`). |
| Actual swarm delivery | `.agents/skills/coordinate-blackboard-swarm/adapters/opencode/install.py` — **copy** (`shutil.copyfile`) of 5 managed adapter files to `{repo}/.opencode/{tools/swarm.ts, agents/swarm.md, agents/swarm-worker.md, plugins/blackboard-ui/*}` (project) or `$HOME/.config/opencode/…` + full skill tree mirror (global `--global`), guarded by managed-adapter markers + sha256 manifest (`coordinate-blackboard-swarm.manifest.json`) with `UNMANAGED_COLLISION` fail-closed (`install.py:52-87`). | **Yes — the only vehicle.** Requires a git checkout containing `.agents/skills/…` (or a prior global skill install) + `opencode` on PATH (`install.py:31-33`). Not reachable from the wheel. | Project mode rewrites unconditionally (no manifest, no noop); global mode is collision-aware but still rewrites managed files. Not `NOOP_IDEMPOTENT`-classified; prints `INSTALL|PASS|MANAGED_FILES=n|…|SCOPE=…` (`install.py:87`). |

**Conclusion:** neither `install-global.mjs` nor `bootstrap-project.mjs` (nor the wheel-driven `install-governance.mjs`) delivers the swarm runtime; all three use physical copies, never symlinks, and only the governance path is second-run idempotent (`NOOP_IDEMPOTENT`). Swarm installation is a separate out-of-band `install.py` copy step available only to checkout holders.

## (4) Provenance — source-SHA / payload-hash / archive-hash recording

Recorded at build time in `build_backend.py:_prepare_payload` (`:198-231`):

```python
# build_backend.py:221-231
manifest = {
    "manifest_version": "1.0.0",
    "package_version": version,          # == ecosystem.manifest.json["version"]
    "ecosystem_version": version,
    "source_repository": _source_repository(),  # OCAE_SOURCE_REPOSITORY override or `git remote get-url origin`, https-normalised, non-github → canonical constant (:100-108)
    "source_commit": _source_commit(),          # OCAE_SOURCE_COMMIT override, else `git rev-parse HEAD`; dirty worktree → RuntimeError unless OCAE_ALLOW_DIRTY_BUILD=1 → "DIRTY_WORKTREE" (:111-120)
    "source_ref": _source_ref(),                # OCAE_SOURCE_REF override, else symbolic-ref HEAD or `git describe --tags --exact-match` (:123-131)
    "files": file_entries,                      # per-file {relative_path, sha256, size} over RUNTIME_FILES + dynamic globs (:212-219)
    "archive_sha256": _sha256(ARCHIVE_PATH),    # sha256 of canonical-runtime.tar.gz (:229)
}
```

Per-file hashes use `hashlib.sha256` (`_sha256`, `:134-139`); the archive is deterministic (uid/gid 0, empty uname/gname, mtime 0, mode 0644, `gzip.mtime=0` — `_tar_filter` `:177-184`, `_write_archive` `:187-195`).

Surfaced at runtime:

- `src/ocae_cli/payload.py:payload_manifest()` (`:25-26`) reads the shipped `ocae-payload-manifest.json`; `verify_payload()` (`:81-124`) re-hashes the archive (`archive_sha256`), every member (sha256 + size), and rejects extra members; `verify_package_record()` (`:41-78`) cross-checks wheel `RECORD` digests.
- `src/ocae_cli/provenance.py:provenance()` (`:18-50`) returns `{distribution, version, source_repository, source_commit, source_ref, payload_sha256 (= manifest archive_sha256), payload_file_count, direct_url:{url, vcs, requested_revision, commit_id}}`, preferring PEP 610 `direct_url.json` (`_direct_url`, `:10-15`) for repo/commit when present. `integrity_report()` (`:53-57`) bundles both verifications.
- CLI: `ocae provenance [--json]` (`cli.py:148-150`), `ocae install/update` refuse to proceed unless `verify_payload().status == PASS` (`cli.py:111-115`); `run_canonical` exports the manifest triple as `OCAE_BOOTSTRAP_SOURCE_{COMMIT,REPOSITORY,REF}` (`runtime.py:78-88`).
- Target-side binding: `doctor.py:_project_reconciliation` (`:97-111`) compares payload `source_commit` against `.agent-governance/runtime-state.json` (`source_commit` + `ocae_version` + sha256 integrity binding `:83-86`) → `CURRENT | MIGRATION_REQUIRED | INCOMPATIBLE | CORRUPT`; `install-governance.mjs` writes `source-lock.json` (per-installed-file `sha256:size`) and refuses silent downgrades.
- Note: the committed source tree's `src/ocae_cli/_payload/` currently contains only `__init__.py` — the manifest + archive are **build-generated**, so provenance of a source checkout is prospective (visible only after `pip build` / `build_wheel`), not checked in.

**Conclusion:** full hash provenance exists (source SHA + per-file SHA + archive SHA + package RECORD), is verified before any install/extract, and is bound to target state. It covers exactly the §2 file set — i.e. it proves the governance payload but says nothing about the Blackboard files, which are outside the hashed set.
