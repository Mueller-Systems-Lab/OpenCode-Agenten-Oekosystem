# Run Card: Governance V2 Secret Isolation

## Goal

Close the adversarial URL-only bootstrap secret exposure with technical
capability isolation and safe denial recovery.

## Why Necessary

The documented prohibition failed because the model retained a built-in file
read capability. The closure must remove executable paths rather than rely on
instructions.

## Risk Tier

`HIGH_HUMAN_GATE`, with active completion classification
`RED_BLOCK_SECRET_EXPOSURE` until all closure evidence passes.

## Context Level

`HOT`. Reality refresh, incident analysis, owner authorization, architecture,
specification, and verification contract are present.

## Source of Truth

- Draft PR #12
- Prompt `OCAE-SECRET-ISOLATION-CLOSURE-2026-07-25`
- Local OpenCode incident session metadata

## Scope

- `governance/bootstrap-security-profile*`
- `runtime/security/**`
- secure bootstrap/OpenCode launch scripts
- bootstrap and security tests
- V2 classification runtime paths
- security architecture/specification/evidence documentation

## Out of Scope

- Production systems/data/secrets
- CT 108, VM 106, Odysseus, productive MCP servers
- Merge, ready-for-review transition, deployment, release, tag, auto-merge,
  force-push, or master push

## Hard Constraints

- No secret values in output, evidence, commits, or PR text.
- No generic model shell or generic model file reader.
- Tool gate plus independent OS/filesystem isolation.
- Source clone read-only; target scoped; host home and credentials invisible.
- Security review precedes compliance review.

## Scopes

- Read: repository source, official OpenCode docs, redacted incident metadata.
- Write: branch worktree, temporary test projects, Draft PR #12.
- Forbidden: secret contents except isolated in-memory sentinel verification,
  production paths, unrelated owner worktrees, protected systems.
- External effects: normal branch push and Draft PR update only.

## Participants

- Primary implementation and verification agent.
- No subagents are used; the task did not request delegation.
- Independent reviewer gate is performed after implementation.

## Verification Contract

`docs/verification/governance-v2-secret-isolation-verification-contract.md`

## Red Tests

All tests listed in the verification contract are written and executed before
the implementing runtime modules.

## Test Matrix

- Unit
- Contract
- Integration
- Deterministic direct bypass red team
- Positive URL-only provider E2E
- Adversarial provider E2E
- Two canonical full suites
- Validator, prompt governance, governance E2E
- Idempotence, rollback, re-apply
- Secret/security scan
- Fresh remote clone and remote-head E2E

## Evidence Plan

Evidence is written only as redacted structured reports and audit counts under
the repository's ignored test-harness area or a dedicated sanitized evidence
directory. Raw provider transcripts and sentinel values are never committed.

## Approval State

- Local apply: `APPROVED` by the task prompt
- Commit: `APPROVED` by the task prompt
- Normal branch push: `APPROVED` by the task prompt
- Draft PR update: `APPROVED` by the task prompt
- Remote provider E2E: `APPROVED` by the task prompt
- Merge: `DENIED`
- Auto-merge: `DENIED`
- Ready-for-review: `DENIED`
- Deployment/release/tag: `DENIED`
- Force-push/history rewrite: `DENIED`

## Rollback Strategy

Use installer backup manifests for target changes and normal revert commits for
repository changes. Temporary test projects are disposable. Never rewrite
history.

## Expected Completion Classification

`VERIFIED_IN_SCOPE` only after every local and remote closure gate passes;
otherwise the most precise `RED_BLOCK_*`, `NEEDS_REVIEW_*`, or `TOOL_GAP_*`.
