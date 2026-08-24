# OCAE Multi-Model Runtime Proof — Milestone Evidence

**Final Classification:** `GREEN_OCAE_MULTI_MODEL_RUNTIME_PROOF_OPERATIONAL`

## Chain proven (real)

```text
REAL TASK
  ↓
CANONICAL RUNTIME (runtime/routing — deterministic routing policy)
  ↓
MODEL REQUIREMENTS (capabilities, provider constraints, budgets)
  ↓
DETERMINISTIC ROUTING POLICY (selectRoute / decideRouteAction)
  ↓
MODEL / PROVIDER SELECTION (runtime authority — worker cannot self-select)
  ↓
REAL WORKER (opencode run -m <assigned provider/model>)
  ↓
CLASSIFIED RESULT (real failure evidence → failure class)
  ↓
RETRY SAME MODEL | ESCALATE | PROVIDER FALLBACK | TERMINAL
  ↓
VERIFY (real checks) → REVIEWS → CONTROLLER (DONE | FIX | SPLIT | BLOCKED)
```

## Real provider/model reality (this machine)

- Authenticated providers: `deepseek` (api_key), `openai` (oauth).
- Configured models: 4 × deepseek, 10 × openai (`opencode models`).
- Models probed reachable this milestone (real calls): `deepseek/deepseek-chat`,
  `deepseek/deepseek-v4-flash`, `openai/gpt-5.4-mini` (+ reasoner, gpt-5.4-fast
  reachability probes).
- Selected Model A: `deepseek/deepseek-chat` (provider deepseek)
- Selected Model B: `deepseek/deepseek-v4-flash` (provider deepseek)
- Cross-provider: `openai/gpt-5.4-mini` (provider openai)

## Real routed sessions (7, all DONE, run_id stable, no secret leak)

| # | case | initial route | calls (real) | escalation | MCP | verify | terminal |
|---|---|---|---|---|---|---|---|
| 01 | primary-success | deepseek/deepseek-v4-flash PRIMARY_ROUTE | v4-flash#0 | no | no | PASS | DONE |
| 02 | direct-capability-mcp | deepseek/deepseek-v4-flash DIRECT_CAPABILITY_ROUTE | v4-flash#0 | no | 1 real (browser_navigate) | PASS | DONE |
| 03 | escalation | deepseek/deepseek-chat CHEAPEST_SUFFICIENT | chat#0 → v4-flash#1 | yes (MODEL_CAPABILITY_INSUFFICIENT) | 1 real (browser_navigate) | PASS | DONE |
| 04 | same-model-retry | deepseek/deepseek-chat CHEAPEST_SUFFICIENT | chat#0, chat#1 | no (RETRY != ESCALATION) | no | PASS | DONE |
| 05 | unavailable-fallback | deepseek/deepseek-chat PRIMARY_UNAVAILABLE_FALLBACK | chat#0 | no (fallback) | no | PASS | DONE |
| 06 | cross-provider | openai/gpt-5.4-mini DIRECT_CAPABILITY_ROUTE | gpt-5.4-mini#0 | no | no | PASS | DONE |
| 07 | repeatability | deepseek/deepseek-v4-flash PRIMARY_ROUTE | v4-flash#0 | no | no | PASS | DONE |

Repeatability: case 01 and case 07 are the SAME task with identical conditions →
identical initial route decision (PRIMARY_ROUTE, deepseek-v4-flash).

## Real escalation proof (case 03)

```text
run_id: stable across the whole run (all events carry the same run_id)
model A: deepseek/deepseek-chat really called
  → real session had no MCP grant (mcp_support=false)
  → real output lacks real browser evidence (heading fabrication is rejected
    by the mcp-evidence gate — a real playwright_browser_navigate call must be
    captured in the session)
  → failure_class = MODEL_CAPABILITY_INSUFFICIENT (real evidence)
deterministic routing decision: escalate (budget 0/1)
model B: deepseek/deepseek-v4-flash really called
  → playwright MCP enabled for this route (runtime grant authority)
  → real browser_navigate + snapshot in the session, mcp-evidence captured
  → verify PASS → reviews → controller DONE
```

## DoD evidence (summary)

- REAL_MULTI_MODEL_SESSIONS=7 (≥6) · REAL_MODEL_A_CALL=4 (chat) ·
  REAL_MODEL_B_CALL=3 (v4-flash) + 1 (gpt-5.4-mini)
- REAL_PRIMARY_SUCCESS=2 · REAL_DIRECT_CAPABILITY_ROUTE=2 ·
  REAL_MODEL_ESCALATION=1 · REAL_SAME_MODEL_RETRY=1 ·
  REAL_UNAVAILABLE_OR_FALLBACK_CASE=1 · REAL_ROUTED_MODEL_MCP_CALL=2
- MULTI_PROVIDER_PROOF=PROVEN (deepseek + openai both used for real)
- RETRY_ESCALATION_SEPARATION=PROVEN (case 03 vs case 04)
- RUN_ID_STABLE across retry (04), escalation (03), fallback (05)
- NO_SECRET_LEAK across all sessions

## Negative proofs (unit tests, test/routing/)

- Worker self-selection DENIED · unknown model MODEL_UNAVAILABLE ·
  disabled model DENIED · capability mismatch rejected pre-invocation ·
  escalation budget exhausted → no further model call · non-allowlisted
  provider never called · run-id replacement CONTRACT_INVALID · tool grant
  expansion after model switch DENIED · fake success NOT DONE ·
  tool-result never drives routing.

## Key files

- runtime/routing/model-catalog.mjs — canonical catalog (real metadata only)
- runtime/routing/failure-classifier.mjs — routing failure taxonomy + redaction
- runtime/routing/routing-policy.mjs — deterministic selection + bounded
  retry/escalation/fallback decisions + run-id guard + grant stability
- runtime/routing/routing-events.mjs — observability events
- runtime/run.mjs / runtime/pipeline/pipeline.mjs — runtime wiring (ROUTING
  phase, worker provenance, escalation seam)
- scripts/routing/run-routed-worker-session.mjs — real session harness
- scripts/lib/production-sentinel.mjs — 8 new invariants (24 → 32)
- runtime/production-baseline.json — updated manifest + fingerprint
