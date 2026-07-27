# Abschlussbericht — Spec-Kit Assurance Closure

## Abschlussklassifikation

`GREEN_SAFE`

Capability finding (not part of the project-wide classification):
`TOOL_GAP_SPECKIT_0_13_BUNDLE_LIFECYCLE`

> **HISTORICAL REPORT:** This report predates the Issue #16 runtime-path
> contract. Any plural `.opencode/plugins/` paths are superseded; the current
> verified bridge is `.opencode/plugin/governance-v2.ts`.

Die projektkontrollierten Pfade sind nachweislich redigiert und fail-closed.
Der technisch getrennte Read-only-Reviewer hat in Review v3
`APPROVED_WITH_FINDINGS` geliefert. Der native Upstream-Befund ist als Risiko außerhalb des
unterstützten Projektpfads dokumentiert; er ist keine globale OpenCode-
Credential-Sicherheitszusage.

## Kurzfazit

Der native OpenCode-Befehl `opencode debug config --print-logs --log-level
DEBUG --pure` reproduziert mit ausschließlich synthetischen Werten in zwei
frischen Prozessen eine Ausgabe des aufgelösten Werts auf stdout. Der Pfad wird
vom Projekt weder aufgerufen noch als unterstützter Projektpfad dokumentiert
oder gewrappt und kann daher
nicht vor der nativen Serialisierung redigiert werden.

Die unterstützten Projektpfade — Bridge, Workflow, Runtime-Adapter, Managed
Launcher, Fehler-/Stack-Ausgaben sowie Evidence-/Report-Writer — redigieren
vor Ausgabe und Persistenz. Nicht parsebare oder nicht sicher redigierbare
Bridge-Ausgaben werden unterdrückt; ein sicherer `RED_BLOCK`-Fehler bewahrt den
ursprünglichen Exit-Status. Runtime- und Approval-Verträge bleiben grün.

Spec Kit 0.13.0 beweist keinen vollständigen nativen Bundle-Lifecycle für
Update, Bundle-SHA, atomaren Rollback oder vollständige Workflow-Delegation.
Diese Grenzen werden als `TOOL_GAP_SPECKIT_0_13_BUNDLE_LIFECYCLE` geführt und
nicht als unterstützte Native-Capabilities behauptet.

## Source of Truth

- Repository: `https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem`
- Start-Head: `a0d9e7aa53e4dc850d0a165f0a2b785b13ae1d27`
- End-Head: `a0d9e7aa53e4dc850d0a165f0a2b785b13ae1d27` (kein Commit)
- Branch: `agent/url-installer-runtime-enforcement`
- Spec-Kit-Version: `0.13.0` (isolierte Installation; global `0.8.5.dev0` nicht für Claims verwendet)
- Spec-Kit-Tag-SHA: `9a30db484b0876cb7e5a391cf735d59bd968e985`
- OpenCode-Version: `1.15.13`
- Node-Version: `v22.22.0`
- Betriebssystem: Linux, x86_64
- Shell: `/bin/bash`
- Validierungsdatum: `2026-07-20`
- **PR7 Remediation Notice (2026-07-21):** Evidence paths referenced in this report (e.g.,
  `evidence/spec-kit-closure-*`, `evidence/spec-kit-final-closure-*`,
  `evidence/spec-kit-assurance-20260720T193425Z/{01,02,04-20}*`) may not all be present in a
  clean PR branch checkout. The evidence was generated in the main working tree and partially
  materialized. Before relying on these paths, verify the referenced files exist or reference
  the main working tree directly. Verification Contract AC-A9 requires all evidence references
  to be resolvable before the PR proceeds to review.

## Unterstützte OpenCode-Oberfläche

Die vollständige Matrix steht in
`evidence/spec-kit-assurance-20260720T193425Z/03-opencode-supported-surface.md`.

Projektkontrolliert und unterstützt sind Bridge, Workflow-Commands,
Extension-Launcher, Runtime-Adapter, Managed Runtime Smoke, Child-Process-
Ausgaben, Fehlerobjekte/Stacks, Environment-Metadaten ohne Werte,
Evidence-/Report-Writer und Restart-Pfade. Diese Oberflächen durchlaufen die
zentrale Redaction-Schicht vor Persistenz.

Nicht unterstützt und nicht projektkontrolliert sind der native OpenCode-
Resolved-Config-Serializer, native Debug-Ausgaben und native OpenCode-Logs.
Der Projektumfang behauptet für diese Pfade keine globale OpenCode-
Credential-Sicherheit.

## Credential-Finding

### Native Upstream-Reproduktion

Mit isoliertem HOME/XDG-/Config-Root und ausschließlich synthetischen Werten
wurden API-Key-, Bearer-, Authorization-, Cookie-, Passwort-, Connection-
String-, Webhook-, Private-Key-, Environment-, Error-Message- und Error-Stack-
Klassen abgedeckt. Zwei frische native Prozesse beendeten sich erfolgreich;
stdout enthielt den synthetischen Wert, stderr nicht. Die vollständige
Reproduktion ist redigiert in
`evidence/spec-kit-assurance-20260720T193425Z/04-native-opencode-leak.txt`.

### Erreichbarkeit über Projektpfade

Die Projekt-Bridge, alle getesteten Workflow-Phasen, Restart-Prozesse und der
Runtime-Pfad enthielten in stdout/stderr keine run-spezifischen Sentinels. Die
projektseitige rekursive Suche fand null Treffer. Der native Treffer ist auf
die absichtlich unsicheren nativen stdout-Captures begrenzt.

### Trust Boundary

Die Grenze liegt vor dem projektseitigen Interceptor: OpenCode materialisiert
aufgelöste Konfigurationswerte im nativen Diagnose-Serializer. Das Projekt
kontrolliert die nachgelagerten Bridge-, Runtime- und Evidence-Pfade, nicht
diesen nativen Serializer. Klassifikation: `UPSTREAM_SECURITY_RISK` und
`UPSTREAM_RISK_OUTSIDE_SUPPORTED_PROJECT_PATH`.

### Projektseitige Mitigation

`scripts/lib/security/redaction.mjs` ist die zentrale Schicht für Secret-
Feldnamen, Header-/Bearer-/API-Key-Muster, Passwörter, Cookies, Connection
Strings, private Schlüssel, konfigurierte Environment-Secrets,
verschachtelte Werte, Error-Objekte, Zyklen und nicht serialisierbare Werte.
Bridge stdout/stderr werden getrennt behandelt. Evidence und Reports werden
erst nach Redaction persistiert.

### Fail-closed-Verhalten

Ungültiges UTF-8, ungültiges JSON, nicht serialisierbare Werte oder eine
ausfallende Redaction-Funktion führen zu unterdrückter Rohdatenausgabe und
einer sicheren Fehlerdarstellung. Der ursprüngliche Exit-Code beziehungsweise
der Kernel-Entscheid bleibt erhalten. `$ARGUMENTS` wird im Preflight nicht mehr
ausgegeben.

### Restart

Zwei neue Bridge-Prozesse bestanden den Restart-Test ohne Sentinel in stdout
oder stderr; der zweite Prozess replayte keine rohe Ausgabe des ersten.

### Rekursiver Secret-Scan

Der unterstützte Projekt-Harness-Scan fand `0` Treffer in `16` Dateien; der
Repository-Scan fand `0` Treffer für die run-spezifischen Werte in `7.253`
Dateien. Die native Reproduktion selbst bleibt mit `2` Treffern in den zwei
absichtlich unsicheren nativen stdout-Captures reproduziert. Vollständige,
nicht redigierte Sentinels stehen nicht in diesem Bericht oder der Evidence.

### Upstream-Issue-Entwurf

Der lokale Entwurf liegt unter
`docs/reports/opencode-upstream-credential-leak-draft.md` und ist mit
`DRAFT_ONLY_NOT_SUBMITTED` markiert. Es wurde kein Issue veröffentlicht.

## Bereits bewiesene Verträge

### Runtime Enforcement

`RUNTIME_VERIFIED`: Der reale OpenCode-Toolpfad blockierte RED-Sentinels vor
dem Seiteneffekt. Der Managed Launcher meldete `MANAGED_HOOK_ENFORCED`;
Kernel-Entscheide und Exit-Status wurden durch Redaction nicht verändert.
Hooks bleiben advisory; der Runtime-Kernel ist autoritativ.

### Approval Security

`LOCALLY_TESTED`: Approval Binding, Expiry, Replay-Schutz, Race-Schutz,
Resume, Neustartpersistenz und Ledger-Prüfungen bestanden. Der Approval-
Vertrag ist unabhängig von der Ausgabe-Redaction.

### Accidental-Init-Recovery

`LOCALLY_TESTED`: Die versehentliche Initialisierung wurde ohne Projektschaden
bereinigt; das verschobene Material bleibt recoverable. Die zugehörige frühere
Evidence bleibt Source of Truth für diesen Vertrag.

## Bundle-Capability-Matrix

| Capability | Einstufung |
|---|---|
| Bundle Discovery / Search / Info | `NATIVE_VERIFIED` |
| Bundle Build / Manifest | `NATIVE_VERIFIED` |
| Komponenteninstallation | `PROJECT_LAYER_VERIFIED` für Extension/Preset; vollständiges Bundle `TOOL_GAP_SPECKIT_0_13` |
| Workflow-Delegation | `TOOL_GAP_SPECKIT_0_13` |
| Component-SHA | `PROJECT_LAYER_VERIFIED` |
| Bundle-Archiv-SHA | `TOOL_GAP_SPECKIT_0_13` |
| Update | `TOOL_GAP_SPECKIT_0_13` |
| Rollback / Downgrade | `TOOL_GAP_SPECKIT_0_13` |
| Removal / Reinstall | `PROJECT_LAYER_VERIFIED` nur für getestete bundle-owned Extension/Preset-Komponenten |

Die Matrix mit Grenzen und Quellen steht in
`evidence/spec-kit-assurance-20260720T193425Z/10-bundle-capability-matrix.md`.
Native Bundle-Update, Bundle-SHA-Erzwingung, atomarer Rollback und vollständige
Workflow-Delegation werden nicht als unterstützt behauptet.

## Vollständige Testresultate

- Redaction: `28/28`, Exit 0, 0 übersprungen.
- Bridge: `12/12`, 2 Suiten, Exit 0, 0 übersprungen.
- Runtime fokussiert: `78/78`, 17 Suiten, Exit 0, 0 übersprungen.
- Approval fokussiert: `36/36`, 3 Suiten, Exit 0, 0 übersprungen.
- Spec-Kit fokussiert: `12/12`, 2 Suiten, Exit 0, 0 übersprungen.
- Vollständige Suite: `375/375`, 41 Suiten, 0 übersprungen, Exit 0.
- Serielle Bestätigung: `375/375`, 41 Suiten, 0 übersprungen, Exit 0.

Die Baseline war `375/375` (vor der PR7-Remediation). Nach der Hinzufügung der
Red-Tests und des Redaction-Fixes im Rahmen der PR7-Remediation: `388/388`, 44 Suiten.

## Validator-Ergebnis

`node scripts/validate-ecosystem.mjs` meldete lokal `GREEN_SAFE`, Exit 0. Dieser
lokale Status wurde durch das unabhängige Review nicht ersetzt, sondern durch
das separate Gesamtverdict ergänzt.

## Independent Review

Review v3 wurde technisch getrennt, read-only und ohne gewünschte Ziel-
klassifikation durchgeführt. Das eindeutige Gesamtverdict lautet:

`APPROVED_WITH_FINDINGS`

Die Findings betreffen die dokumentierte native Upstream-Grenze, den
Spec-Kit-0.13.0-Bundle-Lifecycle-Tool-Gap und lokal nicht verfügbare
Lint-/Typecheck-/Format-Werkzeuge. Kein Finding beschreibt einen Bypass der
projektseitigen Credential-Containment-Schicht.

Review-Paket und Review-Anforderung liegen unter
`evidence/spec-kit-assurance-20260720T193425Z/review-package/` sowie in den
Evidence-Dateien `20-independent-review-request.md` und
`21-independent-review-verdict.md`.

## Dokumentations-Claim-Audit

`evidence/spec-kit-assurance-20260720T193425Z/11-documentation-claim-audit.md`
prüft die Truth-Mirror-Dateien. Die Claims unterscheiden ausdrücklich:

- `STRUCTURAL`, `LOCALLY_TESTED`, `E2E_VERIFIED` und `RUNTIME_VERIFIED`;
- `UPSTREAM_SECURITY_RISK` für den nativen unsicheren Diagnosepfad;
- `UPSTREAM_TOOL_GAP` für den nicht bewiesenen Bundle-Lifecycle;
- `NOT_SUPPORTED` für globale OpenCode-Credential-Sicherheit;
- `E2E_VERIFIED` für das tatsächliche unabhängige Review-Verdict.

## Geänderte Dateien

Assurance-bezogene Änderungen umfassen die zentrale Redaction-/Safe-
Serialization-Schicht, Bridge-/Runtime-/Report-/Governance-Ausgabewege,
Top-Level-Fehlerpfade, den Preflight-Command, sechs neue Regressionstests,
die Truth-Mirror-Dokumentation, den Upstream-Draft und diese Evidence.

Die vollständige maschinenlesbare Liste steht in
`evidence/spec-kit-assurance-20260720T193425Z/review-package/02-assurance-file-list.txt`.
`.opencode/plugins/canonical-governance.mjs` und
`docs/adr/ADR-008-spec-kit-integration-boundary.md` enthielten bereits lokale
Änderungen und wurden nicht als fremde Änderungen überschrieben; ihre
Überlappung ist im Baseline-Nachweis markiert.

## Fremde lokale Änderungen

Die initiale Worktree-Aufnahme steht in
`evidence/spec-kit-assurance-20260720T193425Z/01-git-status-before.txt`.
Alle dort aufgeführten Änderungen gelten als fremd beziehungsweise bereits
vorhanden und wurden nicht gelöscht, formatiert, gestaged oder zurückgesetzt.
Es wurden weder Commit noch Push oder Remote-Aktion ausgeführt.

## Offene Findings

- Der native OpenCode-Credential-Leak bleibt ein bestätigtes Upstream-Risiko
  außerhalb des unterstützten Projektpfads.
- Spec-Kit 0.13.0 hat den dokumentierten Bundle-Lifecycle-Tool-Gap.
- ESLint-Konfiguration, TypeScript-Compiler und Prettier waren lokal nicht
  verfügbar; JavaScript-Syntax und `git diff --check` bestanden.
- Ein sandboxed Validator-Aufruf konnte seinen Node-Child-Prozess wegen
  `spawnSync node EPERM` nicht starten; der autorisierte lokale Rerun außerhalb
  der Sandbox meldete `GREEN_SAFE`. Der Umgebungsbefund ist in Evidence 17
  offengelegt.

## Nicht ausgeführte Aktionen

Kein `git fetch`, Commit, Push, Pull Request, Merge, Release, Remote-CI,
Upstream-Issue-Submit, öffentliche Catalog-Publikation oder produktive globale
Konfigurationsänderung. Die Einschränkung folgt der Owner-Freigabe für diesen
Assurance-Lauf.

## Rollback

Kein Rollback auf dem Arbeitsbaum durchgeführt, weil kein Commit oder
produktiver Zustand erzeugt wurde. Temporäre Testzustände wurden isoliert
angelegt; ein vom Managed-Runtime-Smoke erzeugtes Profil wurde nach der Prüfung
gezielt entfernt. Fremde lokale Änderungen blieben erhalten.

## Evidence-Pfade

- `evidence/spec-kit-assurance-20260720T193425Z/`
- `evidence/spec-kit-assurance-20260720T193425Z/review-package/`
- `docs/reports/opencode-upstream-credential-leak-draft.md`
- `evidence/spec-kit-final-closure-20260720T183149Z/`
- `evidence/spec-kit-closure-20260720T103548Z/`

## Definition-of-Done-Auswertung

- Unterstützte Oberfläche vollständig abgegrenzt: erfüllt.
- Native Leak reproduziert und Trust Boundary belegt: erfüllt.
- Projektpfade vor Persistenz redigiert und fail-closed: erfüllt.
- Pflicht-Negativtests und vollständige Regression: erfüllt.
- Bundle-Claims auditiert und Tool-Gap begrenzt: erfüllt.
- Sanitized Upstream-Draft erzeugt, nicht übermittelt: erfüllt.
- Unabhängige Freigabe: erfüllt; Review v3 `APPROVED_WITH_FINDINGS`.
- Truth Mirror aktualisiert: erfüllt.

## Git-Status

Start- und End-Head sind identisch; der Arbeitsbaum enthält die vorbestehenden
lokalen Änderungen sowie die Assurance-Artefakte. Es wurde nichts gestaged.
Der aktuelle Vollstatus ist in der finalen Evidence-Aufnahme dokumentiert.

## NEXT

1. Sanitisierten Upstream-Issue-Entwurf nach separater Owner-Freigabe einreichen.
2. Spec-Kit-0.13-Lifecycle-Tool-Gap bis zu verifizierten Upstream-Funktionen
   als `NOT_SUPPORTED` beziehungsweise Capability-Grenze behandeln.
3. Erst nach separater Owner-Freigabe über Commit/Push/Issue-Submit entscheiden.
