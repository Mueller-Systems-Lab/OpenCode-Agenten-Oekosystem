# Verification Contract — Shared Runtime Budget + Degraded Routing

Milestone: `GREEN_OCAE_SHARED_RUNTIME_BUDGET_DEGRADED_ROUTING_OPERATIONAL`

## Desired behavior

- A shared in-process budget governor bounds concurrent HIGH-cost
  reservations across runs that share one governor instance; a denied
  reservation blocks the worker invocation and reaches a controller terminal
  (BLOCKED, `SHARED_BUDGET_EXHAUSTED`).
- Reservation lifecycle is reserve-before-invocation / commit-after-result;
  release and TTL expiry restore capacity; commits are permanent spends
  ("only released capacity is reusable"); double commit/release is idempotent
  with no capacity drift; the ledger is memory-bounded.
- Routing ranks HEALTHY above DEGRADED deterministically (array-order-
  independent) without bypassing capability/authorization/cost gates.
- DEGRADED is only routable with `allow_degraded=true`; otherwise
  `DEGRADED_ROUTE_DENIED` (fail closed) when degraded candidates exist.

## Acceptance criteria

1. Governor unit lifecycle: reserve→commit consumes; reserve→release restores;
   reserve→expire restores; unknown id → `SHARED_BUDGET_RESERVATION_UNKNOWN`;
   wrong run_id → `SHARED_BUDGET_OWNERSHIP_INVALID` (no budget change);
   double release → idempotent, no drift; double commit → idempotent,
   consumed count == 1; release-after-commit / commit-after-release /
   commit-of-expired → `SHARED_BUDGET_RESERVATION_NOT_ACTIVE`.
2. Concurrency: capacity=2 × 3 requests → exactly 2 ok / 1 EXHAUSTED;
   capacity=10 × 100 requests → 10/90, no oversubscription; 1000-canary
   capacity=5 → 5/995.
3. Stress 100×100 = 10,000 decisions: per-iteration 10/90, OVERSUBSCRIPTION=0,
   CAPACITY_DRIFT=0, DEADLOCK=0, UNHANDLED_ERROR=0.
4. Memory bound: ledger_size ≤ retention_limit + active; active RESERVED
   records never pruned; 2000-cycle ledger stays ≤ 500.
5. Ownership: run B cannot commit/release run A's reservation (ledger
   unchanged).
6. Security: worker-output / tool-result payloads cannot mutate the ledger;
   no instruction-accepting method on the class; unknown reservation spoof
   fails closed.
7. No secret leak: serialized budget events contain no prompt/output/text/
   content/token keys.
8. DEGRADED ranking: LOW+DEGRADED vs MEDIUM+HEALTHY → MEDIUM+HEALTHY wins
   (both array orders); both DEGRADED → cheaper wins; both HEALTHY →
   unchanged; only DEGRADED + allow_degraded=true → routed with
   `DEGRADED_ROUTE_SELECTED`, degraded:true; only DEGRADED + default →
   `DEGRADED_ROUTE_DENIED`; UNKNOWN/UNAVAILABLE → `NO_HEALTHY_ELIGIBLE_MODEL`;
   DEGRADED never bypasses capability (`needs_mcp`) or cost gates
   (phase ceiling, `max_high_cost_routes=0`); health null → pre-change
   behavior; repeatability.
9. Runtime integration: CASE 1 single run reserve+consume DONE; CASE 2
   capacity=2 × 3 parallel → 2 DONE / 1 BLOCKED with 0 worker starts and
   build_result null on the denied run; CASE 3 capacity=1 × 2 → 1/1; CASE 4
   released capacity reusable; CASE 5 expired capacity reusable (real short
   wait); CASE 6a DEGRADED primary routed with degraded:true; CASE 6b only
   DEGRADED + allow_degraded=false → ROUTING_BLOCKED, 0 worker calls.
10. Sentinel 53 checks PASS; 10 new invariants in manifest + SENTINEL
    INVARIANTS; fingerprint recomputed and matching; installer + fresh-install
    include `routing/budget-governor.mjs`; `SharedBudgetGovernor` export
    resolves from the installed runtime.

## Red tests (written first, then implementation made them green)

- `test/routing/shared-budget.test.mjs` (governor unit + concurrency + stress
  + security) — 29 tests.
- `test/routing/degraded-ranking.test.mjs` (pure selectRoute ranking) — 15
  tests.
- `test/routing/shared-budget-integration.test.mjs` (canonical runtime
  through runTask) — 7 tests.

## Regression tests (must stay green unchanged)

- `test/routing/cost-governance.test.mjs`, `availability-routing.test.mjs`,
  `retry-escalation-separation.test.mjs`, `routing-policy.test.mjs`,
  `health-state.test.mjs`, `runtime-integration.test.mjs`,
  `observability.test.mjs` — plus the full `unit` group and
  `test/controller/production-sentinel.test.mjs` (updated 43→53),
  `test/install/fresh-install-sentinel.test.mjs`,
  `scripts/fresh-install-sentinel.mjs`.

## Reality gate criteria

- HEAD must be `134903cf8f124858700922775a4adcef34dac763` (content-clean
  baseline; phantom index stat entries are never staged).
- Sentinel: 53 results, all ok, status PASS.
- Fingerprint: live `computeBaselineFingerprint()` equals recorded
  `baseline_fingerprint` in `runtime/production-baseline.json`.
- All numbers in results.md come from actual executed test runs.

## Evidence types

- Test runner outputs (`node --test` per file, `node scripts/run-tests.mjs
  --group unit`) with real PASS counts.
- Concurrency/stress metrics (reserved/denied/oversubscription/drift/
  deadlock/duration/ops-per-sec) from the executed stress loop.
- Sentinel 53-count and fingerprint before/after values.
- Fresh-install sentinel PASS output (artifact + export resolution).

## Untestable assumptions

- The shared governor is single-process; cross-process sharing is explicitly
  out of scope (no distributed accounting claim).
- Default capacity 2 for `HIGH_COST_ROUTE` is a policy default chosen by the
  milestone (2 concurrent high-cost invocations), not an empirical measure.
- Real provider latency/cost for HIGH models is not measured here; the cost
  gate continues to use ordinal tier metadata.
