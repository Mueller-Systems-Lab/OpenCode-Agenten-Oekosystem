# Lifecycle Matrix — CURRENT state (before any change), proven by code read + live proof

## Proven code path (runtime/run.mjs → runtime/pipeline/pipeline.mjs → runtime/routing/budget-governor.mjs)

The only shared-budget wiring in the pipeline is in `runPipeline`'s BUILD loop:

```
if (needsSharedReservation(routeState)) {        // HIGH_COST_ROUTE only
  const reserved = sharedBudget.governor.reserve({...})
  if (reserved.ok) { budgetReservation = ...; emit reserve }
  else { emit deny; verification FAIL; routingTerminal → BLOCKED }
}
// ... routeExecutor(routeState, {attempt})  ← can THROW (GAP-1)
// ... emit workerStart
// ... runNativeBuild({ buildInput, execute })  ← captures worker throws → FAILURE result
// ... if outcome.run_id !== runId → throw CONTRACT_INVALID  (GAP-2)
// ... enforceRunId(buildResult)  ← can throw CONTRACT_INVALID (GAP-2)
// ... usage events
if (budgetReservation) {
  governor.commit(...)   ← only reached when NO exception happened above
  emit consume
}
```

## Matrix

| Fall | Aktuelles Verhalten | Reservation | Beweis |
|---|---|---|---|
| Worker startet + Erfolg | reserve → worker → commit | CONSUMED | integration CASE 1 |
| Worker startet + Fehler (FAILURE build result) | reserve → worker → commit | CONSUMED | integration CASE 1 (commit after result regardless) |
| Worker startet nie (deny) | reserve denied → BLOCKED, 0 worker calls | — (never reserved) | integration CASE 2/3, deniedRunAssertions |
| Pipeline abort vor Spawn | routeExecutor THROW propagates out of runPipeline → runTask rethrows (not CONTRACT_INVALID) | **RESERVED (LEAK until TTL)** | **GAP-1 LIVE PROOF** |
| Controlled cancellation (pipeline-level) | NOT WIRED in pipeline; only manual governor.release() in test | manual RELEASED | integration CASE 4 (governor-level only) |
| Timeout vor Worker | no timeout infra exists | n/a | grep: no AbortController/timeout in pipeline/run |
| Timeout während Worker | no timeout infra exists | n/a | grep: no AbortController/timeout in pipeline/run |
| Exception zwischen reserve und spawn | routeExecutor THROW → propagates | **RESERVED (LEAK until TTL)** | **GAP-1 LIVE PROOF** |
| Exception zwischen spawn und commit | outcome.run_id mismatch / enforceRunId → throw CONTRACT_INVALID | **RESERVED (LEAK until TTL)** | **GAP-2 LIVE PROOF** |
| Controller beendet Pfad | terminal decision after commit | CONSUMED | integration CASE 1 |
| Reservation TTL läuft ab | expireStale on next reserve() | EXPIRED (capacity restored) | governor test: TTL determinism; integration CASE 5 |

## LIVE Proof Output (gap-proof.mjs, before any change)

```
GAP-2 (run_id forgery):
  phase: ABORTED
  decision: BLOCKED CONTRACT_INVALID
  worker calls: 1
  reservation status: RESERVED
  remaining capacity: 0
  GAP-2 CONFIRMED: true (reservation stuck RESERVED, capacity held)

GAP-1 (executor creation throws after reserve):
  outcome: threw: EXECUTOR_CREATION_FAILURE
  reservation status: RESERVED
  remaining capacity: 0
  GAP-1 CONFIRMED: true (reservation stuck RESERVED after throw)
```

## Kerninvariante §6 (current violation)

> Für jede Reservation muss am Ende exakt einer dieser Zustände gelten: CONSUMED | RELEASED | EXPIRED. Nicht dauerhaft RESERVED nach abgeschlossenem/abgebrochenem Run.

Both GAP-1 and GAP-2 leave a permanent `RESERVED` after an aborted run (only TTL recovery on the NEXT reserve() call, i.e. 30s default). This is a REAL lifecycle gap and is the Phase-A target.

## Root cause

The `reserve → invoke → commit` sequence has NO structural try/finally lifecycle closure:
- commit only runs on the happy path
- any exception between reserve and commit leaks the reservation until TTL
- there is no pipeline-level RELEASE path at all (release/expire are governor-level only)

## Minimal fix design (structural, NOT a new control plane)

Wrap the reserved invocation window in a structural `try { ... } finally/catch` closure that, when an exception escapes the window, deterministically closes the reservation:
- if the worker was NOT yet productively invoked (exception before spawn) → RELEASE (capacity restored, reason recorded)
- if the worker WAS invoked but the run aborts (run_id forgery / contract invalid) → decide per consume-boundary definition (documented below)
- ALWAYS: reservation must reach CONSUMED | RELEASED | EXPIRED — never stay RESERVED after the window exits.

Consume Boundary (definition, Phase A §9): **on productive worker invocation** — once `runNativeBuild` actually invokes the worker (model call started), the reservation is CONSUMED regardless of success/failure. Abort/exception BEFORE productive invocation → RELEASED. This matches existing commit semantics (commit after result for both SUCCESS and FAILURE) and the integration CASE 1-3 evidence.
