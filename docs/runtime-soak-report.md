# Runtime Soak Report — Contract-First Runtime unter realen Aufgaben kalibriert

- Milestone: `GREEN_OCAE_RUNTIME_SOAK_CALIBRATED`
- Baseline Commit: `da41017` — `feat: make contract-first runtime the canonical execution path`
- Corpus: `test/fixtures/runtime-soak/corpus.mjs` (SOAK_CORPUS_VERSION 1.0.0, 19 Cases)
- Runner (measurement harness only): `scripts/runtime-soak.mjs`
- Maschinenlesbare Ergebnisse: `evidence/runtime-soak/results.json` (+ `results-round1.json`, `results-round2.json`)
- Ereignis-Evidenz: `evidence/runtime-soak/events/*.jsonl`
- Spezifikation: `evidence/runtime-soak/spec.md`

## 1. Methodik

Jeder Corpus-Case läuft durch den echten kanonischen Entry Point `runtime/run.mjs` → `runTask` (bzw. für Case 15 durch die CLI `scripts/run-task.mjs`, die denselben Entry kapselt). Der Runner ruft niemals Controller-Funktionen direkt auf; er ist reine Mess-/Testharness und implementiert keine Runtime-Semantik. Worker werden durch deterministische Build-Executor simuliert (etabliertes Muster der Vertical-Slice-Tests), da kein Live-LLM-Backend verfügbar ist — Provider/Modell werden als `fixture`/`deterministic-executor` erfasst, Kosten als `COST_NOT_AVAILABLE`.

Pro Case wird genau eine `run_id` über TASK → BASELINE → RESEARCH → PLAN → PLAN_GATE → BUILD → VERIFY → REVIEWS → CONTROLLER korreliert (19/19 bestätigt). Retries unterscheiden sich nur über `attempt`.

Runden: **Round 1 (Discovery)** → gezielte Fixes → **Round 2 (Validation)**.

## 2. Corpus

| case_id | task_class | Erwartung | Round-2 Ergebnis |
|---|---|---|---|
| case-01-isolated-bugfix | isolated_bugfix | DONE | DONE ✓ |
| case-02-multifile-change | multifile_change | DONE | DONE ✓ |
| case-03-test-failure-retry | test_failure_retry | FAIL→Retry→DONE | DONE (2 Attempts, 1 Retry, RETRY_EFFECTIVE) ✓ |
| case-04-no-retry-strategy | no_retry_strategy | SPLIT | SPLIT (RETRY_DENIED_NO_STRATEGY_DELTA, bnd=BUILD) ✓ |
| case-05-docs-code-consistency | docs_code_consistency | DONE | DONE ✓ |
| case-06-required-skill | required_skill | DONE (Skill erkannt) | DONE, Skill `run-card` im Preflight bestätigt ✓ |
| case-07a-mcp-required-present | mcp_required | PREFLIGHT PASS→DONE | DONE ✓ |
| case-07b-mcp-required-missing | mcp_required_missing | BLOCKED vor Worker | BLOCKED (BASELINE, Worker nie aufgerufen) ✓ |
| case-08-optional-capability-missing | optional_capability_missing | DEGRADED, NOT BLOCKED | DONE mit optionaler Degradation github:MISSING ✓ |
| case-09-split-required | split_required | SPLIT | SPLIT (RETRY_DENIED_REPEATED_IDENTICAL_FAILURE, bnd=VERIFY) ✓ |
| case-10a-security-hard-block | security_hard_block | BLOCKED | BLOCKED (BLOCKING_HIGH_OR_CRITICAL_FINDING, bnd=REVIEWS) ✓ |
| case-10b-security-nonblocking-low | security_nonblocking | FIX, nicht BLOCKED | FIX (NON_BLOCKING_REVIEW_FINDINGS) ✓ |
| case-10c-security-nonblocking-medium | security_nonblocking | FIX, nicht BLOCKED | FIX (NON_BLOCKING_REVIEW_FINDINGS) ✓ |
| case-10d-security-clean | security_clean | DONE | DONE ✓ |
| case-11-contract-invalid | contract_invalid | BLOCKED CONTRACT_INVALID | BLOCKED (TASK) ✓ |
| case-12-plan-gate-reject | plan_gate_reject | BLOCKED am PLAN_GATE | BLOCKED (ACCEPTANCE_CRITERIA_MISSING), Build nie aufgerufen ✓ |
| case-13-missing-required-capability | missing_required_capability | BLOCKED vor Worker | BLOCKED (BASELINE) ✓ |
| case-14-run-id-replacement | run_id_replacement | BLOCKED CONTRACT_INVALID | BLOCKED (ABORTED, CONTRACT_INVALID) ✓ |
| case-15-cli-canonical-entry | cli_entry | DONE | DONE über CLI-Entry ✓ |

## 3. Metriken (Round 2, 19 Cases)

```
total_cases                 19
DONE_count                   9   FIX_count 2   SPLIT_count 2   BLOCKED_count 6
first_attempt_success_rate   0.421
eventual_success_rate        0.474
retry_rate                   0.105
retry_success_rate           0.5    (case-03)
retry_no_progress_rate       0.5    (case-09)
repeated_failure_rate        0.5    (1 von 2 Retry-Cases)
plan_gate_false_accept       0
plan_gate_false_reject       0
security_true_block          1     (case-10a)
security_false_block         0
first_bad_boundary_accuracy  1.0   (19/19 BOUNDARY_CORRECT)
expected_match_count         19/19
unexpected_behavior_count    0
secret_leak_count            0
legacy_fallback_count        0
average_attempts             1.11
average_runtime              2845 ms
capability_detection_correct 17
capability_missed_required   0
capability_false_required    1     (case-08: git — task-text-Keyword „commit", dokumentiert, kein Block)
split_correct                2     split_suspect 0
blocked_correct              6     blocked_suspect 0
retry_effective              1     retry_no_progress 1  retry_should_have_split 0
repeat_prevented             1     (case-09)
review_security_actionable_true  1
review_security_true_negative   9
review_non_blocking_not_blocked 2
```

## 4. Capability Calibration

- **Detection korrekt: 17/19.** Die Pflicht-Capabilities aus Task-Text + Plan-Regeln werden konsistent abgeleitet.
- **MISSED_REQUIRED: 0 nach Fix.** In Round 1 wurde die Plan-Information nie an die Baseline gereicht: `runBaseline` bekam `plan: nativePlan?.plan || null`, aber der kanonische Pfad liefert Pläne als `planText`, sodass die Detector-Regeln `build_scope.files → write` und `required_tests → test` nie feuerten (z. B. case-02 ohne `write`). **Fix:** `runtime/pipeline/pipeline.mjs` und `runtime/run.mjs` parsen den Plan jetzt via `parsePlanText` und übergeben `planData` an die Baseline. Regressionstests in `test/controller/preflight.test.mjs` + `security-boundary.test.mjs`.
- **FALSE_REQUIRED: 1 (case-08 `git`).** Task-Text „commit notes for a future PR" löst das Keyword `git` aus. Semantisch grenzwertig (der Fix selbst ist rein lokal), aber der Task-Text erwähnt explizit Commit — keine Fehlentscheidung, kein Block. Bewusst NICHT durch Keyword-Spezialfälle „gefixt" (Mandat §12: nicht aufblasen).
- **Systematisches Artefakt gefunden und korrigiert:** In Round 1 derivierte der Detector bei 18/19 Cases `build`, weil der Plan-Strukturschlüssel `build_scope` gegen das `build`-Keyword-RegEx matchte (der Detector scannte `JSON.stringify(plan)`). **Fix:** Keyword-Derivation scannt nur noch den Task-Text; Plan-Information fließt ausschließlich über die expliziten Regeln. Regressionstests in `preflight.test.mjs` („plan structural key build_scope does NOT derive build capability").
- **Required-Capability-Block:** case-07b (MCP fehlt), case-13 (git MISSING via capability_status) blockieren vor jeder Worker-Arbeit (fail early, worker_called=false bestätigt).
- **Optionale Capability blockiert nicht:** case-08 (github MISSING) → DEGRADED, läuft weiter, DONE.
- **MCP Calibration:** Preflight PASS bei vorhandenem Tool (case-07a), FAIL bei fehlendem required Tool (case-07b).

## 5. Research Calibration

- RESEARCH_COMPLETE: 13 Cases (code + docs + tests gefunden, inkl. case-05 code/docs/tests und case-02 Multi-File).
- RESEARCH_NOT_RUN: 3 (case-07b/11/13 — korrekt, da vor RESEARCH geblockt; kein Research-Verschwendung).
- RESEARCH_NOT_MEASURED: 1 (case-15 — CLI-JSON exponiert das Research-Contract nicht; Mess-Harness-Limitierung, kein Runtime-Fehler).
- RESEARCH_MISS: 1 (case-14 — Research lief, aber das ABORTED-Ergebnis von `run.mjs` enthält das Research-Contract nicht; dokumentierte Lücke, kein Fehlverhalten).
- Kein Case zeigte RESEARCH_PARTIAL oder OVERBROAD. Research liefert „adequate context, not maximal context" (depth=2, gefiltert).

## 6. Plan Calibration

- Plan Gate verhält sich korrekt: case-12 (fehlende Acceptance Criteria) → `PLAN_GATE`-Block, Build wird NIE aufgerufen (worker_called=false). Kein false accept, kein false reject.
- Gate prüft Struktur; inhaltliche Qualität ist Worker-Aufgabe. Alle akzeptierten Pläne in Round 2 waren strukturell valide und führten zu erwartbaren Builds. Kein PLAN_TOO_BROAD / TOO_NARROW / MISSED_TEST beobachtet (Fixture-Pläne bewusst präzise).

## 7. Build / Verify

- Build-Pfad: SUCCESS in 15 Cases, FAILURE in 1 (case-04, kontrolliert), nie bei geblockten Cases aufgerufen.
- Verify-Pfad: echte `node --test`/`node --check`-Ausführung. Kein Case mit `verify=PASS` aber 0 ausgeführten Tests (0 false greens; `NODE_TEST_CONTEXT` wird in `verify.mjs` und im Runner gestrippt).
- Tests wurden wirklich ausgeführt (siehe `tests.executed` pro Case in `results.json`).

## 8. Retry Calibration

| Case | failure_signature | strategy_delta | Attempts | Ergebnis | Klassifikation |
|---|---|---|---|---|---|
| case-03 | TEST_FAILURE (Attempt 0) | vorhanden (semantisch neu) | 2 | DONE | RETRY_EFFECTIVE |
| case-09 | identisch (beide Attempts) | identisch | 2 | SPLIT | RETRY_NO_PROGRESS, Repeat verhindert |
| case-04 | BUILD_FAILURE | keiner | 1 | SPLIT | kein künstlicher Retry |

- **Retry-Autorisierung korrekt:** nur mit failure_signature + meaningful strategy_delta + Versuchskontingent + keine Wiederholung.
- **Repeat Detection wirkt:** case-09 lieferte zweimal dieselbe (Signatur, Delta)-Paarung → `RETRY_DENIED_REPEATED_IDENTICAL_FAILURE` → SPLIT. Kein identischer Re-Retry.
- **Erfolgreicher Retry korrekt:** case-03 endet mit `first_bad_boundary=null` (die kanonische Erfolgssemantik nach VERIFY FAIL → Retry → VERIFY PASS). Der historische Boundary-Bug ist nicht zurückgekehrt.
- Semantische Strategy-Delta-Normalisierung (case/whitespace + Boilerplate-Filter in `retry-policy.mjs`) war für die beobachteten Fälle ausreichend; kein LLM-Controller nötig.

## 9. SPLIT / BLOCKED Calibration

- **CORRECT_SPLIT: 2/2.** case-04 (kein sinnvoller Strategy Delta → SPLIT, kein künstlicher Retry), case-09 (Repeat → SPLIT). Kein PREMATURE_SPLIT.
- **CORRECT_BLOCK: 6/6.** case-07b (missing required capability/MCP), case-10a (Security Hard Block), case-11 (CONTRACT_INVALID), case-12 (Plan Gate), case-13 (missing required capability), case-14 (run_id-Ersetzung → CONTRACT_INVALID). Kein FALSE_BLOCK, kein MISSED_BLOCK im Corpus.
- Optional fehlende Tools führen nie zu BLOCKED (case-08).

## 10. Review Calibration

- **Correctness:** bildet Build+Verify ab; in allen DONE-Fällen PASS, bei erwarteten Fehlern FAIL. ACTIONABLE_TRUE.
- **Security:**
  - True Positive: case-10a (hardcoded credential → CRITICAL → Hard Block) — security_true_block=1.
  - True Negative: case-10d (clean → PASS). 9 Cases security PASS ohne Findings.
  - Kein False Block: case-10b (TODO, LOW → FIX), case-10c (eval, MEDIUM → FIX). security_false_block=0.
  - **Gefundener Bug (Round 1):** `reviewSecurity` lieferte für non-blocking Findings `status: 'PASS'`, wodurch die REVIEWS-Boundary PASS blieb und `first_bad_boundary` auf CONTROLLER fiel (case-10c), während case-10b (quality-Finding) korrekt REVIEWS meldete. **Fix:** konsistente Semantik — jedes Finding → `status: 'FAIL'` + `recommendation: 'FIX'` (non-blocking) bzw. `BLOCK` (blocking); `blocking` bleibt separater Fail-Closed-Flag. Regressionstests in `test/controller/security-boundary.test.mjs` (5 Tests).
- **Quality:** TODO-Marker (case-10b) → LOW-Finding → FIX (nicht BLOCKED). Dateigrößen-Grenze nicht erreicht.

## 11. Security Hard Block & False Security Blocks

- `BLOCKING_HIGH_OR_CRITICAL_FINDING` → BLOCKED korrekt (case-10a), Boundary REVIEWS korrekt.
- Non-blocking LOW/MEDIUM → FIX, niemals automatisch BLOCKED (case-10b/10c).
- Kein Security-False-Block im Corpus.

## 12. FIRST_BAD_BOUNDARY Accuracy

- Round 2: **19/19 BOUNDARY_CORRECT** (accuracy 1.0).
- Erwartete Zuordnung bestätigt: fehlende Capability→BASELINE, ungültiger Plan→PLAN_GATE, Build-Crash→BUILD, Test-Fehler→VERIFY, Security-Block→REVIEWS, CONTRACT_INVALID→TASK, run_id-Ersetzung→null (ABORTED-Sondervariante).
- Round 1 zeigte 18/19 (case-10c CONTROLLER statt REVIEWS) → durch Fix in `analyze.mjs` geschlossen.

## 13. Observability & Secret Leakage

- `ecosystem.run-event.v1` für jede Phase, gleiche run_id (19/19).
- `hasSecretLeak` über alle Events/Decisions: **0 Leaks** (auch case-10a mit Fixture-Secret auf Platte; Review-Finding enthält keinen Content).
- Keine Secrets, keine kompletten Prompts in Reports/Events/Ergebnissen.

## 14. Legacy Usage

- `canonical_runtime_used=true` für alle 19 Cases; `legacy_fallback_used=false`; `legacy_fallback_reason=null`.
- `legacy_fallback_count=0`. Alle Soak-Cases laufen ausschließlich über den kanonischen Pfad. Das ist ein starkes Signal für einen späteren Retirement-Meilenstein, aber **kein** Löschauftrag in diesem Milestone.

## 15. Provider / Model

- Worker simuliert (deterministic executor): provider=`fixture`, model=`deterministic-executor`.
- Kosten: `COST_NOT_AVAILABLE` (keine zuverlässige lokale Kostentelemetrie; nicht geschätzt).

## 16. Gefundene Bugs & Fixes

| Bug | Root Cause | Minimaler Fix | Regressionstests |
|---|---|---|---|
| case-10c: FIRST_BAD_BOUNDARY=CONTROLLER statt REVIEWS bei FIX aus non-blocking Security-Finding | `reviewSecurity` status='PASS' bei non-blocking Findings; REVIEWS-Boundary blieb PASS | `analyze.mjs`: jedes Finding → status FAIL + recommendation FIX/BLOCK; blocking bleibt eigenständig | `test/controller/security-boundary.test.mjs` (5) |
| Plan-Informations-basierte Capability-Derivation feuerte nie (MISSED_REQUIRED write/test) | `runBaseline` bekam `plan: nativePlan?.plan \|\| null`; kanonischer Pfad liefert `planText` | Pipeline + run.mjs parsen Plan via `parsePlanText` → `planData` an Baseline | `security-boundary.test.mjs` (plan build_scope → write), `preflight.test.mjs` |
| Systematisches FALSE_REQUIRED:build (18/19) durch Plan-Strukturschlüssel `build_scope` | Detector scannte `JSON.stringify(plan)` gegen Keyword-Regex | Keyword-Derivation nur auf Task-Text; Plan nur via explizite Regeln | `preflight.test.mjs` (2 neue Tests) |

Kein Bug ohne Regressionstest. Keine spekulativen Umbauten (Architektur eingefroren).

## 17. Verbleibende Schwächen

1. **ABORTED-Ergebnis ohne Research-Contract** (case-14): `run.mjs` liefert bei CONTRACT_INVALID-Abort kein research-Contract zurück. Harmlos, aber Research-Evidenz fehlt im ABORTED-Ergebnis.
2. **CLI-Entry exponiert Research nicht** (case-15): `scripts/run-task.mjs --json` gibt kein research-Feld aus → Mess-Lücke im Harness (RESEARCH_NOT_MEASURED). Empfehlung: Research-Findings (Pfade, keine Inhalte) in die JSON-Compact-Ausgabe aufnehmen.
3. **case-08 `git` false-required** bei Task-Text mit „commit": grenzwertig, bewusst unverändert; bei Bedarf später über bessere Task-Semantik statt Keyword-Aufblähung adressieren.
4. **Nur deterministische Worker simuliert:** reale LLM-Workerpfade (Provider-/Modell-Routing, Kosten) sind in dieser Umgebung nicht messbar (COST_NOT_AVAILABLE).

## 18. Empfehlung

Die kanonische Runtime ist über den Corpus wiederholbar, diagnostizierbar und stabil (19/19 erwartete Terminalentscheidungen, Boundary-Accuracy 1.0, keine Bypässe, keine Secret-Leaks, kein Legacy-Fallback). Die drei gefundenen Schwächen wurden gezielt geschlossen. **Legacy-Retirement-Readiness: NOT_PROVEN → tendenziell READY** (alle Soak-Cases canonical, 0 Legacy-Fallback, Adoption-/Bypass-Tests grün), aber der Rückbau ist ein separater Meilenstein. Empfohlener nächster Meilenstein: **Legacy-Compatibility-Retirement-Analyse** (Legacy-Pfad-Belegung über reale Plugin-Sessions messen, dann Rückbau) sowie optional die Harness-Erweiterung für CLI-Research-Sichtbarkeit.

---

**Endklassifikation: `GREEN_OCAE_RUNTIME_SOAK_CALIBRATED`**

Baseline: `da41017` · PRE_SOAK_BASELINE=PASS · ROUND_1_COMPLETE=PASS · TARGETED_FIXES_TESTED=PASS · ROUND_2_COMPLETE=PASS (19/19) · REGRESSION_TESTS=PASS (nur dokumentierte Windows-Symlink-EPERM-Limitation) · DOCUMENTATION=PASS · MACHINE_READABLE_REPORT=PASS
