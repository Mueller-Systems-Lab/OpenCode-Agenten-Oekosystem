# OpenCode Workspace Host Boundary for Adaptive OCAE Harnessing

Status: **Normative research architecture boundary**  
Issue: **#43**  
Applies to: empirical model qualification, adaptive tool exposure, context shaping, and bounded task decomposition

## Decision

OpenCode remains the authoritative workspace host and code-intelligence surface. OCAE is an agent/governance/harness policy layer on top of OpenCode; it must not become a second IDE or a competing repository-indexing engine.

Canonical boundary:

```text
OPENCODE_OWNS_WORKSPACE_MECHANICS
OCAE_OWNS_DISCOVERY_STRATEGY_AND_POLICY
```

This decision refines the Issue #43 research direction without changing the stable OCAE product by itself.

## Why this boundary exists

The OpenCode host already provides the project/worktree context and the operational tool surface used by OCAE-managed agents. OCAE's canonical governance plugin receives host project/directory/worktree context and governs OpenCode tool calls such as read, grep, glob, lsp, write/edit, delegation, and external access.

OCAE also already has lightweight project discovery for policy purposes: language, framework, package manager, test framework, database, monorepo, Git remote, OpenCode assets, and other project signals. That discovery is intentionally shallow and deterministic. It is not a substitute for source-code intelligence.

Building another full source index inside OCAE would create duplicate sources of truth, additional invalidation/file-watching requirements, potential divergence from the OpenCode worktree, and unnecessary coupling to language/parser implementations.

## OpenCode responsibilities

Where the host exposes them sufficiently, OpenCode owns the mechanics of:

- current project/worktree identity;
- filesystem access;
- file enumeration and pattern matching;
- textual code search;
- reading and writing files;
- LSP/code-intelligence operations;
- model-facing tool invocation transport;
- host-native agent/tool grants;
- host-native context/session mechanics.

OCAE must treat these host capabilities as dependencies to qualify and govern, not features to duplicate.

## OCAE responsibilities

OCAE may decide **how** an authorized task should use the host mechanics. This includes:

- task classification;
- model selection through canonical routing policy;
- model-specific harness/profile resolution;
- deciding which already-granted OpenCode tools are exposed to the selected model;
- choosing an allowed discovery sequence such as `glob → grep → lsp → read`;
- bounding the number of files, symbols, matches, or tool results surfaced per step;
- deciding when task-local discovery should expand or stop;
- context ordering, compression, summarization, and refresh policy;
- model-specific planning granularity;
- bounded task decomposition;
- verifier/evidence requirements between steps;
- empirical measurement of which discovery/tool strategies work for a concrete model/runtime identity.

OCAE strategy may reduce or reshape an authorized surface but may never widen it.

## No repository-layout mandate

OCAE must not require target projects to adopt a canonical application folder layout merely to enable adaptive harnessing.

The target may use any legitimate structure, for example:

```text
packages/mobile/
server/
embedded/
qa/
```

instead of:

```text
src/
tests/
frontend/
backend/
```

OCAE may normalize such structures into policy-relevant signals or task-local interpretations, but the repository's actual architecture remains authoritative.

OCAE-managed product files may continue to use their own deterministic locations such as `.opencode/`, `.agent-governance/`, runtime, governance, test, and documentation paths.

## Task-local discovery model

Adaptive discovery should be incremental and use OpenCode-native primitives rather than pre-indexing the full repository.

Conceptual sequence:

```text
USER TASK
  ↓
OCAE task classification
  ↓
existing lightweight OCAE project discovery
  ↓
OpenCode host capability inventory
  ↓
model empirical capability profile
  ↓
OCAE discovery/context policy
  ↓
OpenCode glob/grep/lsp/read operations
  ↓
minimal task-local context
  ↓
model action
  ↓
verifier/evidence
  ↓
expand only when justified
```

A small/local model may therefore receive a much narrower search and context surface than a stronger model while both operate on the same OpenCode workspace.

## Empirical optimization targets

The qualification milestone may measure, among other things:

- success with `glob`, `grep`, `read`, and `lsp` combinations;
- optimal order of discovery primitives;
- optimal number of simultaneous search results;
- optimal number of relevant files/symbols presented at once;
- sensitivity to irrelevant files or tools;
- context and tool-result volume thresholds;
- whether one-tool-at-a-time operation improves reliability;
- whether bounded task decomposition improves verified completion;
- whether host-native code intelligence reduces context volume without reducing correctness.

These are model/harness operating-region measurements, not replacements for OpenCode capabilities.

## Host capability fingerprint

Causal evaluation should bind evidence to an OpenCode host capability identity/fingerprint where practical. It should capture non-secret facts that affect comparability, such as:

- OpenCode version/runtime identity;
- available native tool classes;
- whether LSP/code-intelligence is available for the fixture/task language;
- relevant tool-contract/version fingerprint;
- project/worktree fixture fingerprint.

The fingerprint must not contain credentials, secret paths, or private prompt content.

## Required invariants

```text
OPENCODE_OWNS_WORKSPACE_MECHANICS
OCAE_MUST_REUSE_HOST_CODE_INTELLIGENCE_WHERE_SUFFICIENT
OCAE_DISCOVERY_STRATEGY_IS_POLICY_NOT_AUTHORITY
OCAE_DISCOVERY_STRATEGY_CANNOT_EXPAND_SCOPE
OCAE_MAY_HIDE_BUT_MUST_NOT_GRANT_TOOLS
TARGET_REPOSITORY_LAYOUT_IS_NOT_PRESCRIBED_BY_OCAE
NO_PARALLEL_FULL_REPOSITORY_INDEX_WITHOUT_EVIDENCED_HOST_GAP
HOST_GAP_REQUIRES_SEPARATE_REQUIREMENT_AND_AUTHORIZATION
```

## Fail-closed cases

The research implementation must fail closed or fall back safely when:

- a candidate discovery strategy requests an ungranted tool;
- a strategy assumes LSP/code intelligence that is unavailable;
- host capability identity no longer matches the evidence used to derive the candidate;
- task-local expansion would cross authorized project/scope boundaries;
- a candidate attempts to infer new requirements from repository contents;
- stale workspace evidence is treated as current without revalidation.

Unknown or unqualified conditions must retain the safe generic behavior rather than silently activating an experimental strategy.

## Future exception process

A future OCAE-owned index/code-intelligence subsystem is not categorically forbidden, but it requires all of the following before implementation:

1. a concrete OpenCode host capability gap is demonstrated with reproducible evidence;
2. the missing capability materially blocks an authorized OCAE requirement;
3. reuse/extension of the OpenCode host has been evaluated first;
4. a separate issue/spec authorizes the additional subsystem;
5. ownership, invalidation, security, performance, and rollback contracts are defined;
6. the subsystem is proven to add value without creating a competing source of truth.

Absent that evidence, the default decision is to reuse OpenCode.
