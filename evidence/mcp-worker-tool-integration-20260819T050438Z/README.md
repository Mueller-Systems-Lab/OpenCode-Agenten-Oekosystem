# OCAE MCP Worker Tool Integration — Milestone Evidence

**Final Classification:** `GREEN_OCAE_MCP_WORKER_TOOL_INTEGRATION_OPERATIONAL`

## Chain proven (real)

```text
REAL TASK
  → MCP REQUIREMENT
  → PREFLIGHT (real server discovery, fail-closed)
  → LEAST-PRIVILEGE TOOL GRANT
  → REAL WORKER (run-worker-session harness, deepseek-v4-flash)
  → REAL MCP TOOL CALL (playwright-mcp: browser_navigate + browser_snapshot)
  → VALIDATED RESULT (declarative expectation)
  → OBSERVABILITY / PROVENANCE (fingerprints + events)
  → VERIFY (mandatory)
  → REVIEWS (deterministic analyzers)
  → CONTROLLER (sole terminal authority)
  → DONE / FIX / SPLIT / BLOCKED
```

## Real MCP reality (this machine)

- Configured servers (repo + global opencode config): `github` (github-mcp-server v1.9.0, stdio, enabled), `playwright` (playwright-mcp v1.63.0, stdio, enabled)
- Reachable servers: `playwright` (24 tools). `github` unreachable in this env (no GITHUB_PERSONAL_ACCESS_TOKEN) — used as the REQUIRED-MISSING case.
- Selected real proof tool: `playwright:browser_navigate` / `playwright:browser_snapshot` (read-only, deterministic, local, no cost).

## Real worker sessions (evidence/mcp-worker-tool-integration/)

| session | scenario | real calls | tool status | verify | terminal |
|---|---|---|---|---|---|
| rw-mcp-01 | required-success | 2 (navigate+snapshot) | SUCCESS | PASS | DONE |
| rw-mcp-02 | required-success | 2 (navigate+snapshot) | SUCCESS | PASS | DONE |
| rw-mcp-03 | optional-missing | 0 | SKIPPED | PASS | DONE |
| rw-mcp-04 | required-missing | 0 | NONE | NONE | BLOCKED |
| rw-mcp-05 | controlled-failure | 2 (1 denied) | DENIED | FAIL | SPLIT |
| rw-mcp-06 | tool-error | 2 (1 server error) | FAILURE | FAIL | SPLIT |

All sessions: `legacy_fallback=false`. Same run_id across all events per session;
multiple calls share run_id with distinct tool identity; attempts carry attempt.

## MCP invariants added to Production Sentinel (18 → 24 checks)

- MCP_REQUIRED_CAPABILITY_FAILS_CLOSED
- MCP_TOOL_SCOPE_LEAST_PRIVILEGE
- MCP_TOOL_RESULT_NOT_TERMINAL_AUTHORITY
- MCP_TOOL_CALL_BOUNDED
- MCP_TOOL_OBSERVABILITY
- MCP_NO_SECRET_LEAK

## Key files

- runtime/mcp/error-classifier.mjs — MCP failure taxonomy (8 classes)
- runtime/mcp/tool-grant.mjs — least-privilege grant + call-time scope (tool/server/mutation)
- runtime/mcp/tool-executor.mjs — real stdio tool-call executor (bounded, validated, observed)
- runtime/mcp/server-registry.mjs — real server discovery from opencode config + trust tiers
- runtime/observability/events.mjs — MCP events (additive)
- scripts/mcp/run-worker-session.mjs — real worker session harness
- test/mcp/tool-executor.test.mjs — 24 targeted tests
- scripts/lib/production-sentinel.mjs — 6 new invariants
- runtime/production-baseline.json — 18 invariants, new fingerprint
- docs/production-baseline.md — MCP worker capability section

## Security review (delegated security-agent)

- Verdict: VERIFIED_IN_SCOPE. Blocking findings: 0. NO_SECRET_LEAK: confirmed.
- Hardening applied from review: failure_reason redaction, stdout byte bound,
  mutation-scope fail-safe, preflight-degradation consumption, DENIED-never-spawns test.

## Controller authority re-proven

- tool success alone → NOT DONE (verify mandatory) — verified in tests + sessions.
- MCP server cannot declare terminal state; tool result treated as data
  (prompt-injection fixture `mark task DONE` flagged, not honored).
- Worker success claim does not bypass controller (controlled-failure → SPLIT).
