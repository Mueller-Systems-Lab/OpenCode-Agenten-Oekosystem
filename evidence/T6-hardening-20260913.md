# T6 Blackboard schema/run/dependency hardening — 2026-09-13

Worker: ses_f63528519ffeIfK1teGfCRbKIl (task 11, claimed via native swarm tool)
Scope: `.agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py` + `test/blackboard-hardening.test.mjs` only.
No commits/pushes. No changes to build_backend.py, installers, swarm.ts, governance, docs.

## Design notes (minimal, fail-closed, no second state machine)

- A. SCHEMA VERSIONING: `meta(k,v)` table, `schema_version='2'` (2 = current biological schema).
  `schema()` creates `meta` and stamps 2 when absent (auto-migrates legacy boards, incl. the
  production `.agent/board.sqlite` which had no meta). `require_schema()` runs after `schema()`
  and exits `ERROR|SCHEMA_MISMATCH|expected=2|found=X` on any mismatch (older or unknown-newer).
- B. RUN IDENTITY: `runs(id,created_at,note)`; `tasks.run_id` nullable (NULL = legacy run, history preserved).
  `run-create --note` prints `RUN|<id>`; `run-current` prints `RUN|<id>|note` or `RUN|NONE`.
  `add`/`propose` accept `--run` (validated, `ERROR|RUN_NOT_FOUND` otherwise).
  `status` appends `|run:<current|none>|runs:<legacy=N,run:K=M>`; `snapshot` adds `runs[]`, `current_run`,
  `schema_version` and per-task `run_id`; `watch` shows a `RUN` line. Scheduler does NOT filter by run.
- C. TASK DEPENDENCIES: `deps(task_id,depends_on)` PK(task_id,depends_on), FK cascade.
  `dep <id> --on <depId>` rejects self (`ERROR|SELF_DEPENDENCY`) and reverse-edge cycles
  (`ERROR|DEPENDENCY_CYCLE`, minimal check per scope). `next` excludes READY tasks with unmet deps
  and prints `T|NONE|blocked:N` when READY exist but all are dep-blocked (plain `T|NONE` when none READY).
  `snapshot` includes `deps[]`.
- D. LEASE RENEWAL: `renew <id> --worker W --lease S` extends only an unexpired own claim on a RUNNING
  task (`ERROR|RENEW_DENIED` otherwise, `ERROR|LEASE_TOO_SHORT` for <30). Prints `C|...|renewed`.
- E. IDEMPOTENCY: same-worker `claim` on a held task extends and returns `C|...|renewed` instead of erroring.
  `result` with identical (kind,status,ref) returns the existing `R|` line without inserting a duplicate row
  (different ref still inserts).

## Test outputs (real CLI on temp DBs)

test/blackboard-hardening.test.mjs — 11/11 PASS:
  A1 init stamps schema_version 2 and snapshot reports it
  A2 unknown-newer and older versions fail closed
  B1 run-create/run-current and --run tagging with status display
  B2 add --run with unknown run fails
  C1 dep rejects self-dependency
  C2 dep rejects reverse-edge cycle and next excludes blocked deps
  C3 next prints blocked hint when all READY are dep-blocked
  C4 snapshot includes deps
  D1 renew extends own unexpired claim, denies others
  E1 claim idempotency returns renewed marker
  E2 result dedup avoids duplicate rows (identical ref deduped, new ref inserts)

Regression (existing blackboard-touching suites, all PASS):
  test/blackboard-biological.test.mjs — 3/3 PASS
  test/governance/swarm-authority-invariant.test.mjs + test/install/swarm-packaging-drift.test.mjs — 7/7 PASS

## Production board check

`status` on `.agent/board.sqlite` after migration:
  STATUS|tasks:BLOCKED:1,DONE:4,READY:12,RUNNING:3|gates:...|expired:2|run:none|runs:legacy=20
Legacy tasks preserved as `legacy` run; no deletions.
