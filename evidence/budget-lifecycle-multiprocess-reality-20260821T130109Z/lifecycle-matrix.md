# OCAE Shared Budget — Lifecycle Matrix (Phase A, §5)

Baseline HEAD: 4e3fce7dca9adc16de69b9251434461f32fcbb79
Method: code-path reading (runtime/run.mjs, runtime/pipeline/pipeline.mjs,
runtime/routing/budget-governor.mjs) + empirical test evidence.

| Fall | Aktuelles Verhalten | Reservation | Evidenz |
|---|---|---|---|
| Worker startet + Erfolg | reserve → workerStart → runNativeBuild SUCCESS → commit | CONSUMED | shared-budget-integration CASE 1 |
| Worker startet + Fehler (returned FAILURE result) | reserve → workerStart → FAILURE result → commit (consume boundary) | CONSUMED | LIFECYCLE 3 |
| Worker startet + Fehler (thrown / classified) | reserve → workerStart → throw → catch → workerInvoked=true → commit | CONSUMED | escalation describe block |
| Worker startet nie (pre-spawn abort: routeExecutor throws) | reserve → routeExecutor() throws before workerStart → catch → workerInvoked=false → release | RELEASED | LIFECYCLE 1/2/4 |
| Pipeline abort vor Spawn (BASELINE/PLAN_GATE fail, budget deny) | reserve() nur im Build-Loop nach PLAN_GATE; keine Reservation entsteht | keine (kein Leak) | vertical-slice/negative tests |
| Controlled cancellation | kein explizites Cancel-Signal; vor-Invokation-Abbruch via Exception → strukturelle Closure → release | RELEASED | LIFECYCLE 1/2/4; governor release idempotent |
| Timeout vor Worker | kein separates Timeout-Fenster zwischen reserve und spawn; Abbruch/Exception → release | RELEASED | strukturelle Closure (pipeline try/catch) |
| Timeout während Worker | keine AbortController/Timeout-Infrastruktur im Runtime; Worker-Exception → commit | CONSUMED | catch-Pfad workerInvoked=true |
| Exception zwischen reserve und spawn | routeExecutor-Evaluierung (activeExecutor) wirft → catch → release | RELEASED | LIFECYCLE 1 |
| Controller beendet Pfad | Reservation wird im Build-Loop immer commit/release; danach terminal | terminal (keine offene) | alle Pipeline-End-to-End-Tests |
| Reservation TTL läuft ab | expireStale bei jedem reserve()/snapshot(); abandoned → EXPIRED, Kapazität wiederhergestellt | EXPIRED | CASE 5 + Governor-Unit (clock) |

## Consume Boundary (§9)

Wann wird eine High-Cost-Reservation VERBRAUCHT?
- Definition: **on productive worker invocation** — workerStart wird emittiert UND
  runNativeBuild wird aufgerufen (workerInvoked=true). Danach wird die
  Reservation unabhängig vom Ergebnis (SUCCESS/FAILURE/Exception) committet
  (CONSUMED). Vor produktiver Invokation: release (RELEASED, Kapazität exakt
  einmal wiederhergestellt).
- Dokumentiert: pipeline.mjs Kommentar + docs/production-baseline.md
- Getestet: LIFECYCLE 1–5, CASE 1–5
- Observabel: budget.shared.reserve/consume/release/deny Events (run_id,
  reservation_id, resource, status, reason/strategy_delta, timestamp)

## Kein Double Accounting (§10)

| Fall | Verhalten | Test |
|---|---|---|
| double release | idempotent, Kapazität NIE doppelt wiederhergestellt | unit 'double release → idempotent + no capacity drift' |
| double commit | idempotent, consumed zählt 1 | unit 'double commit → idempotent + no double consume' |
| release nach commit | RESERVATION_NOT_ACTIVE, keine Mutation | unit 'release after commit' |
| commit nach release | RESERVATION_NOT_ACTIVE, keine Mutation | unit 'commit after release' |
| expiry → release | EXPIRED (keine Mutation, Kapazität via expireStale) | unit 'TTL determinism: late release' |
| expiry → commit | EXPIRED (keine Mutation) | unit 'TTL determinism: late commit' |
| Ownership cross-run | OWNERSHIP_INVALID, keine Budget-Änderung | unit 'wrong run_id' + LIFECYCLE 5 (forgery) |

## Kerninvariante (§6)

Jede Reservation endet in exakt einem von CONSUMED | RELEASED | EXPIRED.
Kein dauerhaftes RESERVED nach abgeschlossenem/abgebrochenem Run.
Bewiesen durch: LIFECYCLE 1/3/5 assert reserved===0 nach Abort/Failure/Abort.
