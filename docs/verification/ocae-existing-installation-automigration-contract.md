# Verification Contract: Existing-Installation Pre-Task Auto-Migration

## Desired Behavior

When an existing compatible OCAE project is opened with the current global
OCAE/OpenCode integration, an ordinary top-level user task triggers trusted
metadata reconciliation before project-local governance, updates only
OCAE-managed files through the canonical CLI, verifies the current runtime, and
then processes that same message through task bootstrap and normal governance.

## Acceptance Criteria

1. Old commit `93a779a6fd7da32c937430191570bda2a83ffab4` is classified as
   `MIGRATION_REQUIRED` before the first governed effect.
2. Current projects classify as `PROJECT_CURRENT` without an update or full
   verify call on the fast path.
3. Migration produces `PROJECT_OCAE_RUNTIME_COMPATIBLE=true`, a passing
   `ocae verify`, and a ready task context for the original message.
4. User tracked modifications and untracked files remain unchanged.
5. Managed drift, corruption, incompatibility, symlink, target drift, source
   lock tamper, CLI binding tamper, and downgrade fail closed precisely.
6. Ordinary messages never install OCAE into a `NOT_INSTALLED` project.
7. Fresh install and bare-URL handoff regressions remain green.

## Red Tests

1. Old-installation adapter E2E: before the fix, runtime/intent/capsule remain
   absent after the ordinary message.
2. Migration E2E: before the fix, the adapter does not invoke `update` and the
   old source commit remains installed.
3. Fast-path test: before the fix, no version-state contract exists.
4. Security negatives: before the fix, no adapter-side classification or
   boundary checks exist.

## Regression Tests

Existing bootstrap, installer, runtime-integrity, task-bootstrap, approval, and
URL-only tests listed in the specification must remain green.

## Reality Gate

1. Create a disposable Git project.
2. Install the canonical installer from commit `93a779a6...` into it.
3. Confirm old source-lock, old governance plugin, and missing task-bootstrap
   runtime/context files.
4. Exercise the actual installed global adapter's `chat.message` contract with
   an ordinary prompt and capture the pre-fix stale result.
5. Exercise the repaired adapter with the current bound CLI and the same
   prompt; capture reconcile events, update/verify results, task-bootstrap
   events, preserved user files, and a successful bounded first write/test.
6. Repeat for a current project, a foreign project, and the bare canonical URL.

## Evidence Types

| Evidence Type | Source | How Collected |
| --- | --- | --- |
| Reproduction output | disposable old fixture | captured command output and exit codes |
| Adapter event sequence | mocked OpenCode client / runtime log | structured event records, no prompt text |
| CLI invocation contract | adapter test spy | exact argv, absolute target, `shell=false` |
| Marker/manifest integrity | target metadata | JSON parse and SHA-256 assertions |
| Preservation | Git + filesystem | before/after hashes and file bytes |
| Security negatives | Node/Python tests | deterministic failing/pass output |
| Runtime verification | OpenCode 1.18.18 plugin contract | actual plugin load and hook execution |
| Change evidence | Git | `git diff --stat`, focused diff, test output |

## Untestable Assumptions

| Assumption | Why Untestable | Risk if Wrong |
| --- | --- | --- |
| Future OpenCode versions preserve the 1.18 `chat.message` contract | Only the installed local runtime is available | Adapter may require a compatibility release |
| A provider/model is available for a real model-driven task | Credentials and external model calls are intentionally excluded | Full user-visible model E2E remains a documented tool gap |
| A local filesystem attacker cannot alter the trusted global CLI and adapter simultaneously | The trust boundary is the installed global integration | This is a host compromise outside project migration scope |
| Windows symlink creation is host-policy dependent | Developer mode/privileges vary | Symlink tests may be classified as host-limited |

## Completion Claim Gate

- [ ] All acceptance criteria met
- [ ] Red tests pass after implementation
- [ ] Regression tests pass
- [ ] Reality gate passes, or precise runtime tool gap is recorded
- [ ] Evidence is captured with provenance and redaction
- [ ] Diff/stat and payload state reviewed
- [ ] Reviewer evidence is recorded
