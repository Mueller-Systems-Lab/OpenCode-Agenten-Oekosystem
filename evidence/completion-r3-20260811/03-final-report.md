# OpenCode-Agenten-Oekosystem Completion Run R3

Repository SHA tested: `82a38b6f05220994d3d8571aa73ae58f5e426ab4`
Branch: `master`
Working tree: uncommitted R2 completion delta plus the scoped R3 cleanup; no commit, push, merge, deployment, or CT108 activation performed.
## A — Scope Cleanup

```text
TTS BEFORE = R2-added runtime/tts summary, audio adapter/fallback, TTS canary output, TTS tests, TTS event literals, validator/runtime references, and architecture section
TTS REMOVED = all R2 productive TTS implementation and integration points
FILES AFFECTED = runtime/tts/summary.mjs (deleted); scripts/run-completion-canary.mjs; test/contracts/completion-runtime-contracts.test.mjs; runtime/observability/events.mjs; scripts/validate-ecosystem.mjs; docs/architecture/local-completion-runtime.md
TEST RESULT = focused completion contract 9/9 PASS; R3 canary PASS; full local suite remains 210/212 because of unchanged Windows symlink EPERM probes
REMAINING_PRODUCT_TTS_REFERENCES = 0
```

Historical R2/refresh/canary artifacts remain unchanged and are explicitly classified as `HISTORICAL_OUT_OF_SCOPE_ARTIFACT`; they are not part of the Production Baseline. The current architecture document records the boundary only: TTS, speech synthesis, audio narration, prompt read-aloud, voice UI, and speech output are out of scope.

## B — Local Completion

| Area | Status | Evidence | Test |
| --- | --- | --- | --- |
| Capability Profiles | PASS | 15 profiles enumerated; default-deny/fail-closed fields retained | manifest validation; focused start-boundary contract |
| Mandatory MCP Preflight | PASS | real local initialize/tools-list discovery; required/optional distinction | focused N1–N10 contract; R3 canary |
| Negative Enforcement | PASS | missing MCP, version, operation, undeclared tool, denied write, path escape, drift | N1–N10 focused contract |
| Generic Resume | PASS | atomic state, lock, repository/profile drift reconciliation, no repeated `A` | R1–R5 focused contract; canary |
| Observability | PASS | `agent.*`, `policy.allow`, `policy.deny`; bounded attributes; no TTS events | focused event contract; R3 canary trace |
| Security Tests | HOST-GATED | unchanged real symlink assertions; direct `EPERM` evidence | canonical suite 210/212; no skip/junction substitution |

## C — Windows/Linux Security Verification

```text
WINDOWS_HOST_CAPABILITY = HOST_CAPABILITY_LIMITATION: real symlink creation returns EPERM; Developer Mode/SeCreateSymbolicLinkPrivilege unavailable
SECURITY_INVARIANT = unchanged tests require real symlinks for secret isolation, path containment, bootstrap boundaries, and approval-ledger protection
CAPABLE_HOST_TEST_RESULT = NOT_AVAILABLE; WSL has no registered distribution and no suitable Linux host was available
```

The Windows failures are not classified as a product security bug because the probe cannot instantiate the tested object. They are not classified as a harness portability fix because replacing them with junctions or skips would change or weaken the security property.

## D — PR Status

| PR | Current status | R3 classification |
| --- | --- | --- |
| #17 | open, non-draft, mergeable/unstable; base `f2b4489`, head `b2718d7` | `OWNER_INTEGRATION_DECISION_REQUIRED`; lifecycle/runtime proof is not in current master and would require rebase before any integration |
| #19 | open, draft, mergeable/unstable; stacked on #17; head `d67ce03` | `OWNER_INTEGRATION_DECISION_REQUIRED`; handoff depends on #17 and would require rebase before any integration |

Neither PR was merged or used as an alternate implementation source. No duplicate implementation was added in R3.

## E — Runtime Status

```text
SOURCE_VERIFIED = YES; Hermes hook source and expected SHA256 inputs match the CT108 closure package
LOCAL_RUNTIME_VERIFIED = YES for the local completion runtime canary; Hermes process/runtime is not locally installed
CT108_RUNTIME_VERIFIED = NO; CT108 is unreachable and no identity, loaded plugin hash, real allow canary, deny canary, or fail-open evidence exists
```

The package [`hermes-ct108-runtime-closure-package.md`](../../docs/run-cards/hermes-ct108-runtime-closure-package.md) still matches the current HEAD and source hashes, so it remains a valid prepared handoff rather than runtime evidence.

## F — Owner Actions

- Run the unchanged canonical suite on a Windows account with real symlink capability or a suitable Linux host, then attach the result to this exact SHA.
- From the approved CT108 network, execute the package with explicit activation approval, identity/plugin-hash capture, real allow and deny canaries, fail-closed test, and rollback verification.
- Decide whether PR #17 and stacked PR #19 remain wanted; if yes, rebase and re-review them against the current master before any merge decision.

No TTS action is required or listed: it is out of scope and removed.

## G — Final Classification

`AMBER_LOCAL_COMPLETION_GAPS_REMAIN`

Reason: TTS cleanup is complete and the local completion contracts pass, but the executable suite still has an evidenced Windows symlink capability gap and CT108 runtime evidence is absent. Production freeze is not permitted.
