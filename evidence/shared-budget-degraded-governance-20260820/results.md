# Results — Shared Runtime Budget + Degraded Routing

Milestone: `GREEN_OCAE_SHARED_RUNTIME_BUDGET_DEGRADED_ROUTING_OPERATIONAL`
Date: 2026-08-20 (all commands executed on this date against HEAD `134903cf…`)

## Test commands and real PASS counts

### Existing routing tests (regression gate, step 4 — run before wiring)

```
node --test test/routing/cost-governance.test.mjs test/routing/availability-routing.test.mjs \
  test/routing/retry-escalation-separation.test.mjs test/routing/routing-policy.test.mjs \
  test/routing/health-state.test.mjs
# tests 64 | pass 64 | fail 0
```

### New tests

```
node --test test/routing/shared-budget.test.mjs
# tests 29 | pass 29 | fail 0        (governor unit + concurrency + stress + security)

node --test test/routing/degraded-ranking.test.mjs
# tests 15 | pass 15 | fail 0        (pure selectRoute ranking)

node --test test/routing/shared-budget-integration.test.mjs
# tests 7  | pass 7  | fail 0        (canonical runtime through runTask; CASE 5 includes one real 1600ms wait)
```

### Runtime integration + observability regression

```
node --test test/routing/runtime-integration.test.mjs test/routing/observability.test.mjs
# tests 12 | pass 12 | fail 0
```

### Sentinel + installer + fresh install

```
node --test test/controller/production-sentinel.test.mjs
# tests 25 | pass 25 | fail 0   (53 invariants; 6 new negative drift fixtures)

node --test test/install/fresh-install-sentinel.test.mjs test/install/red-test-validate-post-apply-security.test.mjs
# tests 10 | pass 10 | fail 0

node scripts/fresh-install-sentinel.mjs
# status PASS; routing_resolves PASS; artifact_routing_budget_governor PASS
```

### Full unit group (final gate)

```
node scripts/run-tests.mjs --group unit
# EXPECTED_TEST_FILES: 41 | EXECUTED_TEST_FILES: 41
# TESTS: 558 | PASSED: 558 | FAILED: 0 | FINAL_STATUS: PASS | EXIT_CODE: 0
```

An earlier run of the group showed 556/558 with the 2 expected
BASELINE_FINGERPRINT failures BEFORE the fingerprint recompute (the recorded
fingerprint still pointed at the old structural properties). After
recomputing `baseline_fingerprint` (48dcc666…) and updating
`runtime/production-baseline.json`, the same group is fully green.

## Concurrency / stress numbers

```
CONCURRENCY 1 (capacity=2, 3 concurrent, repeated 3x):
  reserved=2 per round | denied=1 (SHARED_BUDGET_EXHAUSTED) | remaining=0 | active=2

CONCURRENCY 2 (capacity=10, 100 concurrent):
  reserved=10 | denied=90 | remaining=0 | sum(reserved)=10=capacity → oversubscription=0

1000-canary (capacity=5, 1000 concurrent):
  reserved=5 | denied=995

STRESS (100 iterations × 100 concurrent = 10,000 decisions, capacity=10/iter):
  reserved=1000 (10/iter) | denied=9000 (90/iter)
  OVERSUBSCRIPTION=0 | CAPACITY_DRIFT=0 | DEADLOCK=0 | UNHANDLED_ERROR=0
  duration=105ms | ~94,973 decisions/sec
```

Note on CAPACITY_DRIFT: per the interleaving invariant ("only released
capacity is reusable"), commit is a permanent spend; the drift check therefore
releases all reservations of each iteration and asserts remaining === capacity
exactly.

## Integration outcomes

- CASE 1 (single run, default per-run governor): DONE; `budget.shared.reserve`
  + `budget.shared.consume` present; worker invoked exactly once.
- CASE 2 (ONE governor capacity=2, 3 parallel runs): 2 DONE / 1 BLOCKED
  (`SHARED_BUDGET_EXHAUSTED`); denied run: `model.worker.start` count = 0,
  `build_result` = null; governor snapshot: consumed=2, remaining=0.
- CASE 3 (capacity=1, 2 parallel): 1 DONE / 1 BLOCKED; high-cost calls = 1.
- CASE 4 (release before invocation): remaining restored to capacity; a
  subsequent runTask reserved+committed successfully.
- CASE 5 (TTL 1500ms clamp; abandoned reservation + 1600ms real wait):
  expiry recovered the slot; runTask succeeded; snapshot expired=1,
  consumed=1.
- CASE 6a (primary DEGRADED + allow_degraded=true): routed on
  deepseek-v4-flash with health_status=DEGRADED, degraded=true,
  routing_reason=PRIMARY_ROUTE; DONE.
- CASE 6b (only DEGRADED + allow_degraded=false): ROUTING_BLOCKED,
  BLOCKED/DEGRADED_ROUTE_DENIED, worker calls = 0.

## Sentinel count

- Before: 43/43 PASS (baseline).
- After: 53 results, all ok, `runProductionSentinel` status PASS
  (43 prior + 10 new shared-budget/degraded invariants).

## Fingerprint before / after

- Before: `7f746f021e3bf0bec789621beb3ae0fffdd61ebc2afd0c59965e55b3e5e5786f`
- After:  `48dcc666c4292bd8c1df7e80c70e6dc9f1e83ed148740b2f8c347e80d604ebdd`

Computed with:
`node --input-type=module -e "import {computeBaselineFingerprint} from './scripts/lib/production-sentinel.mjs'; computeBaselineFingerprint({repoRoot: process.cwd()}).then(r=>console.log(r.fingerprint))"`

## Review fixes

Independent review-agent findings applied on 2026-08-20 (same repo, same
conventions). Real numbers from the executed runs below.
### FIX 1 — budget bypass on escalation (milestone §18/§55)
`runtime/pipeline/pipeline.mjs`: the routed escalation/fallback seam now
resolves the transition target's catalog entry ONCE (line 499) and merges
REAL tier metadata (`cost_tier` / `quality_tier` / `context_tier` /
`health_status`, lines 534–537) into the rebuilt `routeState`, falling back
to current values when the entry is missing. The per-run high-cost counter
and the shared-budget reservation gate now apply to the new route. Also fixed
a latent ReferenceError surfaced by the scenario: the defensive cost gate used
shorthand `high_cost_routes_used` (undefined) instead of `highCostRoutesUsed`
(line 507) — only reachable when a `cost_policy` is active AND a transition
attempts, so no prior test hit it.

New tests (`test/routing/shared-budget-integration.test.mjs`):
- escalation LOW → HIGH (`openai/gpt-5.4`) with capacity 2: DONE; rebuilt
  routeState carries `cost_tier='HIGH'`; `budget.shared.reserve` for
  openai/gpt-5.4 precedes the escalated `model.worker.start`; escalated
  invocation happened; `budget.shared.consume` follows; governor consumed=1.
- escalation into exhausted capacity (capacity 1 pre-held): BLOCKED
  `SHARED_BUDGET_EXHAUSTED` via the canonical controller path; escalated
  worker NOT invoked (worker.start count 1, no gpt-5.4 call); `budget.shared.deny`
  emitted with `failure_signature=BUDGET:SHARED_BUDGET_EXHAUSTED`; build_result null.

### FIX 2 — TTL determinism (§24)
`runtime/routing/budget-governor.mjs`: commit() (line 214) and release()
(line 241) now return `{ ok:false, code:'SHARED_BUDGET_RESERVATION_EXPIRED' }`
for a RESERVED reservation past `expires_at`, deterministically and WITHOUT
mutation, regardless of whether `expireStale` has run; an EXPIRED-status
record also returns RESERVATION_EXPIRED. Idempotency intact: a reservation
committed BEFORE expiry stays CONSUMED past TTL (commit idempotent true).
Existing test 'commit of EXPIRED → NOT_ACTIVE' updated to RESERVATION_EXPIRED.

New unit tests (`test/routing/shared-budget.test.mjs`): late commit → EXPIRED
(no mutation, capacity not spent, then expireStale restores); late release →
EXPIRED; committed-before-expiry stays CONSUMED idempotent.

### MINOR 1 — fail closed on misconfig
`runtime/run.mjs` (line 188): `routing.shared_budget.enabled` with an
explicitly configured `resource !== 'HIGH_COST_ROUTE'` now throws a
deterministic `Error('CONFIG_INVALID:shared_budget.resource must be
HIGH_COST_ROUTE (only resource wired this milestone)')` — loud, not an inert
budget seam. Test: `assert.rejects(runTask(...), /CONFIG_INVALID:shared_budget\.resource .../)`.

### MINOR 2 — controller external blockers
`runtime/controller/controller.mjs` (lines 38, 49): `SHARED_BUDGET_RESERVATION_DENIED`
added next to `SHARED_BUDGET_EXHAUSTED` (→ BLOCKED); header comment updated
(per-run budget exhaustion stays SPLIT; shared-budget denials are external
constraints → BLOCKED).

### MINOR 3 — release/expire jobs documentation
`runtime/routing/budget-governor.mjs` header (line 50, EVENT JOBS NOTE):
`budget.shared.release` / `budget.shared.expire` are governor-level lifecycle
jobs (exercised at governor level in tests; reserved in the pipeline this
milestone — no controlled-cancellation path yet; cancellation releases at
governor level; abandoned reservations recover via TTL → expireStale).

### MINOR 4 — sentinel atomic-reservation strengthening
`scripts/lib/production-sentinel.mjs` (lines 1385–1386):
`checkSharedBudgetAtomicReservation` now additionally requires the structural
reserve-body markers `expireStale({ now: current })` and
`reservation_id: crypto.randomUUID()` (comment alone no longer satisfies the
check). Negative drift test (test/controller/production-sentinel.test.mjs)
now removes BOTH the comment marker AND the structural
`reservation_id: crypto.randomUUID()` marker and asserts the structural
removal is detected.

### Gate runs after the fixes (real numbers)

```
node --test test/routing/shared-budget.test.mjs
# tests 32 | pass 32 | fail 0        (+3 TTL-determinism unit tests)

node --test test/routing/shared-budget-integration.test.mjs
# tests 10 | pass 10 | fail 0        (+2 escalation, +1 config fail-closed)

node --test test/routing/degraded-ranking.test.mjs test/routing/retry-escalation-separation.test.mjs \
  test/routing/availability-routing.test.mjs test/routing/cost-governance.test.mjs
# tests 49 | pass 49 | fail 0

node --test test/controller/production-sentinel.test.mjs
# tests 25 | pass 25 | fail 0

node scripts/run-tests.mjs --group unit
# TESTS: 564 | PASSED: 564 | FAILED: 0 | FINAL_STATUS: PASS | EXIT_CODE: 0
```

De-flake: repeated runs of `shared-budget.test.mjs` surfaced a real-clock
flake in the pre-existing 'worker-output-shaped payload cannot mutate the
ledger' security test (snapshot `now` field advanced 1ms between two
deepEqual-compared snapshots). The test now uses an injectable fixed clock;
verified green 8/8 consecutive runs.

Fingerprint after fixes: `48dcc666c4292bd8c1df7e80c70e6dc9f1e83ed148740b2f8c347e80d604ebdd`
(recomputed — UNCHANGED; no fingerprint input was touched, no manifest edit
needed).

Deviation note: the review scenario additionally surfaced the latent
`high_cost_routes_used` ReferenceError in the pipeline's defensive cost gate
(only reachable with an active cost_policy + transition); fixing it is
required for the escalation tests to run and is in scope of FIX 1's intent.

## Files created / modified

Created: `runtime/routing/budget-governor.mjs`,
`test/routing/shared-budget.test.mjs`, `test/routing/degraded-ranking.test.mjs`,
`test/routing/shared-budget-integration.test.mjs`,
`evidence/shared-budget-degraded-governance-20260820/{spec,verification-contract,results}.md`.

Modified: `runtime/routing/routing-policy.mjs` (healthRankOf/degradedCandidate
ranking + DEGRADED_ROUTE_SELECTED/DENIED), `runtime/routing/routing-events.mjs`
(5 budget jobs), `runtime/routing/index.mjs` (re-exports),
`runtime/run.mjs` (shared_budget option), `runtime/pipeline/pipeline.mjs`
(reserve/commit + deny path), `runtime/controller/controller.mjs`
(SHARED_BUDGET_EXHAUSTED → BLOCKED), `scripts/lib/production-sentinel.mjs`
(10 checks + 10 invariants + artifact), `test/controller/production-sentinel.test.mjs`
(43→53 + 6 new negative drift tests), `runtime/production-baseline.json`
(invariants/artifacts/milestone/fingerprint), `scripts/install-governance.mjs`
(artifact), `scripts/fresh-install-sentinel.mjs` (artifact + export),
`test/test-manifest.json` (3 new unit test files).
