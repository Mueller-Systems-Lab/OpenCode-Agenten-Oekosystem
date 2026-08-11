# R3 Independent Verifier

Verifier mode: fresh read/search/check pass after the R3 edits.
Repository SHA: `82a38b6f05220994d3d8571aa73ae58f5e426ab4`
Host: Windows, PowerShell, Node `v24.13.0` from the local approved test runtime.
## Claims actively challenged

| Claim | Independent check | Result |
| --- | --- | --- |
| TTS is outside productive scope | Case-insensitive search over `runtime/`, `scripts/`, `test/`, and `ecosystem.manifest.json` | `product_reference_count=0` |
| No TTS code is loaded | `Test-Path runtime/tts`; current canary imports and runs | `runtime_tts_exists=False`; R3 canary completed without TTS field/events |
| No TTS capability/event remains | 15 manifest profiles enumerated; event literals searched | 15 profiles; `tts_event_literals=0` |
| MCP preflight is mandatory | R3 focused contract and canary | 9/9; required absence returns `FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT`, executed list empty |
| Policy cannot be bypassed | N5/N6/N7 and canary deny | undeclared tool, denied operation, write scope/path escape blocked; `MCP_OPERATION_DENIED` |
| Resume does not duplicate work | R1–R5 and canary | `RUN_PAUSED` then `RUN_COMPLETE`; calls are `A`, `B` once |
| Drift invalidates state | R2/R3 contract | repository/profile drift returns `RESUME_STATE_RECONCILIATION_REQUIRED` |
| Symlink security was not weakened | diff/search of affected security tests and direct probe | no weakened assertion or junction substitution; direct Windows probe returns real `EPERM` |
| CT108 is not falsely green | reachability, package identity/hash review | TCP `False`; package remains prepared/not executed; no runtime claim made |
| Source/runtime evidence is separated | R3 package plus local canary locations | source/local evidence is separate from CT108 runtime evidence |

## Local gate evidence

- Focused completion contract: `9 passed, 0 failed, 0 skipped`.
- R3 canary: valid agent `RUN_COMPLETE`; missing required MCP fail-closed; policy deny; resume pause/complete; no TTS field or events.
- Governance drift: `GOVERNANCE_DRIFT_CHECK_OK`.
- Full canonical runner: `210/212` passed, `2` failed. The two failures are unchanged real-symlink security probes on this Windows account; the validator therefore reports `RED_BLOCK` for the suite gate.
- Individual groups: contract `137/138`, unit `210/212`, integration `35/41`, bootstrap `75/82`, governance `8/9`, e2e `124/126`; all failures are the same symlink capability limitation or its propagation.

## Host and external limits

- Developer Mode registry value: not present/unknown.
- `whoami /priv`: only `SeChangeNotifyPrivilege` was present; no `SeCreateSymbolicLinkPrivilege`.
- WSL: installed but no Linux distribution is registered.
- No capable Linux/WSL host was available in this environment.
- CT108 `192.168.1.210:9119`: unreachable (`False`).

Verifier outcome: TTS cleanup and local completion behavior are verified, but the local completion candidate still has a genuine host-dependent security gate and CT108 remains unverified. Production freeze is not permitted.
