# Issue #43 Implementation Reality Refresh

Date: 2026-09-03
Branch: `research/issue-43-empirical-capability-qualification`
Start HEAD: `61eef7d068736bb52b2271866dcf75402ed312be`
Issue: #43
Draft PR: #44

## Validated repository state

- The checkout was clean after `git fetch --all --prune`.
- The requested research branch exists at the recorded start HEAD.
- Draft PR #44 contains the research/specification documents only; GitHub reports no review threads or submitted reviews.
- The canonical runtime is `runtime/run.mjs`; routing, retry/escalation, permissions, terminal decisions, and verification remain owned by the shared runtime.
- The existing harness resolver and `applyToolExposure` already implement generic fallback, worker self-selection denial, and hide-only tool shaping.
- The existing evaluation runner is fixture-capable and canonical-executor guarded, but its corpus/records do not yet model authoritative raw observations, result adaptation, freshness, contract drift, model-switch rehydration, compaction, or separate holdout confirmation.

## Validated OpenCode host state

The locally installed host reports `opencode 1.18.25`. Its installed `@opencode-ai/plugin` and `@opencode-ai/sdk` packages report `1.18.20`. The local plugin contract exposes:

- `directory`, `worktree`, and `project` context;
- `tool.execute.before` and `tool.execute.after` hooks;
- native tool IDs and schemas through the SDK;
- project/worktree, file/search, LSP, and MCP status surfaces;
- session compaction commands/events and `experimental.session.compacting` / `experimental.compaction.autocontinue` hooks.

These are sufficient host mechanics for this milestone. OCAE will use contracts/receipts and deterministic policy around them; it will not execute tools, replace raw observations, or build a repository index.

## Capability classification

| Proposed capability | Classification | Evidence / boundary |
| --- | --- | --- |
| Project/worktree, filesystem, `glob`, `grep`, `read`, `lsp`, tool transport | `HOST_REUSE` | Installed OpenCode plugin/SDK contract and canonical governance plugin |
| Raw tool execution and raw result ownership | `HOST_REUSE` | OpenCode `tool.execute.*` seams; OCAE keeps receipts only |
| Native session/context compaction substrate | `HOST_REUSE` | Installed compaction hooks/events/API |
| Model/provider qualification identity and fingerprints | `OCAE_POLICY` | Development/evaluation evidence contract |
| Tool-call and observation metrics | `OCAE_POLICY` | Empirical contract; raw counts retained |
| Deterministic model-facing observation adapters | `OCAE_POLICY` | Derived data, never verifier authority |
| Freshness/invalidation receipts and model-switch rehydration | `OCAE_POLICY` | Re-render/re-observe from raw receipts; fail closed otherwise |
| Discovery ordering, bounded stop rules, structural information load | `OCAE_POLICY` | Task-local policy over granted OpenCode primitives |
| Candidate derivation and holdout A/B evaluation | `OCAE_POLICY` | Development-only, no auto-promotion |
| OCAE-owned full-repository index or replacement code-intelligence engine | `HOST_GAP_REQUIRES_SEPARATE_REQUIREMENT` | No reproducible host gap found; out of scope |

## Verification contract for this implementation slice

The implementation must prove deterministic contracts for raw-observation authority, explicit lossiness, safe fallback, freshness, call/result correlation, tool-contract drift, model-switch rehydration, compaction provenance, untrusted-content containment, bounded decomposition, zero-sample metrics, and derivation/holdout separation. It must not alter stable production routing, grants, retry budgets, terminal authority, or verification authority.

## Skill preflight

### Task profile

Repository-local implementation, contract testing, deterministic evaluation, and architecture documentation.

### Existing relevant skills

- `run-card-skill-preflight`: inventory and select skills for this multi-step run.
- `verification-before-completion`: require fresh command evidence before completion claims.
- `architecture-drift-guard`: boundary decisions are already explicit; no question is required unless implementation reveals a new unresolved ownership or persistence decision.

### Capability gaps / installation decision

No additional skill is required. Existing skills cover the run; no external skill or dependency installation is authorized or necessary.

Result: `GREEN_SKILL_PREFLIGHT_COMPLETE`
