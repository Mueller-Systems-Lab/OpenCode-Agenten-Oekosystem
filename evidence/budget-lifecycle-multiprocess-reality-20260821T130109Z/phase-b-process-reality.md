# OCAE — Phase B: Multi-Process Budget Need Reality Check (§17–§24)

## Deployment-/Process-Topologie (§18)

Untersucht: runtime entrypoints, OpenCode process model, worker spawning,
child_process usage, process boundaries, CLI invocations, plugin lifecycle,
concurrent sessions, background workers, container/process deployment docs.

**Befund:**
1. **Plugin-Pfad (produktiv):** `.opencode/plugins/canonical-governance.mjs`
   → `runtimeEntry.enterRun()` (in-process, import von runtime/run.mjs). Der
   Plugin-Hook läuft IM OpenCode-Agenten-Prozess. Ein OpenCode-Session =
   EIN OS-Prozess. `enterRun` verwaltet EINE run-context-Datei pro Projekt
   (`.agent-governance/runtime/run-context.json`) — ein aktiver Run pro
   Projekt-Session, sequentiell pro User-Message.
2. **CLI-Pfad:** `scripts/run-task.mjs`, `src/ocae_cli/opencode.py`
   (subprocess.Popen → `opencode run`). Jede CLI-Invokation = eigener
   node/python-Prozess = eigene Budget-Domain.
3. **Keine parallelen Worker-Prozesse im Runtime:** Kein `worker_threads`,
   kein `cluster` im gesamten runtime/. `spawnSync`/`execFileSync` nur für
   Probes/Verification/Security-Checks; `spawn` nur für MCP-Server.
4. **Run-Lock:** `executeResumableRun` (run-state.mjs) sperrt pro
   Run-State-DATEI (`.lock` mit process.pid) — Ein-Run-Resumption, keine
   Budget-Koordination.

## Governor-Instanziierung (§19)

`runtime/run.mjs` Zeile 190:
```js
const governor = sb.governor || new SharedBudgetGovernor({...})
```
- **Per runTask-Aufruf** erzeugt, es sei denn der Aufrufer reicht dieselbe
  Instanz durch (`routing.shared_budget.governor`).
- KEIN globales Prozess-Singleton. Sharing nur in-process möglich
  (bewiesen: integration CASE 2/3 teilen einen Governor in einem Prozess).
- Cross-Process-Sharing ist mit dem In-Memory-Governor architektonisch
  unmöglich (kein IPC/kein Persistenz-Backend).

## Reale Process-Probe (§20)

2 echte parallele node-Prozesse (Probe-Skript), je 2 parallele HIGH-Cost-Runs
mit je eigenem In-Memory-Governor (Kapazität 2):

- Distinct PIDs: [3133404, 3133405] (Runs abgeschlossen, consume)
  und [3133561, 3133562] (mid-flight reserve)
- Jeder Prozess: eigener Governor, eigene run_ids, 2 DONE, 2 Worker-Calls
- Per-Prozess: capacity 2, consumed 2, remaining 0

## Adversarial Proof des aktuellen Limits (§24)

Mid-Flight-Probe (Reservierungen offen gehalten):
- Prozess A: reserved 2, Prozess B: reserved 2
- GLOBAL_RESERVED = 4, vereinheitlichtes Domain-Capacity = 2
- Oversubscription = 2 → **MULTI_PROCESS_OVERSUBSCRIPTION_GAP=PROVEN**
  (mathematisch: unabhängige In-Memory-Governor können eine vereinheitlichte
  Domain nicht erzwingen)

## Need Classification (§21)

**MULTI_PROCESS_BUDGET_NEED=NOT_PROVEN**

Begründung:
- Produktive OCAE-Runs koordinieren sich real INNERHALB einer
  Runtime-Process-Grenze (OpenCode-Session-Prozess, sequentiell pro Message;
  oder einzelne CLI-Invokationen mit je eigener Budget-Domain).
- Es existiert KEIN produktiver Pfad, in dem mehrere OS-Prozesse dieselbe
  HIGH_COST_ROUTE-Budget-Domain koordinieren MÜSSEN.
- Die parallelen Runs in einem Prozess TEILEN den Governor bereits korrekt
  (CASE 2/3); der Gap existiert nur bei getrennten Prozessen, die im
  produktiven Betrieb keine gemeinsame Domain haben.
- Doku (docs/production-baseline.md) deklariert SINGLE_RUNTIME_PROCESS und
  "no multi-process shared budget" explizit als Limitation — kein realer
  Produktbedarf wurde belegt.

## Phase-C-Entscheid (§22)

**KEIN Distributed Ledger bauen.**
Korrekter Abschluss: GREEN_OCAE_BUDGET_LIFECYCLE_AND_MULTIPROCESS_REALITY_PROVEN
mit MULTI_PROCESS_BUDGET_NEED=NOT_PROVEN, DISTRIBUTED_LEDGER_IMPLEMENTED=NO.
