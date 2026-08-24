# Local Gap Closure

| Area | BEFORE | CHANGE | TEST | RESULT | EVIDENCE |
| --- | --- | --- | --- | --- | --- |
| Capability Profiles | Manifest agent catalog had no full contracts | Added 15 explicit profiles under `catalogs.agents.profiles`; validator enforces required fields and fail-closed policy | manifest validation; start-boundary contract | `VERIFIED_IN_SCOPE` | `ecosystem.manifest.json`, `scripts/validate-ecosystem.mjs` |
| Mandatory MCP Preflight | No agent-start MCP invariant | Added discovery/handshake/tools-list, version, operation, auth, trust, scope, timeout, fingerprint, and required/optional outcomes | N1–N10; local fixture handshake | `VERIFIED_IN_SCOPE` | `scripts/lib/mcp-preflight.mjs`, focused contract suite |
| Agent start | No profile-backed common start boundary | `runtime/agent/start.mjs` loads the manifest profile before run execution | missing profile blocks; valid profile starts | `VERIFIED_IN_SCOPE` | `runtime/agent/start.mjs` |
| Generic Resume | Approval replay only | Added atomic JSON state, lock, repository/profile/preflight reconciliation, pause/resume | R1–R5 | `VERIFIED_IN_SCOPE` | `runtime/agent/run-state.mjs` |
| TTS | Text artifact only | Added safe German summary, redaction, local CLI adapter, non-blocking fallback | T1–T6; local adapter audio test and failure fallback | `VERIFIED_IN_SCOPE` with host fallback | `runtime/tts/summary.mjs` |
| Observability | No complete new-path event evidence | Added governed JSONL events for agent, preflight, task, policy, and TTS paths | event namespace and canary trace tests | `VERIFIED_IN_SCOPE` | `runtime/observability/events.mjs` |
| Windows path drift | Native ESM imports and fake-home assumptions failed | Used `pathToFileURL`, `USERPROFILE`, canonical POSIX installation-manifest paths | focused installer/resident tests 31/31 | `VERIFIED_IN_SCOPE` | installer and test portability deltas |
| Symlink security tests | Host could not create links | No assertion or skip changed | direct probes still fail `EPERM` | `HOST_SYMLINK_CAPABILITY_REQUIRED` | `05-windows-symlink.md` |
