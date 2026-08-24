# OCAE Runtime Availability & Cost Governance — Milestone Evidence

**Final Classification:** `GREEN_OCAE_RUNTIME_AVAILABILITY_COST_GOVERNANCE_OPERATIONAL`

## Chain proven (real)

```text
REAL TASK
  ↓
CAPABILITY REQUIREMENTS
  ↓
AUTHORIZED MODEL CANDIDATES (allowlist + capability filter)
  ↓
LIVE / VALID-CACHED HEALTH (bounded probe, TTL, cache)
  ↓
COST POLICY (ordinal tiers, high-cost gate, budgets)
  ↓
ROUTING BUDGET (max_high_cost_routes)
  ↓
CHEAPEST SUFFICIENT HEALTHY MODEL
  ↓
REAL WORKER (opencode run -m <assigned provider/model>)
  ↓
REAL PROVIDER USAGE (step_finish tokens)
  ↓
VERIFY → REVIEWS → CONTROLLER (DONE | FIX | SPLIT | BLOCKED)
```

## Availability semantics

`CONFIGURED != AUTHENTICATED != REACHABLE != HEALTHY != ROUTABLE`.

- **CONFIGURED** — in the canonical catalog.
- **AUTHENTICATED** — auth config present (deepseek api_key, openai oauth).
- **REACHABLE** — a current or valid-cached probe succeeded.
- **HEALTHY** — routable within defined policy.
- **ROUTABLE** — capability + authorization + health + budget all allow.

## Real health probes (this machine)

- `deepseek/deepseek-v4-flash` → **HEALTHY** (real probe, real usage)
- `openai/gpt-5.4-mini` → **HEALTHY** (real probe, real usage)

Both probes reused the existing opencode client (`opencode run -m ... --format
json --auto "<minimal prompt>"`) — no second provider abstraction, no price
scraping.

## Real availability sessions (7, all DONE, run_id stable, no secret leak)

| # | case | initial route | probes | real MCP | usage | terminal |
|---|------|---------------|--------|----------|-------|----------|
| 1 | healthy-primary | deepseek/deepseek-v4-flash (PRIMARY_ROUTE) | live UNKNOWN→HEALTHY | – | AVAILABLE | DONE |
| 2 | cached-health-repeat r1 | deepseek/deepseek-v4-flash (PRIMARY_ROUTE) | cached HEALTHY (no re-probe) | – | AVAILABLE | DONE |
| 3 | cached-health-repeat r2 | deepseek/deepseek-v4-flash (PRIMARY_ROUTE) | cached HEALTHY (no re-probe) | – | AVAILABLE | DONE |
| 4 | healthy-secondary | deepseek/deepseek-chat (CHEAPEST_SUFFICIENT) | live probe | – | AVAILABLE | DONE |
| 5 | multi-provider-openai | openai/gpt-5.4-mini (DIRECT_CAPABILITY_ROUTE) | live probe | – | AVAILABLE | DONE |
| 6 | availability-fallback | deepseek/deepseek-chat (AVAILABILITY_FALLBACK) | fixture UNAVAILABLE primary, live secondary | – | AVAILABLE | DONE |
| 7 | mcp-health-route | deepseek/deepseek-v4-flash (DIRECT_CAPABILITY_ROUTE) | live probe | **real context7 MCP call** | AVAILABLE | DONE |

Negative health states (unavailable primary) are deterministic fixture evidence
(`applyRuntimeEvidence`) — real credentials/accounts are never manipulated.

## Definition of done (real proof)

- `REAL_HEALTH_PROBE_DEEPSEEK >= 1` ✓
- `REAL_HEALTH_PROBE_OPENAI >= 1` ✓
- `REAL_HEALTHY_WORKER_CALLS >= 2` ✓ (7 real routed worker calls)
- `REAL_MULTI_PROVIDER_HEALTH_PROOF = PROVEN` ✓
- `REAL_USAGE_PROOF >= 2` ✓ (deepseek + openai, both `usage_status=AVAILABLE`)
- `REAL_AVAILABILITY_SESSIONS >= 6` ✓ (7)
- `HEALTHY_PRIMARY_CASE >= 1` ✓ · `LIVE_UNKNOWN_TO_HEALTHY_CASE >= 1` ✓
- `CACHED_HEALTH_CASE >= 1` ✓ · `MULTI_PROVIDER_CASE >= 1` ✓
- `MCP_HEALTH_ROUTE_CASE >= 1` ✓ · `RUN_ID_CORRELATION = PASS` ✓
- `LEGACY_FALLBACK_COUNT = 0` ✓

## How to reproduce

```bash
node scripts/routing/run-availability-session.mjs --probes-only   # real probes
node scripts/routing/run-availability-session.mjs --all           # real sessions
```
