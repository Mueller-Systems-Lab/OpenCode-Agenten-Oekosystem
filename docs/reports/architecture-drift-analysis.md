# Architecture Drift Analysis — Visual QA milestone

**Date:** 2026-08-22
**Pre-baseline:** `3c4bd8e271ef1e4633840175b054df1fdb562602` (fingerprint `9f13a10b5b20aedcf13e3a245edbe4f47849bfdc00bf257a08b95af46c9f303b`)
**Current:** fingerprint `db0a0bda0b3312d15577786baca40eec441f7fd629fa0229cee19f4a5501298f` (invariants 55 → 65, artifacts +5 visual)
**Sentinel:** `PASS` — all 65 invariants green, baseline fingerprint matched

## Baseline vs current

| Dimension | Pre-baseline (55 invariants) | Current (65) |
|---|---|---|
| Invariants | 55 (incl. BUDGET_CANCELLATION_RELEASE / BUDGET_NO_ORPHAN_RESERVATIONS) | +10 visual QA invariants |
| Required artifacts | runtime/*, routing/*, budget-governor | +5 runtime/visual/*.mjs |
| Installer artifacts | 68 dest entries | 73 (+5 visual) |
| RUN_BOUNDARIES | ... VERIFY, VISUAL_QA, REVIEWS, CONTROLLER (VISUAL_QA added prior) | same (inclusion re-validated) |
| Baseline manifest | required_artifacts 13 entries, fingerprint 9f13… | 18 entries, fingerprint db0a… |

Fingerprint drift is structural: invariants + installer_artifacts changed. No contract IDs, terminal states, next_paths, or manifest_groups drift — changes are strictly additive visual QA wiring.

## Intentional evolutions (expected drift)

1. **Model catalog vision_support** — `openai/gpt-5.4-mini` vision_support:true (real probe: image-content Q&A). Routing policy `needs_vision` gates selection; `selectRoute({needs_vision:true})` already existed, now exercised by visual-qa.
2. **Visual modules** — 5 files: `browser-evidence.mjs` (MCP playwright with array mcpCommand + --isolated), `vision-reviewer.mjs` (arg-order fix + workdir mkdir + opencode envelope extraction), `visual-finding.mjs` (13 categories, confidence non-gating), `visual-gate.mjs` (pure gate), `visual-qa.mjs` (file:// normalization, shared-budget lifecycle, cost-gated routing).
3. **Pipeline seam** — `VERIFY passed → VISUAL_QA → reviews.push(visualReview) → controller`. VISUAL_QA boundary recorded; UNVERIFIED and FINDINGS_BLOCKING both FAIL the boundary so firstBadBoundary prevents false DONE.
4. **Installer/fresh-install** — validation list + getRuntimeFileList now include 5 visual dests; fresh-install sentinel hard-coded artifacts extended; production-sentinel INSTALLER_REQUIRED_ARTIFACTS extended.
5. **Sentinel** — 10 new structural checks (vision-capable, no-OCR, not-terminal, verify-mandatory, least-privilege, cost, shared-budget, prompt-injection, no-secret, blocking-prevents-false-DONE) and RUN_BOUNDARIES VISUAL_QA inclusion check.
6. **Three verified patches preserved** — browser-evidence array+isolated, visual-qa file:// normalization, vision-reviewer arg-order+mkdir+envelope — all grep-verified PASS.

## Detected / closed drift

- **No unexpected drift** detected by sentinel: CONTRACT_SENTINEL, INSTALLER_SENTINEL, BASELINE_MANIFEST, BASELINE_FINGERPRINT all PASS after recompute.
- Negative drift fixtures still PASS (isolated, not touching repo): MISSING_RUNTIME, LEGACY_FALLBACK, INSTALLER_DRIFT, BASELINE_FINGERPRINT_DRIFT proofs unaffected — visual wiring is additive, not a replacement.
- Prior multi-process budget ledger limitation (§40) remains documented, not silently reinterpreted as visual scope.

## Authority matrix

| Decision | Owner | Visual QA role |
|---|---|---|
| `DONE | FIX | SPLIT | BLOCKED` | `runtime/controller/controller.mjs` (sole) | none — visual produces review only |
| `VERIFIED` vs `VISUAL_QA` order | pipeline | visual runs only after verify PASS |
| `model selection` (needs_vision) | `routing/routing-policy.selectRoute` | requests needs_vision:true, respects cost/budget/health gates |
| `MCP tool calls` (browser_*) | `mcp/tool-grant` + `mcp/tool-executor` | least-privilege grant, server-scoped |
| `budget reserve/commit` | `routing/budget-governor` | visual-qa reserves (HIGH tier), consumes after review |
| `visual defect → BLOCKED` | controller `securityHardBlock` | visual-gate FINDINGS_BLOCKING → review blocking=true → controller BLOCKED |
| `routing budgets` | routing policy + governor | visual QA participates, does not mutate budgets |

Visual QA never writes health state, never mutates grant, never creates run_id.

## Runtime diagram

```text
chat.message → bootstrapTask → runtime/run.mjs enterRun
  → TASK/BASELINE/ROUTING/RESEARCH/PLAN/PLAN_GATE
  → BUILD (attempt, strategy_delta) → VERIFY (runVerification)
  → VISUAL_QA [runVisualQa: selectRoute(needs_vision:true) → costGateAllows → sharedBudget.reserve
               → capturePageEvidence (MCP playwright) → reviewScreenshot (opencode vision)
               → evaluateVisualGate → createReview(visual)]
  → REVIEWS (analyze + visual review) → controller/decide → decision.v1
                                ↘ firstBadBoundary (TASK…VERIFY→VISUAL_QA→REVIEWS→CONTROLLER)
```

```text
Browser evidence sub-flow: browser_navigate(file://) → browser_resize (best-effort)
  → browser_wait_for → browser_snapshot (non-fatal) → browser_take_screenshot → fingerprint + sidecar
Vision sub-flow: spawnSync(opencode run <prompt> --dir <workdir> -m provider/model --format json --file=<png>)
  → envelope extraction → JSON array → findings (capped 100)
```

## Remaining risks

- **MCP availability** — playwright MCP must be installed per machine; absent → UNVERIFIED (not a false PASS, but reduces visual coverage). Remote SSE MCP still unavailable by design.
- **Vision model cost** — HIGH-tier vision routes are bounded by `max_high_cost_routes` and `allow_high_cost_escalation`; denied → UNVERIFIED (fail-closed). No live price oracle.
- **Screenshot determinism** — viewport is deterministic (1280×800 / 390×844) but browser rendering may vary by platform/fonts; gate uses categorical defects, not pixel diff.
- **Prompt injection in images** — mitigated by UNTRUSTED framing, but visual judgment relies on model following framing; defense-in-depth is the non-terminal authority (visual finding alone cannot emit DONE).
- **Single-process budget** — visual QA shares the same in-process governor as pipeline HIGH routes; cross-process budget coordination remains NOT_PROVEN (documented, not claimed).
- **OCR temptation** — sentinel enforces no-OCR; any future text-extraction helper would trip VISUAL_QA_NO_OCR_SUBSTITUTION.

## Evidence

- Sentinel invariants: 65/65 PASS, fingerprint db0a0b…
- Installer artifacts: 73 dest entries including 5 visual
- Pipeline order & RUN_BOUNDARIES: VERIFY → VISUAL_QA validated
- Visual tests: `test/visual/visual-core.test.mjs` and `visual-qa-integration.test.mjs` — core logic without real browser/model (seams).
- Patches grep: browser-evidence array+isolated PASS, visual-qa file:// PASS, vision-reviewer arg-order+mkdir+envelope PASS.

---

# Architecture Drift Analysis — GREEN_OCAE_MULTI_VIEWPORT_VISUAL_QA_SEVERITY_CALIBRATED (POST_CHANGE)

**Date:** 2026-08-23
**Milestone:** `GREEN_OCAE_MULTI_VIEWPORT_VISUAL_QA_SEVERITY_CALIBRATED`
**Pre-baseline (from /tmp/arch-drift-pre.md):** fingerprint `eae7c27d29c30fb2044988c08b49aa965095e68986a4c7156211499432b00470` (65 invariants, 18 required_artifacts, pre-report 2026-08-22)
**Current (post-change):** fingerprint `05656a7d2375627b78c7ced056c9f389f34e092919bad23251f9651c70bc1f3c` (69 invariants, 24 required_artifacts including 3 new visual modules)
**Sentinel:** `PASS` — 69/69 invariants green + 6 infra-only structural checks = **75 executed checks**, baseline fingerprint matches computed
**PRE_CHANGE_DRIFT_STATUS:** `CONTROLLED` (verified from `/tmp/arch-drift-pre.md` — `runProductionSentinel PASS 65/65`, `computeBaselineFingerprint` matches `eae7c...`, `BASELINE_MANIFEST`/`CONTRACT_SENTINEL`/`INSTALLER_SENTINEL`/`BASELINE_FINGERPRINT` all PASS, 9 MUST-REMAIN-CLOSED vectors CLOSED, 3 greenfield slots intentional)
**POST_CHANGE_DRIFT_STATUS:** `CONTROLLED`

## Baseline vs current (this milestone)

| Dimension | Pre (2026-08-22 visual QA, 65 checks) | Current (2026-08-23 multi-viewport, 75 checks) |
|---|---|---|
| `SENTINEL_INVARIANTS` (fingerprint inputs) | 59 | **69** (+10 multi-viewport) |
| `SENTINEL_EXECUTED_CHECKS` (`runProductionSentinel` results) | 65 (59 + 6 infra-only) | **75** (69 + 6 infra-only) — +10 new checks |
| Required artifacts (installer `getRuntimeFileList` dests via fingerprint) | 77 dest entries (18 `required_artifacts` in manifest) | **80 dest entries** (24 `required_artifacts` in manifest: +3 new visual files, installer `INSTALLER_REQUIRED_ARTIFACTS` still 36 structural minima but `production-baseline.json` lists 24) |
| Baseline manifest `critical_invariants` | 59 entries | 69 entries (10 new: `VISUAL_VIEWPORT_MATRIX_BOUNDED` … `VISUAL_MULTI_VIEWPORT_NO_SECRET_LEAK`) |
| `RUN_BOUNDARIES` | `['TASK','BASELINE','RESEARCH','PLAN','PLAN_GATE','BUILD','VERIFY','VISUAL_QA','REVIEWS','CONTROLLER']` (VISUAL_QA already present) | **unchanged** — VISUAL_QA still ordered after VERIFY; no boundary mutation |
| Contracts / Terminal states / Next paths / Manifest groups | 10 / 4 / 4 / 7 non-empty | **unchanged** — no contract/terminal/next_path/manifest_group drift |
| Installer artifacts fingerprint expansion | `INSTALLER_REQUIRED_ARTIFACTS` 36 minima | same minima expanded via `getRuntimeFileList` now includes 3 new visual dests; structural minima still enforced |
| Known infra-only checks (not in `critical_invariants`) | 6: `CONTRACT_SENTINEL`, `INSTALLER_SENTINEL`, `LINUX_SYMLINK_INVARIANT`, `VALIDATOR_TIMEOUT_INVARIANT`, `BASELINE_MANIFEST`, `BASELINE_FINGERPRINT` | **same 6** — `TEST_RUNNER_EXHAUSTIVE` remains an invariant (in the 69) and also an executed check, single entry |

Fingerprint drift `eae7c... → 05656a...` is structural and **intentional**: `critical_invariants` (+10) + `required_artifacts` (+3). No contract IDs, terminal states, next_paths, or manifest_groups drift — strictly additive runtime-deterministic wiring.

## NEW_INTENTIONAL_EVOLUTION (additive, no control plane mutation)

All three new modules are **runtime-owned deterministic policy**, not control plane, not worker authority. Authority remains with `runtime/controller` (terminal), `runtime/routing` (model/health/cost/budget), `runtime/mcp` (tool grant), `runtime/pipeline` (ordering).

1. **`runtime/visual/viewport-policy.mjs` — canonical matrix (bounded, deterministic)**
   - `CANONICAL_VIEWPORTS = Object.freeze({ 'mobile-small': {360,800}, 'mobile': {390,844}, 'tablet': {768,1024}, 'desktop': {1280,800}, 'wide-desktop': {1440,900} })` — 5 stable IDs, single source of truth.
   - `VIEWPORT_PROFILES = Object.freeze({ desktop_only:['desktop'], mobile_only:['mobile'], responsive_core:['mobile-small','mobile','tablet','desktop','wide-desktop'], custom:[] })`, `DEFAULT_VIEWPORT_PROFILE='responsive_core'` (full 5), `MAX_CUSTOM_VIEWPORTS=8`, `VIEWPORT_MATRIX_BOUNDS={ max_canonical:5, max_custom:8, max_total_per_run:8 }`.
   - Exports `getCanonicalViewport`, `isCanonicalViewport`, `isValidCustomViewport` (200–3840 × 200–2160, finite, non-empty name), `resolveViewportProfile` (unknown → `VIEWPORT_PROFILE_UNKNOWN`, non-array custom → `VIEWPORT_CUSTOM_INVALID`, unbounded `>1000` or `>maxCustom*10` → `VIEWPORT_MATRIX_UNBOUNDED_DENIED`, clamped slice to 8), `resolveViewportsForRun`.
   - Worker cannot explode matrix: `visual-qa.mjs` imports `resolveViewportProfile` from `viewport-policy.mjs`, validates **before** any `capturePageEvidence`/`reviewScreenshot`, and on `ok:false` returns `UNVERIFIED` with failure event `visual.qa.failure` without spawning browser captures. `VIEWPORT_PROFILES` is `Object.freeze` (page content cannot override).

2. **`runtime/visual/severity-calibration.mjs` — deterministic severity policy (runtime, not model)**
   - Version `1.0.0`, `CATEGORY_BASE_SEVERITY` (13 categories: `LAYOUT_OVERLAP/HIGH`, `INVISIBLE_INTERACTIVE_ELEMENT/HIGH`, `MISSING_ELEMENT/HIGH`, `UNEXPECTED_MODAL_OR_OVERLAY/HIGH`, `RESPONSIVE_BREAKPOINT_FAILURE/HIGH`, `CLIPPING/MEDIUM`, `VISUAL_OVERFLOW/MEDIUM`, `TEXT_TRUNCATION/MEDIUM`, `BROKEN_ALIGNMENT/MEDIUM`, `OFFSCREEN_CONTENT/MEDIUM`, `CONTRAST_RISK/LOW`, `VISUAL_REGRESSION/MEDIUM`, `UNVERIFIED_VISUAL_BOUNDARY/MEDIUM`), `CALIBRATION_CONFIDENCE_FLOOR=0.4`, `CALIBRATION_LOW_CONFIDENCE_FLOOR=0.2`.
   - Export `calibrateSeverity({ category, model_severity, interaction_blocked, content_loss(NONE/PARTIAL/COMPLETE), affected_viewport_count, total_viewports, critical_target, functional_accessibility, confidence }) → { calibrated_severity, model_severity, calibration_rule, calibration_inputs, review_required, low_confidence }`.
   - Rules are deterministic priority order: `CATEGORY_BASE` → `INTERACTION_BLOCKED(_CRITICAL_TARGET)` → `CONTENT_LOSS_COMPLETE(_CRITICAL_TARGET)` → `CONTENT_LOSS_PARTIAL` → responsive `+RESPONSIVE_FULL_MATRIX` (avc===tv && tv>1) → `+CRITICAL_TARGET` → `functional_accessibility` floor → confidence (`low_confidence`, `review_required`) **never lowers** `calibrated_severity`. Guarded by `severityRank` and `raiseOneLevel` bounded.
   - Model severity is **input data** (`model_severity` preserved separately); gate reads `calibrated_severity` only. Sentinel `VISUAL_MODEL_SEVERITY_NOT_FINAL` / `VISUAL_SEVERITY_RUNTIME_AUTHORITY` / `VISUAL_CALIBRATED_SEVERITY_GATE` enforce separation.

3. **`runtime/visual/cross-viewport-correlation.mjs` — deterministic grouping (no LLM, no pixel coordinates)**
   - Version `1.0.0`, exports `correlateFindings`, `normalizeSemanticTarget`, `correlationKey`, `descriptionFingerprint`.
   - `correlationKey = page|category|normalizeSemanticTarget({ locator, category, description, page })` lowercased, trimmed. `normalizeSemanticTarget` prioritizes `locator` (string or object `role/accessible_name/accessibleName/selector/testId/test_id/testID` joined with `|`) else fallback `category|page|descriptionFingerprint` (`lowercase→collapse whitespace→trim→slice(0,120)→slice(0,80)`).
   - Deterministic `finding_id = 'cf-' + sha256(key).slice(0,12)` (djb2 fallback). Grouping is **exact key match only** → `KEEP_SEPARATE` when uncertain; collects sorted `affected_viewports` and `unaffected_viewports = allViewports.filter(...)`, `severity = max severityRank(calibrated_severity ?? severity)`, `blocking = some(blocking===true)`, `confidence = min(finite)`, `correlation_confidence = HIGH if locator else MEDIUM if description>20 else LOW`, `evidence = per-viewport { viewport, evidence_ref, image_fingerprint, finding_id }`. Deterministic sort by `finding_id`.
   - No `openai`/`anthropic`/`callModel` — pure `crypto` hash grouping. `visual-qa.mjs` imports `correlateFindings` and runs it after calibration (`enable_correlation` default true, surfaces `correlated_findings` + `stats { total_raw, produced, incorrect_merges:0, missed_merges:0 }`). Failure is non-blocking (`visual.qa.correlation.failure` event).

Additive wiring only: `runtime/production-baseline.json` `required_artifacts` 18→24, `critical_invariants` 59→69, `baseline_fingerprint` recomputed via `computeBaselineFingerprint` (contracts+terminal+invariants+installer_artifacts+manifest_groups). No legacy execution reintroduced, no second controller, no MCP scope widening.

## AUTHORITY_REGRESSIONS: NONE

Verified post-change (reuse of pre-analysis matrix + new deterministic layers):

| Decision | Owner (canonical) | Runtime evidence (file:line) | Post-change status |
|---|---|---|---|
| **Terminal `DONE\|FIX\|SPLIT\|BLOCKED`** | `runtime/controller/controller.mjs` sole `decide()` | `pipeline.mjs:714 createDecisionContract({ decision: decision.decision ...})` from controller; `run.mjs:466 validateDecision`; sentinel `CONTROLLER_SOLE_TERMINAL_AUTHORITY` PASS | **CONTROLLED** — no worker/VQA/correlator/calibrator terminal assignment (grep: no `export function decide` in `runtime/visual/*.mjs`, no `decision:'DONE'` in visual subtree except doc comments) |
| **Model routing** | `runtime/routing/routing-policy.mjs` `MODEL_SELECTION_AUTHORITY=DETERMINISTIC_RUNTIME_POLICY` | `run.mjs:278 selectRoute` + `enforceRouteRunId`; `routing-policy.mjs:64 selectRoute` with `healthRoutable, costGateAllows` | **CONTROLLED** — visual-qa still `selectRoute({needs_vision:true})` via runtime |
| **Vision capability** | Catalog `vision_support` + `needs_vision` gate | `model-catalog.mjs:114 gpt-5.4-mini vision_support:true`; `routing-policy.mjs:143 needs_vision && vision_support`; `VISUAL_QA_REQUIRES_VISION_CAPABLE_MODEL` PASS | **CONTROLLED** |
| **MCP grant** | `runtime/mcp/tool-grant.mjs` | `run.mjs:204 resolveToolGrant`; `tool-grant.mjs:135 assertToolAllowed` with `MCP_TOOL_SCOPE_DENIED`; `visual-qa` threads `grant,mcp` through | **CONTROLLED** — viewport matrix reuses same `grant/server/session`, no allowlist expansion |
| **Browser execution** | MCP executor under grant | `browser-evidence.mjs:72 createMcpSession` + `mcpSessionCall({ grant, server })` for `browser_*` | **CONTROLLED** — single `createMcpSession` reused across viewports in `visual-qa` loop |
| **Visual finding detection** | Vision worker as **evidence** | `vision-reviewer.mjs:99 reviewScreenshot` with `SYSTEM_FRAMING UNTRUSTED DATA` + envelope extraction | **CONTROLLED** — worker returns `findings[]` data, never terminal; `VISUAL_QA_PROMPT_INJECTION_UNTRUSTED` PASS |
| **Finding correlation** | **Deterministic runtime** `cross-viewport-correlation.mjs` | `cross-viewport-correlation.mjs:138 correlateFindings({ findings, allViewports })` pure grouping, `crypto.createHash` + `simpleHash` fallback, no `openai`/`callModel` | **CONTROLLED** — new invariant `VISUAL_CROSS_VIEWPORT_CORRELATION_DETERMINISTIC` PASS; correlator never calls model/MCP, never mutates `run_id`/`grant` |
| **Severity calibration** | **Deterministic runtime policy** `severity-calibration.mjs` | `severity-calibration.mjs:54 calibrateSeverity` pure `severityRank`/`maxSeverity`/`raiseOneLevel` rules; `visual-qa.mjs:430 calibrateSeverity` before `visual-gate` | **CONTROLLED** — invariants `VISUAL_SEVERITY_RUNTIME_AUTHORITY`/`VISUAL_MODEL_SEVERITY_NOT_FINAL`/`VISUAL_CALIBRATED_SEVERITY_GATE` PASS; gate reads `calibrated_severity` |
| **Visual gate** | `runtime/visual/visual-gate.mjs` pure | `visual-gate.mjs:31 evaluateVisualGate` with `blocking===true && severityRank(calibrated_severity ?? severity)>=HIGH` → `FINDINGS_BLOCKING`/`BLOCKING_VISUAL_FINDING` | **CONTROLLED** — responsive gate still `blocking && calibrated HIGH → FAIL` |
| **Cost** | `routing-policy.mjs:214 costGateAllows` + `visual-qa.mjs:132 costGateAllows` | `visual-qa.mjs:204 costGateAllows` check; `routing-policy.mjs:488 isCostAllowed` + `phase_cost_ceilings` | **CONTROLLED** — single HIGH reservation per visual QA run (not per viewport); sentinel `VISUAL_MATRIX_COST_POLICY_ENFORCED` PASS |
| **Shared budget** | `runtime/routing/budget-governor.mjs` | `run.mjs:232 sharedBudget.governor reserve` + `pipeline.mjs:259 reserve → 392 commit`; `visual-qa.mjs:232 reserve` + `413 commit` (single reservation, `budget.shared.reserve/consume`) | **CONTROLLED** — `VISUAL_MATRIX_SHARED_BUDGET_ENFORCED` PASS; no unbounded `reserve()` per viewport |
| **Health** | `health-state.mjs` + `health-probe.mjs` | `run.mjs:284 resolveCandidateHealth` probe-before-route; `health-state.mjs` `HEALTH_TTL_BOUNDS/clampTtl` | **CONTROLLED** — calibration/correlation never re-route provider/model |

Additional preserved gates: `WORKER_SUCCESS_NOT_TERMINAL_EVIDENCE`, `NO_SECRET_LEAK` (visual evidence still `image_fingerprint` sha256 + sidecar `.meta.json` 0600, no raw PNG/prompt in events; `VISUAL_MULTI_VIEWPORT_NO_SECRET_LEAK` PASS), `VISUAL_QA_VERIFY_REMAINS_MANDATORY` (pipeline VERIFY→VISUAL_QA order, `first-bad-boundary.mjs` `RUN_BOUNDARIES` includes VISUAL_QA after VERIFY), `MCP_TOOL_SCOPE_LEAST_PRIVILEGE`/`MCP_REQUIRED_CAPABILITY_FAILS_CLOSED`/`MCP_TOOL_CALL_BOUNDED`/`MCP_TOOL_OBSERVABILITY`/`MCP_NO_SECRET_LEAK` all PASS.

## UNCLOSED_HIGH_CRITICAL_DRIFT: 0

All 9 MUST-REMAIN-CLOSED vectors re-verified CLOSED post-change (same as pre):

| Drift risk | Post-change check | Result |
|---|---|---|
| `VISION_MODEL_SEVERITY_AUTHORITY_DRIFT` | `severity-calibration.mjs` is pure runtime policy; `visual-gate` reads `calibrated_severity`; model `severity` kept as `model_severity` data only | **CLOSED** |
| `VIEWPORT_POLICY_WORKER_CONTROL_DRIFT` | `CANONICAL_VIEWPORTS`/`VIEWPORT_PROFILES` are `Object.freeze`; `resolveViewportProfile` is runtime-owned; `visual-qa` denies `VIEWPORT_MATRIX_UNBOUNDED_DENIED` before capture; sentinel `VISUAL_VIEWPORT_POLICY_RUNTIME_AUTHORITY` PASS | **CLOSED** |
| `VISUAL_CORRELATOR_TERMINAL_AUTHORITY_DRIFT` | `cross-viewport-correlation.mjs` is pure `findings→correlated` with no `decide`, no terminal, no MCP; `visual-qa` only `createReview` | **CLOSED** |
| `VISUAL_SEVERITY_GATE_BYPASS` | `calibration → gate → review(blocking)→ controller securityHardBlock → BLOCKED` chain preserved; `VISUAL_QA_BLOCKING_FINDING_PREVENTS_FALSE_DONE` + `RESPONSIVE_HIGH_FINDING_PREVENTS_FALSE_DONE` PASS | **CLOSED** |
| `COST_BYPASS` | Single `costGateAllows` + single `governor.reserve` per visual QA run even with 5 viewports; `VISUAL_MATRIX_COST_POLICY_ENFORCED` PASS | **CLOSED** |
| `BUDGET_BYPASS` | Same single reservation with `budget.shared.reserve/consume`; `VISUAL_MATRIX_SHARED_BUDGET_ENFORCED` PASS | **CLOSED** |
| `MCP_SCOPE_DRIFT` | `browser-evidence.mjs` still `mcpSessionCall({ grant, server })`; `VISUAL_QA_MCP_LEAST_PRIVILEGE` PASS | **CLOSED** |
| `VERIFY_BYPASS` | Pipeline VERIFY PASS → VISUAL_QA start; `VISUAL_QA_VERIFY_REMAINS_MANDATORY` PASS | **CLOSED** |
| `CONTROLLER_BYPASS` | `pipeline.mjs:714 createDecisionContract` from controller only; sentinel `CONTROLLER_SOLE_TERMINAL_AUTHORITY` PASS | **CLOSED** |

No HIGH/CRITICAL drift remains unclosed. Prior `SINGLE_PROCESS_BUDGET` (§40) limitation and `MCP availability` / ` screenshot determinism` risks remain documented, not drift.

## Sentinel verification (post-change)

| Metric | Pre | Post | Evidence |
|---|---|---|---|
| `SENTINEL_INVARIANTS` | 59 | **69** (+10) | `scripts/lib/production-sentinel.mjs:36 Object.freeze([...])` length 69; same 69 in `runtime/production-baseline.json:31 critical_invariants` |
| `SENTINEL_EXECUTED_CHECKS` | 65 | **75** (+10) | `scripts/lib/production-sentinel.mjs` `runProductionSentinel` pushes 75 results (69 invariants + 6 infra-only: `CONTRACT_SENTINEL`, `INSTALLER_SENTINEL`, `LINUX_SYMLINK_INVARIANT`, `VALIDATOR_TIMEOUT_INVARIANT`, `BASELINE_MANIFEST`, `BASELINE_FINGERPRINT`); `TEST_RUNNER_EXHAUSTIVE` is in the 69, not extra |
| Infra-only gap | 6 | 6 | unchanged |
| `INSTALLER_REQUIRED_ARTIFACTS` minima | 36 (5 visual) | 36 (same minima) but manifest `required_artifacts` 18→24 | `computeBaselineFingerprint` expands via `getRuntimeFileList()` to 80 dest entries (77 prior +3) |
| Contracts / terminal states / manifest groups | 10 / 4 / 7 non-empty | same | `CONTRACT_SENTINEL` PASS |
| Negative drift fixtures | 6 PASS isolated | **6 PASS** re-verified | `MISSING_RUNTIME_NEGATIVE`, `LEGACY_FALLBACK_REINTRODUCTION_NEGATIVE`, `INSTALLER_DRIFT_NEGATIVE`, `INVALID_MANIFEST_OR_EQUIVALENT_DRIFT_NEGATIVE`, `BASELINE_FINGERPRINT_DRIFT_NEGATIVE` (visual wiring additive, not replacement) |
| Baseline manifest invariants | 59/59 present | **69/69 present** | `checkBaselineManifest` loops over `SENTINEL_INVARIANTS` |

```
SENTINEL_INVARIANTS        59 → 69  (+10 multi-viewport invariants)
SENTINEL_EXECUTED_CHECKS   65 → 75  (+10 checks, 6 infra-only unchanged)
INSTALLER_REQUIRED_ARTIFACTS 36 → 36 minima (manifest required_artifacts 18 → 24)
BASELINE_FINGERPRINT       eae7c27d29c30fb2044988c08b49aa965095e68986a4c7156211499432b00470
                        → 05656a7d2375627b78c7ced056c9f389f34e092919bad23251f9651c70bc1f3c
```

## Fingerprint update

`runtime/production-baseline.json` recomputed via `computeBaselineFingerprint({ repoRoot })` from stable properties only:

- `contracts`: 10 `ecosystem.*.v1` (unchanged)
- `terminal_states` + `terminal_next_paths`: 4 `DONE|FIX|SPLIT|BLOCKED` (unchanged)
- `critical_invariants`: 69 (59 + 10 new multi-viewport)
- `installer_artifacts`: sorted dest list from `scripts/install-governance.mjs:getRuntimeFileList()` (80 entries including 3 new visual dests)
- `manifest_groups`: 7 non-empty (`bootstrap, contract, e2e, governance, integration, integration_portable, unit`) (unchanged)

```
PRE:  eae7c27d29c30fb2044988c08b49aa965095e68986a4c7156211499432b00470  (65 checks)
POST: 05656a7d2375627b78c7ced056c9f389f34e092919bad23251f9651c70bc1f3c  (75 checks)
```

Only `critical_invariants` and `installer_artifacts` moved — nightly comments/formatting never drift fingerprint. `BASELINE_FINGERPRINT` invariant PASS post-recompute.

## Authority matrix verification — still holds (reused from pre-analysis, confirmed post)

See table in `AUTHORITY_REGRESSIONS` above — controller sole terminal, routing runtime authority, MCP least privilege, cost/budget/health unchanged, vision worker evidence-only, correlation/severity are runtime-deterministic. All 10 prior visual QA invariants plus 10 new multi-viewport invariants PASS; no authority escape.

## Remaining risks (updated)

- **MCP availability** — same; viewport matrix reuses one `createMcpSession` per run, not N concurrent sessions; absent → `UNVERIFIED` (fail-closed, not false PASS).
- **Vision model cost** — same HIGH-tier bounded; single reservation per visual QA run (not per viewport); multi-viewport does not multiply cost without gate.
- **Screenshot determinism** — same; 5 viewports multiply rendering variance but gate uses categorical `calibrated_severity`, not pixel diff.
- **Prompt injection** — same UNTRUSTED framing; new deterministic layers (calibration/correlation) are never LLM-invoked.
- **Single-process budget** — same NOT_PROVEN for multi-process; in-process governor still atomic `CHECK+RESERVE` with TTL expiry.
- **Correlation identity** — **new:** grouping relies on stable `locator` or `descriptionFingerprint`; vague descriptions or missing locators → `KEEP_SEPARATE` (no false merge) but risk of `missed_merges` (duplicate findings not deduped). Fingerprint slice 80 chars; collision risk negligible for controlled corpus.
- **Controlled corpus precision/recall** — **new:** vision metrics measured on 12–15 synthetic fixtures only; not a general accuracy claim.
- **OCR temptation** — same sentinel `VISUAL_QA_NO_OCR_SUBSTITUTION` now also covers multi-viewport (no `ocr` token in `runtime/visual/*.mjs`).

## Evidence (post-change)

- Sentinel invariants: 69/69 PASS + 6 infra-only = 75 executed checks, fingerprint `05656a...` matches `runtime/production-baseline.json`
- Installer artifacts: 24 `required_artifacts` including `viewport-policy.mjs`, `severity-calibration.mjs`, `cross-viewport-correlation.mjs`
- Pipeline order: VERIFY → VISUAL_QA → REVIEWS → CONTROLLER (re-validated; VISUAL_QA boundary FAIL still blocks false DONE via `firstBadBoundary`)
- Visual tests: prior `visual-core.test.mjs` still PASS; new multi-viewport corpora under `test/visual/` and `scripts/visual/run-visual-qa-session.mjs` multi-profile runner (responsive_core 5 viewports) with `calibrated_severity`/`correlation_stats` in session JSON
- Patches preserved: viewport-policy frozen matrix, severity calibration deterministic policy, cross-viewport correlation pure grouping — grep-verified no `ocr`, no `decide`, no `openai` in correlation, `calibrated_severity` separation
- Verdict: **POST_CHANGE_DRIFT_STATUS=CONTROLLED** — intentional additive evolution, zero authority regressions, zero unclosed HIGH/CRITICAL drift.

