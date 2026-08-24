# GREEN_OCAE_SHARED_RUNTIME_BUDGET_DEGRADED_ROUTING_OPERATIONAL — Spec

Milestone: `GREEN_OCAE_SHARED_RUNTIME_BUDGET_DEGRADED_ROUTING_OPERATIONAL`
Date: 2026-08-20
Baseline HEAD (pre): `134903cf8f124858700922775a4adcef34dac763`
Pre-milestone production baseline status: `GREEN_OCAE_RUNTIME_AVAILABILITY_COST_GOVERNANCE_OPERATIONAL`, sentinel 43/43 PASS.

## Goal

Close the two empirically proven gaps of the availability/cost governance baseline:

1. **Shared Runtime Budget Governor** — a bounded, in-process resource-policy
   ledger (`runtime/routing/budget-governor.mjs`) that bounds concurrent
   HIGH-cost invocations across runs sharing one governor instance.
2. **DEGRADED routing ranking** — deterministic health-quality ordering
   (HEALTHY > DEGRADED) inside `selectRoute` / `pickEscalationRoute`, without
   bypassing capability, authorization, or cost gates.

## Scope

- SINGLE_RUNTIME_PROCESS. The governor's atomicity is single-tick
  CHECK+RESERVE in one process. Sharing across concurrent runs requires the
  caller to pass the SAME governor instance; a per-run governor is per-run.
- Reservation lifecycle inside the pipeline: reserve BEFORE worker invocation,
  commit AFTER worker result, denial → controller terminal path
  (routing_terminal evidence only — the controller stays the sole terminal
  authority).
- DEGRADED candidates are routable ONLY when
  `health_policy.allow_degraded === true`; health and cost stay separate
  dimensions (a DEGRADED LOW model can never bypass the cost gate).

## Out of scope

- No multi-process / distributed / crash-safe accounting claim.
- No money accounting, no queues (no Redis/PostgreSQL/SQLite/n8n; no new npm
  dependencies).
- No second routing engine and no second budget engine — the governor is
  RESOURCE POLICY wired into the existing run/pipeline code path; the existing
  per-run budgets (`max_high_cost_routes`, `max_model_escalations`,
  `max_provider_fallbacks`, `max_attempts_per_route`) stay as they are.
- No push, no PR, no tag, no version bump.

## Final ranking pipeline (module header of routing-policy.mjs)

1. Capabilities (`modelMeetsRequirements`)
2. Authorization (provider allowlist)
3. Hard Health Eligibility (`healthRoutable` gate)
4. Health Quality Ranking (HEALTHY rank 0 > DEGRADED rank 1)
5. Cost Policy (cost gate incl. phase ceilings)
6. Per-Run Budget (`max_high_cost_routes`)
7. Shared Runtime Budget (governor reserve at invocation, wired in pipeline)
8. Deterministic Tie-Break (`candidateScore` then provider+model localeCompare)

## Reservation lifecycle (pipeline)

1. reserve() BEFORE worker invocation (only when the route is HIGH cost and
   the shared resource is `HIGH_COST_ROUTE`); denial → BLOCKED with
   `SHARED_BUDGET_EXHAUSTED`, worker NOT invoked (productive calls = 0).
2. commit() AFTER worker result (both success and failure outcomes); an
   idempotent commit emits PASS with strategy_delta `IDEMPOTENT`.
3. Retry/escalation/fallback iterations reserve anew per invocation — one
   reservation per invocation, never implicit reuse of a previous reservation.
4. Abandoned reservations (worker abort, process error) are recovered by TTL
   expiry (`expireStale`) on the next reserve within the surviving process.

## Acceptance criteria summary

- `SharedBudgetGovernor` with exact lifecycle semantics (reserve/commit/
  release/expire/prune/snapshot), injectable clock, bounded ledger
  (retention_limit, active records never pruned), run_id ownership
  enforcement, fail-closed denial codes, and NO instruction-accepting method
  (WORKER_CANNOT_MUTATE).
- 5 budget event jobs declared; `budgetSharedEvent` carries budget metadata
  only — no prompts/text/output (SHARED_BUDGET_NO_SECRET_LEAK).
- HEALTHY beats DEGRADED deterministically and array-order-independently;
  existing behavior intact for health=null, allow_degraded=false, single
  candidate. `DEGRADED_ROUTE_DENIED` only when degraded candidates exist but
  `allow_degraded` is off.
- Runtime wiring: `routing.shared_budget = { enabled, governor, resources,
  resource, ttl_ms, retention_limit }` in runTask; `sharedBudget` option in
  runPipeline; default HIGH_COST_ROUTE capacity 2.
- Sentinel 53/53 (43 prior + 10 new), fingerprint recomputed, installer +
  fresh-install ship the new artifact, new unit/integration tests green.
