# Verification Contract — Phase A: Controlled Cancellation / Release Proof

Run Card: OCAE-RUN-CARD-BUDGET-LIFECYCLE-MULTIPROCESS-REALITY
Risk tier: MEDIUM_REVIEW (runtime resource-policy change, additive, well-tested domain)
Execution profile: STANDARD (Spec + Plan + Tasks; Verification Contract mandatory)

## Desired behavior (Phase A)

Every shared-budget reservation created by the real runtime pipeline MUST reach
exactly one terminal state — CONSUMED | RELEASED | EXPIRED — when the run
finishes or aborts. No reservation may remain permanently RESERVED after an
aborted/exception path. Capacity must be reusable after release/expiry.
Cancellation/release must be observable (budget.shared.release with reason).

## Acceptance criteria (Phase A stop-gate)

| Criterion | Acceptance |
|---|---|
| CONTROLLED_CANCELLATION_RELEASE | pipeline-level: reserve → abort before productive spawn → RELEASE, capacity restored |
| EXCEPTION_SAFE_RELEASE | structural try/finally closure; routeExecutor throw after reserve → RELEASE, no leak |
| NO_ORPHAN_RESERVATIONS | no RESERVED record survives an aborted run (verified via governor snapshot) |
| CAPACITY_REUSE | released/expired capacity immediately reusable by a subsequent run |
| OWNERSHIP | cross-run release/commit denied (SHARED_BUDGET_OWNERSHIP_INVALID), no ledger change |
| IDEMPOTENCY | double release / double consume / release→consume / consume→release cause no drift |
| LIFECYCLE_OBSERVABILITY | budget.shared.release (and consume) events carry run_id, reservation_id, resource, status, reason, timestamp; no secrets |
| EXISTING_53 | all previous sentinel invariants remain PASS (additive only) |

## Red tests (must fail before the fix)

1. GAP-1: routeExecutor throws after reserve → reservation must NOT stay RESERVED (currently fails)
2. GAP-2: worker run_id forgery → CONTRACT_INVALID abort must NOT leave RESERVED (currently fails)

## Green tests (after the fix)

1. reserve → success → consume (existing CASE 1 stays green)
2. reserve → pre-spawn abort → release + capacity restored (new, pipeline-level)
3. reserve → exception → release (new, pipeline-level, structural)
4. reserve → cancellation → release (new; via routeExecutor seam abort)
5. release → reuse (existing CASE 4, now also pipeline-level)
6. expiry → reuse (existing CASE 5 stays green)
7. double release / double consume / release→consume / consume→release (existing governor tests stay green)
8. cross-run ownership (existing stays green)
9. no-orphan invariant on aborted runs (new)

## Reality gate criteria

- Lifecycle matrix documented from CODE + LIVE proof (GAP-1/GAP-2 reproduced before fix)
- All claims verified with actual tool output (anti-fake-execution)

## Evidence types

- LIVE proof script output (before/after)
- Test runner output (node --test, targeted + full)
- Production Sentinel output
- Validator output
- Fresh Install Sentinel output
- git diff of changed files

## Untestable assumptions (documented)

- Real provider call costs: NOT testable without live keys → mocked via routeExecutor seam
- Real multi-process contention: Phase B decides; if NOT_PROVEN, no durable ledger is built
