# T2 Packaging/install integration — fix 2026-09-13

Worker: Blackboard claim T7 (`ses_f635c79b7ffesZy2FG0T5fHPWm`). Branch: `feat/ocae-product-consolidation`.
Implements the minimum correction for the T1 gap (evidence/T1-release-audit-20260913.md §2–§3):
all canonical Blackboard files were absent from `build_backend.py` RUNTIME_FILES, so a wheel
could `verify_payload() == PASS` with zero swarm files, and no payload-path installer
materialized the swarm runtime into a target project.

## Design (mechanical derivation only — no second maintained copy)

- Single canonical source stays `.agents/skills/coordinate-blackboard-swarm/` (untouched).
- `build_backend.py` ships 10 canonical files in the payload (manifest + archive cover them
  automatically; `verify_payload()` needs no change — it already enforces exact
  manifest↔archive correspondence).
- `scripts/install-governance.mjs` owns the ONE derivation table `getSwarmFileList()`:
  5 engine entries copied at their canonical relative path (so the `swarm.ts`
  candidate `<target>/.agents/skills/.../scripts/blackboard.py` resolves) + 5 derived
  adapter entries mirroring `adapters/opencode/install.py` project mapping
  (`.opencode/tools/swarm.ts`, `.opencode/agents/swarm.md|swarm-worker.md`,
  `.opencode/plugins/blackboard-ui/{index,tui}.ts`). `install.py` itself unchanged.
- `scripts/bootstrap-project.mjs` imports that same table (no duplicated mapping) and
  materializes it via a new `swarm-file` overlay kind with copy-if-absent semantics.
- Forbidden surfaces untouched: no version bump, no `blackboard.py`/`swarm.ts`/governance/docs edits.

## Diff summary

- `build_backend.py`: +10 `RUNTIME_FILES` entries (canonical swarm skill files).
  (Note: the file also carries environment-formatter line wraps; semantically identical.)
- `scripts/install-governance.mjs` (+76/-1): `getSwarmFileList()`; file-plan entries
  (`copy-swarm-file` + dir entries, so conflicts/idempotence/manifest flow automatically);
  `copySwarmRuntime()` called in Phase 7b; `swarm_runtime` source-lock entries;
  `validatePostApply` fail-closed checks; `validateSourceRepository` preflight;
  backup set += `.opencode/tools`, `.agents`; export `getSwarmFileList`.
- `scripts/bootstrap-project.mjs` (+39): import table; `swarm-file` overlay kind
  (build/flatten/apply + `copySwarmFileIfAbsent`); missing-source skip note.
- `test/install/swarm-packaging-drift.test.mjs` (new): payload-coverage, byte-identical
  materialization + source-lock binding, second-apply `NOOP_IDEMPOTENT`.

## Test outputs (all PASS)

- `node --test test/install/swarm-packaging-drift.test.mjs` → 3/3 PASS
- `node --test test/install/product-realignment.test.mjs` → 3/3 PASS
- `node --test test/install/resident-runtime.test.mjs` → 11/11 PASS
- `node --test test/bootstrap/bootstrap.test.mjs` → 6/6 PASS
- `node --test test/bootstrap/url-only-contract.test.mjs` → 14/14 PASS
- `python3 build_backend.py --help` → exit 0; `_payload_files()` = 198 entries incl. all
  10 swarm files; `_validate_paths()` OK
- `node --check` on both edited scripts → OK
- Live `bootstrap-project.mjs --target <tmp> --apply` → engine + all 5 derived adapters
  materialized, conflicts none
- Red validation: HEAD `build_backend._payload_files()` misses 10/10 skill files
  (drift test would FAIL pre-fix); T1 audit proves pre-fix installer gap (zero
  `coordinate-blackboard-swarm|.agents/skills` hits in installer path).

## Acceptance mapping

1. Build path works; payload covers swarm files — `_payload_files()` (manifest/archive source) lists all 10. ✔
2. New drift test passes (and fails pre-fix). ✔
3. Affected existing suites green (payload/install/bootstrap above). ✔
4. This file. ✔
5. Blackboard facts + `implement PASS` result on task 7; DONE not marked (per task). ✔
