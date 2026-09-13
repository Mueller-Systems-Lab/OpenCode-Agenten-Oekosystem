# T4 Governance/Swarm Authority Unification — 2026-09-13

- Task: 9 ("T4 Governance/Swarm authority unification")
- Worker: native `swarm` claim (session-derived ID; lease per native tool)
- Branch: feat/ocae-product-consolidation
- Scope: docs + tests only; no changes to blackboard.py engine, swarm.ts, build_backend.py, installers

## Canonical model

BLACKBOARD MAY PRIORITIZE WORK, MUST NEVER GRANT AUTHORITY; GOVERNANCE V2 AUTHORIZES EFFECTS.

- swarm = user-facing coordination/scheduling facade (prioritization, matching, signals/inhibitions/votes/scout facts as scheduling data only).
- Governance V2 = authority enforcement (gates, PASS evidence, quorum, admit/done transitions).
- Specialized OCAE agents = workers/reviewers/scouts; swarm-worker = generic fallback executing one claimed task.
- issue-orchestrator remains the primary orchestrator; swarm is coordinator-only with no authority (no approve/merge/deploy/authorize).

## Changes (minimum diff)

- `ecosystem.manifest.json`: added `swarm` + `swarm-worker` entries to `catalogs.agents.generic` (facade role + no authority) and matching `catalogs.agents.profiles` entries (coordinator-only `allowed_operations`; `approve/merge/deploy` absent from allowed, present in denied). Existing agents untouched. `node -e JSON.parse` OK; capability-profile spot check OK.
- `test/governance/swarm-authority-invariant.test.mjs`: 4 executable regression tests driving real `blackboard.py` on temp DBs (see below).

## Regression tests

File: `test/governance/swarm-authority-invariant.test.mjs`

1. Coordination signals never create PASS gates: after signal/inhibit/vote/scout/match, snapshot gates unchanged (only preflight PASS) and `green --require preflight` still fails (open RUNNING task).
2. PROPOSED→READY requires admit with evidence: `admit` without `--evidence` fails (exit 2); blank evidence fails (`ADMISSION_EVIDENCE_REQUIRED`); task stays PROPOSED; admit with evidence → READY.
3. DONE requires PASS result + quorum: `done` without result fails (`PASS_EVIDENCE_REQUIRED`); `done` with PASS result but no quorum fails (`QUORUM_NOT_MET`); reviewer PASS vote + result → `done` succeeds (DONE).
4. Manifest declares swarm as coordinator-only: generic catalog contains `swarm`/`swarm-worker` with facade + no-authority descriptions; profiles exclude approve/merge/deploy from `allowed_operations`; `issue-orchestrator` still present.

## Test output (exact, `node --test test/governance/swarm-authority-invariant.test.mjs`, exit 0)

```text
usage: blackboard.py admit [-h] --evidence EVIDENCE id
blackboard.py admit: error: the following arguments are required: --evidence
ERROR|ADMISSION_EVIDENCE_REQUIRED
ERROR|PASS_EVIDENCE_REQUIRED|task=1
ERROR|QUORUM_NOT_MET|task=1|0/1
✔ coordination signals never create PASS gates (signal/inhibit/vote/scout/match) (3157.804787ms)
✔ PROPOSED admits to READY only with evidence (1727.99796ms)
✔ DONE requires a PASS result plus quorum (2566.074504ms)
✔ manifest declares swarm as coordinator-only with no authority (1.537403ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7862.736659
```

The three `ERROR|...` lines plus the argparse usage line are expected negative-path emissions (missing evidence / missing result / missing quorum), not failures (fail=0, exit 0).

## Validation

- `node -e JSON.parse(ecosystem.manifest.json)` → JSON_OK
- Capability-profile spot check (required keys, agent_id match, FAIL_CLOSED preflight) → PROFILES_OK
- Full `scripts/validate-ecosystem.mjs` not run (runs entire suite; exceeds task budget); JSON parse + catalog/profile spot check used per acceptance fallback.
- No commits/pushes. DONE not marked (per task instruction).
