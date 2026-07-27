# Run Card — Canonical User Action Handoff

## 1. Goal

Implement and verify Issue #18 end-to-end across governance, reports, prompts,
OpenCode, Hermes, bootstrap, and machine completion.

## 2. Why Necessary

The ecosystem can currently expose plain owner-action text without executable
proof that the action is genuinely non-delegable.

## 3. Risk Tier

`HIGH_HUMAN_GATE`: cross-module governance/schema change plus authorized GitHub
issue/comment/push effects and more than ten affected files.

## 4. Context Level

`WARM` until RED evidence is captured; then `HOT`.

## 5. Source of Truth

GitHub Issue #18. Issue #16 / PR #17 are dependency context only.

## 6. Scope

- `governance/policy-core.yaml`, its schema and generated IR
- new canonical handoff schema
- report, Hermes, lifecycle/closure, generator, bootstrap, and validator modules
- `PROMPT-KERNEL.md`, `AGENTS.md`, canonical Hermes/Spec-Kit prompt surfaces
- feature specification, ADR, migration, tests, and manifest

## 7. Out of Scope

- Issue #16 / PR #17 mutation
- `master`, merge, deploy, force push, remote CI
- `.github/workflows/**`
- global OpenCode/Hermes config
- production data

## 8. Hard Constraints

- no `.env` or secret reads;
- no token/PII/private-path output;
- no real GitHub mutation in tests;
- no new dependency;
- no Issue-#16 branch change;
- no completion claim without fresh-clone and reviewer evidence.

## 9. Non-Touch Areas

All files outside the explicit Scope, especially `.github/workflows/**`,
`SECURITY.md`, `LICENSE`, `opencode.json*`, `.opencode/policies/**`,
`.opencode/agents/**`, `.opencode/skills/**`, user memory, and global runtime
configuration.

## 10. Involved Agents

- primary implementation/integration agent
- independent `review-agent` after implementation; read-only and leaf

## 11. Verification Contract

`docs/verification/canonical-user-action-handoff-contract.md`

## 12. Red Tests

Schema/governance, renderer/validator, surface parity, bootstrap fixture, and
machine final-status tests; no exception.

## 13. Test Matrix

- focused contract/integration tests
- Governance V2 generation and drift
- full `npm test`
- ecosystem validator
- syntax, security/redaction, lifecycle, bootstrap, Hermes, CLI, gitignore
- paths A–D locally and E after push
- `git diff --check`

## 14. Evidence Plan

Transient terminal outputs only unless a durable redacted report is required.
No private evidence directory is committed. Commit SHA binds remote/fresh-clone
evidence.

## 15. Owner Approval Status

| Gate | Status | Scope |
| --- | --- | --- |
| Apply | APPROVED | Issue #18 repository-local implementation in isolated worktree |
| Commit | APPROVED | atomic Issue #18 feature commits only |
| Push | APPROVED | normal push of `feat/canonical-user-action-handoff-contract` |
| PR | NOT_REQUESTED | not explicitly approved; draft only will be prepared |
| Merge | DENIED | explicitly out of scope |
| Deploy | DENIED | explicitly out of scope |
| Remote CI | DENIED | not requested; no workflow changes |
| Skill Write | NOT_REQUESTED | `.opencode/skills/**` excluded |
| Memory Write | NOT_REQUESTED | no memory writes |

## 16. Rollback Strategy

Revert feature commits or remove the isolated feature worktree after handoff.
No destructive reset, force push, deployment, or production rollback.

## 17. Expected Completion Classification

`VERIFIED_IN_SCOPE`, only if every Completion Claim Gate passes; otherwise the
actual strongest `NEEDS_REVIEW`, `TOOL_GAP`, or `RED_BLOCK` is reported.
