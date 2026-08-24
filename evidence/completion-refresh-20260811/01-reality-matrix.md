# Reality Matrix

| Bereich | Zustand | Evidence | Aktion |
| --- | --- | --- | --- |
| Universal Bootstrap | VERIFIED_GREEN (structural/local) | Existing bootstrap contracts and validator checks | Reuse; no rebuild |
| Canonical Working Method / Governance V2 | VERIFIED_GREEN (structural/local) | Existing policy files, contract tests, `GOVERNANCE_DRIFT_CHECK_OK` | Reuse; no rebuild |
| Current repository | VERIFIED_IN_SCOPE | HEAD `82a38b6f...`, branch `master`, no content diff in generated policy files | Preserve unrelated state |
| Windows test harness paths | DRIFT | Native-path ESM imports and hard-coded `/tmp` found by fresh test run | Corrected in three test files |
| Agent capability profiles | OPEN | Manifest has an agent catalog but no per-agent `required_tools` / `optional_tools` contract | Not implemented in current master |
| Mandatory MCP preflight | OPEN | No runtime preflight entrypoint or agent-start integration found | `AMBER_REQUIRED_MCP_PREFLIGHT_GAP` |
| MCP negative enforcement | UNKNOWN | Existing guarded MCP call/evaluator exists, but no mandatory per-agent preflight proof | Cannot claim active invariant |
| Hermes CT108 runtime | BLOCKED / TOOL_GAP | CT108 `192.168.1.210:9119` TCP probe failed in the non-usual network; no local Hermes executable found | `AMBER_HERMES_RUNTIME_ENFORCEMENT_NOT_ACTIVE` |
| Hermes repository hook | VERIFIED_IN_SCOPE (source only) | `integrations/hermes/__init__.py`, `gate_hook.py`, Python contract tests | Runtime proof still required |
| Restart / resume | PARTIAL | Approval receipt replay/parallel-consume tests pass; no generic agent run-state resume proof in current master | Needs implementation/proof |
| TTS prompt summary | OPEN | No TTS/speech implementation found | `AMBER_TTS_INTEGRATION_INCOMPLETE`; text artifact supplied |
| Observability / evaluation | PARTIAL | Existing evidence/run-card and test harness present; no complete runtime trace proof | Needs runtime evidence |
| Final production freeze | BLOCKED | Validator reports 210/212; CT108/MCP/TTS gates incomplete | Do not freeze |
