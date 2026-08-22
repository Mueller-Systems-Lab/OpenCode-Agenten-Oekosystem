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
