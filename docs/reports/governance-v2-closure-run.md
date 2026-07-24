# Governance V2 Closure Run

## Scope

Closure branch: `feat/governance-v2-closure-20260724`. The original dirty V2 worktree under `/tmp/opencode-governance-v2-20260724` remained unchanged. Preservation artifacts are in `artifacts/preservation/` and were copied from the immutable preservation set before closure edits.

## Runtime proof

- OpenCode `1.15.13` was started in isolated XDG data/config/cache directories with a local Ollama provider (`ollama/qwen3:1.7b`). The project plugin was explicitly listed in the temporary sandbox config because the installed CLI did not auto-load project plugins for the non-Git temporary directory.
- The OpenCode run performed a real `read` tool call. The audit contains `runtime: opencode`, `capability_key: filesystem.read`, `decision_class: A_AUTONOMOUS`, and `v2_enforced: true`.
- The local MCP fixture completed `initialize`, `tools/list`, and `tools/call` over stdio. `mcp.read` and `mcp.write` were gated; `mcp.mystery` was rejected before handshake with `RED_BLOCK_UNKNOWN_TOOL_EFFECT`.
- Prompt-injection text and MCP output are not authorization sources; only structured runtime sources are accepted by `evaluateAction`.

## Commands

| Command | Result |
| --- | --- |
| `node scripts/generate-governance.mjs --check` | exit 0, `GOVERNANCE_GENERATION_CHECK_OK 3` |
| `node scripts/check-governance-drift.mjs` | exit 0, `GOVERNANCE_DRIFT_CHECK_OK` |
| `node scripts/validate-ecosystem.mjs` | exit 0 |
| `node scripts/evaluate-prompt-governance.mjs --json` | exit 0, deterministic, 30 scenarios |
| `node scripts/run-governance-e2e.mjs` | exit 0, restart/revoke/rollback passed |
| `node --test --test-reporter=dot` | exit 0, run 1 |
| `node --test --test-reporter=dot` | exit 0, run 2 |

## Known limits

The compatibility API in `scripts/lib/gates/evaluate-all.mjs` and several legacy validation/adapter modules still contain the input aliases `GREEN_SAFE` and `AMBER_REVIEW`. New central-gate, OpenCode, Hermes-installed, MCP, and effectful CLI outputs use V2 classifications. The legacy matrix remains `LEGACY_ADAPTER` until those compatibility callers are removed or fully wrapped.
