# Local Completion Canary

Source: `evidence/completion-canary-r2/canary-report.json` and its JSONL trace.

| Canary | Evidence | Result |
| --- | --- | --- |
| Valid agent profile | profile load, preflight, task | `VERIFIED_IN_SCOPE`, run complete; optional GitHub degraded safely |
| Required MCP missing | required server absent | `RED_BLOCK`, `FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT`, `executed: []` |
| Policy deny | forbidden write operation | `allowed: false`, `MCP_OPERATION_DENIED`; policy deny event emitted |
| Resume | pause after A, restart, continue B | `RUN_PAUSED` then `RUN_COMPLETE`; A not repeated |
| TTS | German safe summary and unavailable engine | `DEGRADED_TTS_TEXT_FALLBACK`; no audio on this host |

Trace events include `agent.preflight.start`, `agent.preflight.result`,
`agent.start`, `agent.task.start`, `agent.task.result`, `policy.deny`,
`tts.summary`, and `tts.result`.
