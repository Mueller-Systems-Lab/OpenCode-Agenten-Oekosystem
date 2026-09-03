# Verification Contract — Issue #43 OpenCode Workspace Host Boundary

Status: **Research verification contract**  
Issue: **#43**

## Purpose

Prevent the empirical capability/adaptive harness milestone from accidentally duplicating OpenCode workspace/code-intelligence mechanics or expanding project/tool scope.

## Required assertions

The implementation milestone must prove all of the following:

1. `OPENCODE_OWNS_WORKSPACE_MECHANICS`
   - OCAE consumes host project/worktree and native tool capabilities rather than maintaining an independent full source index.

2. `OCAE_MUST_REUSE_HOST_CODE_INTELLIGENCE_WHERE_SUFFICIENT`
   - qualifying/adaptive paths use OpenCode-native discovery/search/LSP primitives when available and relevant.

3. `OCAE_DISCOVERY_STRATEGY_IS_POLICY_NOT_AUTHORITY`
   - discovery strategy can order, hide, bound, or stop already-authorized operations but cannot create requirements, grants, files, components, or scope.

4. `OCAE_MAY_HIDE_BUT_MUST_NOT_GRANT_TOOLS`
   - every candidate-exposed tool is a member of the canonical session grant.

5. `TARGET_REPOSITORY_LAYOUT_IS_NOT_PRESCRIBED_BY_OCAE`
   - equivalent fixtures with different legitimate source/test/component directory layouts can qualify without being rewritten into an OCAE application layout.

6. `NO_PARALLEL_FULL_REPOSITORY_INDEX_WITHOUT_EVIDENCED_HOST_GAP`
   - the milestone contains no persistent OCAE-owned whole-repository source/symbol index path.

7. `HOST_GAP_REQUIRES_SEPARATE_REQUIREMENT_AND_AUTHORIZATION`
   - a missing OpenCode host capability produces safe fallback/fail-closed evidence, not silent activation of a replacement subsystem.

8. `STALE_HOST_CAPABILITY_EVIDENCE_CANNOT_APPLY`
   - candidate evidence bound to a different relevant OpenCode host/tool capability fingerprint cannot silently drive current candidate behavior.

9. `DISCOVERY_EXPANSION_REMAINS_IN_SCOPE`
   - glob/grep/lsp/read expansion cannot cross authorized path/project boundaries.

10. `GENERIC_FALLBACK_REMAINS_AVAILABLE`
    - unknown/unqualified host/model combinations do not force an experimental discovery strategy.

## Fixture expectations

Use small deterministic repository fixtures with at least two materially different but legitimate layouts, for example:

```text
fixture-a/src + fixture-a/test
fixture-b/packages/app + fixture-b/qa
```

The same semantic task should be solvable through OpenCode-native discovery in both without requiring repository restructuring.

Where LSP/code intelligence is part of a test, record whether the host/language fixture actually makes it available. Do not classify missing LSP support as model failure.

## Evidence

Persist non-secret evidence sufficient to reconstruct the decision:

- OpenCode host/runtime version or stable identity;
- relevant host capability/tool-contract fingerprint;
- model/runtime identity;
- repository fixture fingerprint;
- granted tools;
- exposed tools;
- discovery strategy steps and bounded result counts;
- verifier result;
- failure classification;
- candidate/generic harness fingerprint.

Do not persist credentials, secret values, private absolute paths, or uncontrolled prompt content.

## Terminal classifications

Valid boundary-specific outcomes include:

- `PASS_HOST_REUSE_BOUNDARY`
- `SAFE_FALLBACK_HOST_CAPABILITY_UNAVAILABLE`
- `BLOCKED_SCOPE_EXPANSION`
- `BLOCKED_TOOL_GRANT_EXPANSION`
- `BLOCKED_STALE_HOST_EVIDENCE`
- `BLOCKED_PARALLEL_INDEX_NOT_AUTHORIZED`
- `NEEDS_REVIEW_HOST_GAP`

A research candidate cannot be promoted if any host-boundary security/authority assertion fails.
