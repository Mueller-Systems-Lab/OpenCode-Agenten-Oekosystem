# Issue #43 — OpenCode Host-Boundary Decision Record

Date: 2026-09-03  
Branch: `research/issue-43-empirical-capability-qualification`  
PR: #44

## Decision

The Issue #43 adaptive-harness research will not introduce an OCAE-owned full-repository index or prescribe a target-project folder layout.

OpenCode remains the workspace and code-intelligence host. OCAE will optimize the model-facing use of host capabilities through bounded discovery strategy, tool exposure, context shaping, task decomposition, governance, verification, and evidence.

```text
OPENCODE_OWNS_WORKSPACE_MECHANICS
OCAE_OWNS_DISCOVERY_STRATEGY_AND_POLICY
```

## Existing evidence motivating the decision

Current OCAE already operates as an OpenCode plugin/runtime layer:

- the canonical governance plugin receives OpenCode project/directory/worktree context;
- the plugin governs host tools including `read`, `grep`, `glob`, `lsp`, write/edit, delegation, and external operations;
- OCAE already has lightweight deterministic project discovery for language/framework/package-manager/test/database/monorepo/project signals;
- Issue #33 already establishes that model profiles are data/refinement layers and cannot replace canonical authority.

The new research therefore targets model-specific operating strategy rather than duplication of host workspace mechanics.

## Consequences

The implementation milestone must first inventory actual OpenCode host capabilities and classify proposed work as:

- `HOST_REUSE`
- `OCAE_POLICY`
- `HOST_GAP_REQUIRES_SEPARATE_REQUIREMENT`

Only the first two categories are in Issue #43 scope.

A future host-gap subsystem requires reproducible evidence and separate owner authorization.

## Documents aligned

- Issue #43 body
- empirical capability qualification specification
- empirical capability qualification implementation plan
- OpenCode workspace host-boundary architecture document
- Issue #43 host-boundary verification contract
- Draft PR #44 description

No stable runtime, routing, installer, provider, credential, or promoted harness profile is changed by this decision record.
