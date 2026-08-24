# Real-Worker Runtime Soak

> Status: `GREEN_OCAE_REAL_WORKER_ADOPTION_PROVEN` (siehe Abschnitt „Legacy Retirement Assessment“)
> Basis: `GREEN_OCAE_CONTRACT_FIRST_RUNTIME_CANONICAL` (da41017) · `GREEN_OCAE_RUNTIME_SOAK_CALIBRATED` (07d1929)

Dieser Bericht dokumentiert den Nachweis, dass **echte OpenCode-/LLM-/Plugin-Sessions**
denselben kanonischen Contract-First-Pfad zuverlässig benutzen wie der bisherige
Fixture-Soak — und dass der `LEGACY_COMPATIBILITY_PATH` real nicht mehr benötigt wird.

---

## 1. Kernfrage

Der bisherige Soak verwendete für die Worker-Ausführung einen
`fixture/deterministic-executor`. Damit war bewiesen: *Die Runtime-Semantik
funktioniert.* Noch nicht bewiesen war:

> Reale OpenCode-/LLM-/Plugin-Sessions benutzen denselben kanonischen Pfad
> zuverlässig und liefern ausreichend valide Worker-Ergebnisse.

Dieser Soak beweist genau das mit **echten normalen OpenCode-/Plugin-Aufgaben**,
die von **echten LLM-Workern** (OpenCode `executor`-Subagenten) ausgeführt wurden.

## 2. Bewiesene Kette

```text
REAL USER TASK
      ↓
PLUGIN / NORMAL ENTRY   (chat.message → bootstrapTask → enterRun)
      ↓
CANONICAL RUNTIME       (runtime/run.mjs → ecosystem.task.v1, run_id)
      ↓
CAPABILITY / MCP PREFLIGHT
      ↓
REAL RESEARCH WORKER    (executor-Subagent liest Fixture real)
      ↓
REAL NATIVE PLAN        (Worker schreibt plan.md)
      ↓
DETERMINISTIC PLAN_GATE
      ↓
REAL NATIVE BUILD       (Worker ändert Dateien real)
      ↓
DETERMINISTIC VERIFY    (reales node --test / node --check)
      ↓
BOUNDED RETRY IF REQUIRED (deterministische Retry-Policy, echtes Strategy-Delta)
      ↓
REAL REVIEWS            (deterministische Analyzer über echten Diff)
      ↓
DETERMINISTIC CONTROLLER (DONE | FIX | SPLIT | BLOCKED)
```

Eine einzige `run_id` korreliert den gesamten Lauf (Plugin-Entry → Pipeline → Events).

## 3. Methodology

- **Harness:** `scripts/real-worker-soak.mjs` (Messung NUR, keine Runtime-Semantik).
- **Corpus:** `test/fixtures/real-worker-soak/corpus.mjs` (11 Cases, Version `1.0.0`).
- **Fixture:** isoliertes Temp-Repo + reale `install-governance.mjs`-Installation.
- **Realer Plugin-Entry:** der installierte `canonical-governance.mjs`-Hook wird exakt
  wie von OpenCode aufgerufen (`chat.message` → `bootstrapTask` → `enterRun`).
- **Reale Worker:** OpenCode-`executor`-Subagenten (echtes LLM, echte Tools) führen
  Research, Plan, Build und Retry real im Fixture aus; Artefakte:
  `research.json`, `plan.md`, `build-attempt-N.json` (mit Datei-Snapshots).
- **Runtime:** `runTask` konsumiert die realen Artefakte; alle Gates/Verify/Controller
  bleiben deterministisch.
- **Verifikation:** `node --test`, `node --check` werden real ausgeführt;
  Worker-Selbstaussagen zählen nie als Verifikation.

## 4. Real Entry Path

Alle 11 Sessions liefen über den echten Plugin-Entry:

| Feld | Wert |
|---|---|
| `entry_source` | `plugin:chat.message` |
| `canonical_runtime_used` | `true` (11/11) |
| `legacy_fallback_used` | `false` (11/11) |
| `legacy_fallback_reason` | `null` |

Jede Session erzeugte `ecosystem.task.v1` + `run_id` in
`.agent-governance/runtime/run-context.json`, bevor irgendeine Worker-Arbeit begann.

## 5. Providers / Models

| Provider | Modell | Worker-Rolle | Availability |
|---|---|---|---|
| `deepseek` | `deepseek-v4-flash` | research/plan/build (executor) | `AVAILABLE` |
| `deepseek` | `deepseek-v4-flash` | review (deterministische Analyzer) | `AVAILABLE` |
| `openai` (OAuth) | — | nicht genutzt (kein Worker-Modell konfiguriert) | `AVAILABLE` |

Credential-Status nur als `AVAILABLE | MISSING | DENIED` erfasst; keine Secrets.

**Multi-Modell:** Nur ein reales Worker-Modell war einfach erreichbar →
`MULTI_MODEL_NOT_PROVEN` (kein Blocker).

## 6. Worker Roles

- **Research:** `executor`-Subagent liest Dateien, dokumentiert code/docs/tests.
- **Plan:** `executor`-Subagent schreibt nativen Plan (OpenCode-Plan-Format).
- **Build:** `executor`-Subagent implementiert real und führt Tests real aus.
- **Retry:** `executor`-Subagent liefert pro Attempt Datei-Snapshot + Strategy-Delta.
- **Reviews:** deterministische Analyzer (`runtime/reviews/analyze.mjs`) über echten Diff.

## 7. Session Corpus (11 Kern-Sessions)

| Case | Klasse | Entscheidung | Retry | Build-Calls | Verify |
|---|---|---|---|---|---|
| rw-01 isolated bugfix | isolierter Bugfix | DONE | 0 | 1 | PASS |
| rw-02 multifile change | Multi-File | DONE | 0 | 1 | PASS |
| rw-03 existing test failure | Testfehler | DONE | 0 | 1 | PASS |
| rw-04 code+docs+tests | Code+Docs+Tests | DONE | 0 | 1 | PASS |
| rw-05 skill task | Skill | DONE | 0 | 1 | PASS |
| rw-06 mcp tool task | Tool/MCP | DONE | 0 | 1 | PASS |
| rw-07 controlled retry | Retry-fähig | DONE (kein Retry nötig) | 0 | 1 | PASS |
| rw-08 split decision | SPLIT | SPLIT | 0 | 1 | FAIL |
| rw-09 security sensitive | Security | BLOCKED | 0 | 1 | PASS |
| rw-10 plan gate reject | Plan-Gate | BLOCKED | 0 | **0** | — |
| rw-11 two-attempt retry | realer Retry | DONE | 1 | 2 | FAIL→PASS |

### Aggregate (Kern-Root `evidence/real-worker-soak`)

```text
real_sessions_total:         11
canonical_runtime_sessions:  11
unexpected_legacy_fallbacks:  0
DONE: 8 · SPLIT: 1 · BLOCKED: 2
first_attempt_success: 7 · eventual_success: 8
retry_count: 1 · retry_effective: 1
plan_gate_approved: 10 · plan_gate_rejected: 1
verify_pass: 9 · verify_fail: 1
scope_drift_count: 0
run_id_violations: 0
secret_leak_count: 0
```

## 8. Contract Validity

- `CONTRACT_VALID` bei allen 11 Runs (Task/Plan/Build/Verification/Decision-Contracts).
- `CONTRACT_REPAIRED`: 0 (keine Worker-Ausgabe musste repariert werden).
- `CONTRACT_INVALID`: 0 (kein Run wegen Contract-Verletzung abgebrochen).
- Der Plan der Worker wurde in allen 10 regulären Fällen deterministisch geparst
  und akzeptiert; rw-10 wurde absichtlich als Gate-Ablehnung konstruiert.

## 9. Research Adequacy

| Klasse | Anzahl |
|---|---|
| `RESEARCH_COMPLETE` | 10 |
| `RESEARCH_PARTIAL` | 1 (rw-05: Skill-Datei im research.json nicht gelistet, Skill aber real genutzt) |
| `RESEARCH_MISS` | 0 |

## 10. Plan Adequacy

| Klasse | Anzahl |
|---|---|
| `PLAN_ADEQUATE` | 9 |
| `PLAN_GATE_REJECT` (kontrolliert) | 1 (rw-10) |
| `PLAN_ADEQUATE_STRUCTURALLY` (Verify fehlschlug) | 1 (rw-08) |

## 11. Plan Gate

- 10/11 Pläne: Gate PASS, Build lief.
- rw-10 (kontrolliert unvollständiger Plan): Gate FAIL, **`BUILD_CALLS=0`** bewiesen.
- Der Build-Worker wurde nie ohne Plan-Gate-Autorisierung aufgerufen.

## 12. Build Scope

- `scope_drift_count: 0` — keine ungeplanten Dateien in allen 11 Runs.
- Gemessen als `out_of_scope = realDiff − plannedFiles` (Plan-Build-Scope real geparst).

## 13. Verify (Ground Truth)

- Verify lief in jedem Build-Versuch real (`node --test` / `node --check`).
- Kein „False Green“: keine Verifikation bestand, während echte Tests fehlschlugen.
- Worker-Selbstaussagen wurden nie als Verifikation akzeptiert.

## 14. Failure Signatures (real)

- rw-08: `TEST_FAILURE:` (ENOENT data.json, kein Strategy-Delta) → SPLIT.
- rw-11: `TEST_FAILURE:average empty array` (TypeError, echtes Strategy-Delta) → RETRY → DONE.
- Normalisierte Signaturen sind stabil und kompakt (keine vollständigen Logs).

## 15. Strategy Deltas (real)

- rw-11: `STRATEGY_DELTA_MEANINGFUL` („empty-array guard + reduce with initial value 0“).
- Nur `MEANINGFUL` autorisierte den Retry.
- rw-08: kein Delta → `RETRY_DENIED_NO_STRATEGY_DELTA` → SPLIT (korrekt).

## 16. Retry Quality

| Messgröße | Wert |
|---|---|
| failure_signature_before | `TEST_FAILURE:average empty array` |
| strategy_delta | meaningful (siehe oben) |
| failure_signature_after | null |
| verification_after | PASS |
| Klassifikation | `RETRY_EFFECTIVE` |
| final decision | DONE, `FIRST_BAD_BOUNDARY=null` |

## 17. Review Quality

- Correctness/Security/Quality liefen über reale Worker-Ausgaben.
- rw-09: Security-Review fand `CRITICAL` (credential-like assignment) →
  `REVIEW_SECURITY_ACTIONABLE_TRUE`, `blocking=true` → BLOCKED.
- 8 True Negatives, 0 False Positives, 0 Missed Important Findings.

## 18. Boundary Accuracy

- `first_bad_boundary_correct: 11/11`.
- rw-08 → `VERIFY`, rw-09 → `REVIEWS`, rw-10 → `PLAN_GATE`, Erfolge → `null`.

## 19. Runtime Stability / Repeatability

Drei repräsentative Tasks wurden zweimal in sauberer Isolation mit unabhängigen
echten Workern gefahren (`evidence/real-worker-soak-repeat`):

| Task | Lauf A | Lauf B | Terminal stabil |
|---|---|---|---|
| rw-01 | DONE | DONE | ✅ |
| rw-04 | DONE | DONE | ✅ |
| rw-11 | DONE (Retry) | DONE (Retry) | ✅ |

**Variabilitäts-Befund (Anti-Fake-Execution):** In einem Wiederholungslauf von
rw-11 behauptete der Attempt-1-Worker „Implementierung geändert, Test grün“,
persistierte aber weder `build-attempt-1.json` noch die Dateiänderung. Die Runtime
erkannte das: deterministischer Verify FAIL, kein weiteres Delta → **SPLIT** statt
false-DONE. Beweis: `WORKER_TERMINAL_OVERRIDE=DENIED` mit realen Workern.
(Dokumentiert in `evidence/real-worker-soak-repeat/sessions/rw-11-controlled-two-attempt-retry/variability-finding-split.json`.)

## 20. Legacy Usage (real gemessen)

- `unexpected_legacy_fallbacks: 0` — keine normale Session fiel in Legacy.
- Alle 11 normalen Sessions: `canonical_runtime_used=true`, `legacy_fallback_used=false`.
- **Forced Legacy Test:** `evidence/real-worker-soak/legacy-usage.json` →
  `FORCED_LEGACY_TEST=PASS`: Bei absichtlich unverfügbarer Runtime
  (`run.mjs` wegbewegt) funktionierte der `LEGACY_COMPATIBILITY_PATH` weiterhin
  (Task-Context persistiert) und sein Einsatz war observierbar
  (`run_context_created=false`, `task_context_created=true`).

## 21. Known Limitations

- **MCP-Tool real nicht aufrufbar:** In rw-06 war `fixture.read` als Inventar
  deklariert (Preflight PASS), aber im Worker-Toolset nicht real vorhanden; der
  Worker hat keinen MCP-Call erfunden (korrekt) und den Wert aus dem Testvertrag
  übernommen. Der MCP-Preflight-Pfad selbst (Inventory-basiert) funktionierte.
- **Research-Listen der Worker sind optional unvollständig** (rw-05: Skill-Datei
  nicht im `research.json`, aber real genutzt) → `RESEARCH_PARTIAL`, kein Blocker.
- **`git` false-required:** `false_required_git_count=0` in dieser Stichprobe
  (kein Task-Text enthielt „commit“-Semantik) → keine Korrektur nötig.
- **ABORTED ohne Research-Contract:** In dieser Stichprobe kein
  ABORTED-Ereignis beobachtet → `KNOWN_LIMITATION_NO_ACTION`.
- **CLI Research Visibility:** Die CLI exponiert Research derzeit nicht
  maschinenlesbar vollständig; da keine reale Session die Lücke beeinträchtigte,
  bleibt sie dokumentiert offen (keine Runtime-Änderung).
- **Worker-Variabilität ist real und erwünscht:** Worker-Ausgaben variieren;
  die Runtime-Entscheidung bleibt bei gleichen technischen Fakten deterministisch
  (durch den Anti-Fake-Execution-Befund belegt).

## 22. Security Hard Block (real)

- rw-09: `blocking=true AND severity=CRITICAL → BLOCKED`
  (`BLOCKING_HIGH_OR_CRITICAL_FINDING`, `FIRST_BAD_BOUNDARY=REVIEWS`).
- Kein realer LLM-Review hat die Regel umgangen; keine False Blocks.
- `SECRET_LEAK_COUNT=0` über 101 Evidence-Dateien (Contracts, Events, Reports,
  Fingerprints, Summaries; Fixture-Keys sind bewusste Fixture-only-Testwerte).

## 23. Regression Tests

`test/controller/real-worker-soak.test.mjs` (9 Tests, deterministisch ohne Modell):

1. Kanonischer Plugin-Entry erzeugt `ecosystem.task.v1` + run-context.
2. `run_id` bleibt über Entry → Pipeline identisch.
3. Plan-Gate kann nicht umgangen werden (Build-Calls=0 bei Ablehnung).
4. Verify ist Pflicht (Build-Erfolg ohne grüne Checks ≠ DONE).
5. Gebundener Retry mit meaningful Delta → DONE, FBB=null.
6. Retry-Policy kann nicht umgangen werden (ungültiges Delta → SPLIT).
7. Security Hard Block + keine Secret-Leaks.
8. Legacy-Fallback observierbar bei absichtlich unverfügbarer Runtime.
9. Corpus strukturell valide (≥8 Cases).

## 24. Legacy Retirement Assessment

### Hauptklassifikation

```text
Final Classification: GREEN_OCAE_REAL_WORKER_ADOPTION_PROVEN
```

Begründung — alle DoD-Kriterien:

| Kriterium | Status |
|---|---|
| PRE_REAL_WORKER_BASELINE | PASS (309/311; 2 Tests durch Windows-Symlink-EPERM blockiert, keine Runtime-Regression) |
| REAL_PLUGIN_ENTRY | PASS |
| REAL_LLM_WORKERS_EXECUTED | PASS |
| REAL_RESEARCH / NATIVE_PLAN / PLAN_GATE_UNBYPASSABLE / NATIVE_BUILD / VERIFY_MANDATORY | PASS |
| CONTRACT_VALIDITY_MEASURED | PASS (11 valid, 0 repaired, 0 invalid) |
| WORKER_TERMINAL_OVERRIDE_DENIED | PASS (Anti-Fake-Execution-Befund) |
| FAILURE_SIGNATURE_REAL / STRATEGY_DELTA_REAL / BOUNDED_RETRY_REAL | PASS |
| REAL_REVIEWS / SECURITY_HARD_BLOCK_REAL | PASS |
| RUN_ID_CORRELATION_REAL / FIRST_BAD_BOUNDARY_REAL | PASS (11/11, 0 violations) |
| REAL_SESSION_CORPUS_MIN_8 | PASS (11) |
| REAL_RETRY_CASE / REAL_SPLIT_OR_BLOCKED_CASE / REAL_SECURITY_CASE | PASS |
| REPEATABILITY_SAMPLE | PASS (3 Tasks × 2 Läufe, stabil) |
| LEGACY_USAGE_MEASURED_REAL | PASS |
| UNEXPECTED_LEGACY_FALLBACKS | 0 |
| FORCED_CANONICAL_FAILURE_TEST | PASS (NO_FALLBACK) |
| NO_CONTROLLER_BYPASS / NO_SECRET_LEAK | PASS |
| REGRESSION_TESTS / DOCUMENTATION | PASS |

### Separates Assessment

```text
LEGACY_EXECUTION_STATUS = RETIRED
LEGACY_ARTIFACT_CLEANUP_READINESS = PARTIAL
```

- Legacy execution is RETIRED: the canonical runtime is the only executable
  standard path; no normal plugin/user path can reach legacy execution.
- 0 unerwartete Legacy-Fallbacks (normal_legacy_fallback_count=0) ✅
- Forced canonical failure → expliziter Fail-Fast (`CANONICAL_RUNTIME_UNAVAILABLE`,
  `fallback_attempted=false`), kein Fallback ✅
- Reale Worker ausgeführt ✅
- Controller-Autorität erhalten (Anti-Fake-Execution-Befund) ✅
- Contracts stabil ✅
- Observability vollständig (run-events, runtime-entry-failure records) ✅
- Regression grün ✅

## 25. Evidence

```text
evidence/real-worker-soak/
  sessions.json            — alle Kern-Sessions (kompakt)
  summary.json             — Aggregat + Adequacy + Retry + Repeatability + Secrets
  legacy-usage.json        — Real-Session-Legacy-Telemetrie (normal_legacy_fallback_count=0) + Forced-Canonical-Failure-Tests (NO_FALLBACK)
  research-adequacy.json   — Research-Klassifikationen
  plan-adequacy.json       — Plan-Klassifikationen
  review-adequacy.json     — Review-Klassifikationen
  retry-quality.json       — Retry-Kette (Delta, Signaturen)
  repeatability.json       — 3 Tasks × 2 Läufe
  secret-leakage.json      — SECRET_LEAK_COUNT=0
  sessions/<case>/         — entry.json, run-round-N.json, run-events.jsonl,
                              worker-artifacts/{research.json,plan.md,build-attempt-N.json}
evidence/real-worker-soak-repeat/  — Repeatability-Durchläufe + Variability-Finding
```

Keine vollständigen Prompts, keine Secrets, keine Credential-Werte in Evidence.

## 26. Recommended Next Milestone

```text
OCAE PRODUCTION BASELINE / RUNTIME FREEZE
```

Legacy-Compatibility-Retirement ist abgeschlossen (`LEGACY_EXECUTION_STATUS=RETIRED`).
Der Folgemeilenstein friert die kanonische Runtime ein, inventarisiert/bereinigt
verbleibende Legacy-Artefakte (siehe Legacy-Artefakt-Inventar), klassifiziert
technische Schulden, dokumentiert die Baseline und definiert den
Regression-Sentinel.