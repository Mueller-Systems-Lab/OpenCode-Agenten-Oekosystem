# ADR: Existing-Installation Pre-Task Reconciliation at the Global Adapter Boundary

Status: Accepted

## Context

The project-local Governance V2 hook can be older than the globally installed
OCAE/OpenCode integration. In that state an ordinary first task reaches an old
hook before it has the current task-bootstrap runtime and is blocked with a
task-capsule error. The agent cannot repair the project because the same hook
blocks the required shell effects.

The actual old-installation reproduction uses source commit
`93a779a6fd7da32c937430191570bda2a83ffab4`; it has the old governance plugin,
but no task-bootstrap runtime, owner intent, or task capsule. The installed
global v1.0.2 adapter currently does not reconcile that state.

## Decision

Extend the already-installed global OCAE/OpenCode adapter with a pre-task
project runtime reconciliation step. The adapter captures and validates the
canonical OpenCode target root, reads only OCAE installation metadata, performs
a small version-marker fast-path check, and invokes the absolute hash-bound OCAE
CLI with structured argv and `shell=false` only when migration is required.

The canonical Node installer/update logic remains the sole mutation engine. The
adapter does not merge configuration or write project files. After update and
verify complete, the adapter runs the normal task-bootstrap path and preserves
the original top-level message.

The canonical installer writes a versioned `.agent-governance/runtime-state.json`
marker with a SHA-256 integrity binding. The marker is not an authorization
source; a malformed, stale, incompatible, tampered, or unsafe state fails
closed. Projects without OCAE are passed through for ordinary messages.

## Alternatives considered

### Option A — Chosen: global adapter pre-task reconciliation

Uses the existing trust boundary and OpenCode workspace context, avoids the old
local hook deadlock, keeps mutation authority centralized, and permits a fast
current-project path.

### Option B — Project-local self-migration hook

Rejected because the old hook is the deadlock source and cannot safely invoke
the newer migration path before its own task-capsule gate.

### Option C — LLM/shell-driven `ocae update`

Rejected because normal agent tool effects are precisely what the stale hook
blocks, and prompt/tool output must not control migration authority.

### Option D — A second global installer/mutator

Rejected because it duplicates the canonical installer, risks divergent merge
and backup semantics, and violates the mutation-authority ceiling.

## Consequences

Positive:

- old compatible projects self-heal before the first governed task;
- user prompts and local user changes are preserved;
- current projects take a minimal metadata fast path;
- no-OCAE projects are not auto-installed;
- migration, verification, and blocked outcomes are observable and precise.

Tradeoffs:

- the global adapter bundle and Python payload must be regenerated together;
- OpenCode plugin ordering and reload behavior require explicit runtime tests;
- a host-level compromise of the global trusted integration remains outside the
  project-local security boundary.
