# Completion Run R3 — Run Card and Verification Contract

Date: `2026-08-11`
Repository: `OpenCode-Agenten-Oekosystem`
Starting HEAD: `82a38b6f05220994d3d8571aa73ae58f5e426ab4`
Branch: `master`
Source of truth: current repository state and this local R3 run report; no linked GitHub issue was supplied and `gh` is unavailable in the current environment.
## Goal

Remove the R2-introduced TTS scope contamination while preserving the agent capability profiles, mandatory MCP preflight, fail-closed policy enforcement, generic resume state, observability, Hermes source contracts, and the prepared CT108 closure package. Re-verify the resulting local completion candidate without claiming unavailable runtime or host capabilities.

## Scope

Write scope is limited to the mixed R2 completion files, TTS-only R2 files, current scope documentation, and new R3 evidence under `evidence/completion-r3-20260811/` and `evidence/completion-canary-r3/`.

Read scope includes the repository, local tests, historical R2/refresh evidence, Git metadata, and locally observable host/runtime state.

Forbidden scope: secrets, `.env*`, canonical production data, `.opencode/policies/*.json`, `SECURITY.md`, deployment, merge, push, CT108 activation, and edits to historical R2 evidence.

External effect scope: none authorized. PR inspection and CT108 reachability are read-only checks only.

## Out of scope

TTS, speech synthesis, audio narration, prompt read-aloud, voice UI, and speech output are not project features, gates, or owner actions. No new architecture or unrelated PR integration is authorized.

## Risk tier and workflow

`HIGH_HUMAN_GATE` applies to the overall runtime/security closure. Local deletion and documentation changes are reversible, but all security and runtime claims remain evidence-gated. Security evidence is evaluated before any compliance conclusion.

## Verification Contract

### Desired behavior

The production code path contains no R2-introduced TTS implementation, capability, hook, event, or test. The remaining local completion runtime continues to enforce MCP preflight before agent work, default-deny capability policy, safe path handling, atomic/locked resume, and governed observability.

### Acceptance criteria

1. Productive TTS references and the `runtime/tts` implementation are absent; historical evidence is unchanged and separately labeled.
2. The manifest retains all 15 capability profiles and no profile requires TTS.
3. Mandatory MCP preflight, N1–N10 negative enforcement, generic resume, and required observability events remain covered by the focused contract/canary checks.
4. No symlink security test is weakened, skipped, replaced with a junction, or falsely classified as passed.
5. The CT108 package hash inputs are updated to the resulting source commit if the source commit changes; CT108 is green only with real runtime identity and allow/deny/fail-closed evidence.
6. The independent verifier separates source/local evidence from CT108 runtime evidence and emits exactly one justified final classification.

### Red tests / structural exception

This change removes a wrongly scoped implementation and its tests; it is structural scope reconciliation rather than a new behavior feature. The required negative checks are the post-change product-tree search, validator manifest checks, focused completion contract suite, canonical suite, and independent verifier. No separate pre-change red test is added because the forbidden behavior is the code being deleted; the exact exception is recorded here.

### Regression tests

- `test/contracts/completion-runtime-contracts.test.mjs` for MCP preflight, resume, policy denial, and observability.
- `test/contracts/runtime-enforcement-contracts.test.mjs`.
- Installer/resident runtime portability and security tests.
- `node scripts/run-tests.mjs --all --reporter dot`.
- `node scripts/validate-ecosystem.mjs` and governance drift validation.

### Reality gate

Inspect the final HEAD, product-tree TTS search, diff/stat, executable test output, Windows symlink privilege/probe results, PR metadata if available, and CT108 reachability/identity. Never substitute historical or simulated runtime evidence for a live CT108 result.

### Evidence types

| Evidence | Source | Collection |
| --- | --- | --- |
| Scope matrix and diff | Git and semantic search | R3 reconciliation report and `git diff --stat` |
| Test result | canonical runner and focused tests | Timestamped command output tied to final HEAD |
| Security invariant | unchanged symlink tests plus minimal host probe | Windows host report and capable-host output if available |
| Runtime boundary | local canary and CT108 package | Separate local/source and CT108 runtime sections |
| Independent verification | fresh read/search/check pass | R3 verifier report |

### Untestable assumptions

| Assumption | Why untestable here | Risk |
| --- | --- | --- |
| CT108 is reachable from an approved network | Current environment may not route to `192.168.1.210` and no owner credentials are supplied | CT108 runtime enforcement remains unproven |
| Windows account can create real symlinks | Privilege/Developer Mode is host-controlled | Windows execution of symlink invariants may remain unavailable |
| No unrelated owner edits occur during this run | Shared worktree is externally mutable | Final diff/HEAD must be rechecked before any claim |

### Completion claim gate

- [ ] TTS product scope is removed and historical evidence is separated.
- [ ] Acceptance and regression checks pass on the final tested HEAD.
- [ ] All executable tests pass, or the exact host capability limitation is evidenced without weakening tests.
- [ ] Source/local runtime and CT108 runtime evidence are not conflated.
- [ ] Independent verifier passes.
- [ ] Final classification is limited to the evidence-supported R3 outcomes.
