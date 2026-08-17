# Soak Milestone — Lightweight Spec + Verification Contract (LOW_LOCAL / COMPACT)

## Desired Behavior
The contract-first runtime (`runtime/run.mjs` → runTask) is exercised by a controlled
corpus of >=10 real task classes through the canonical entry. For each case we capture
deterministic machine-readable metrics. Proven weaknesses get targeted fixes with
regression tests; no speculative architecture changes.

## Scope
IN: runtime soak corpus, soak runner (measurement harness only), metrics, calibration
reports, targeted fixes with regression tests, docs.
OUT: no new agents/controllers/gates/contract versions/scheduler/retry-system.

## Acceptance Criteria
1. SOAK_CORPUS_CREATED=PASS: corpus with >=10 task classes under test/fixtures/runtime-soak/
2. CANONICAL_ENTRY_USED=PASS: every case runs through runtime/run.mjs runTask (via
   scripts/run-task.mjs or direct runTask import — the canonical entry, never decide() directly)
3. RUN_ID_CORRELATION=PASS: exactly one run_id per case across all phases
4. Machine-readable results: evidence/runtime-soak/results.json (no secrets)
5. Documentation: docs/runtime-soak-report.md
6. ROUND_1_COMPLETE and ROUND_2_COMPLETE (corpus run twice; targeted fixes between)
7. No regression: test suite still passes (except documented Windows symlink EPERM limitation)
8. Every found runtime bug: root cause + minimal fix + regression test

## Red Tests
- Soak corpus cases that should deterministically fail in Round 1 (e.g. Case 4 SPLIT,
  Case 7b BLOCKED, Case 10 security block) — verify they actually fail/split/block.

## Regression Tests
- Existing manifest suite (unit, contract, e2e, governance, bootstrap) — all must stay green
  except documented NON_BLOCKING_HOST_LIMITATION (Windows symlink EPERM).

## Reality Gate
- Each soak case produces a real terminal decision from the deterministic controller
  with real run events on disk (evidence/runtime-soak/events/*.jsonl).
- Verify checks are REAL tool executions (node --test, node --check) — not claims.

## Evidence Types
| Evidence | Source | How |
|----------|--------|-----|
| results.json | soak runner | machine-readable per-case + aggregate metrics |
| run-events.jsonl | runtime observability | real events per run_id per case |
| docs/runtime-soak-report.md | analysis | narrative calibration report |
| test output | run-tests.mjs | regression proof |

## Untestable Assumptions
- Real LLM worker behavior is simulated by deterministic build executors in the harness;
  real provider/model routing is measured only where locally possible (no external API
  calls without credentials). Provider/model field = reported or COST_NOT_AVAILABLE.
- Windows host cannot create symlinks (Developer Mode off) → symlink-dependent tests
  remain NON_BLOCKING_HOST_LIMITATION.
