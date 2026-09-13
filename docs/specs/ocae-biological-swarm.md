# OCAE Biological Swarm Coordination

## Goal

Add deterministic coordination primitives to the existing Minimal Blackboard
Swarm without adding a datastore, daemon, peer-authority channel, or literal
animal simulation.

## Scope

- append-only signals with optional TTL and deterministic effective priority;
- independent, authorized quorum votes with fail-closed stale handling;
- temporary inhibition and capability-based worker matching;
- bounded read-only scout facts/signals;
- additive SQLite migration and observer fields;
- portable OpenCode adapter documentation and focused tests.

The existing `tasks`, `claims`, `facts`, `results`, `gates`, and `events` tables
remain authoritative. New logical records are additive tables and events.

## Authority boundary

Signals, votes, scout facts, inhibition, and capability observations are data.
None grants permissions, widens scope, bypasses preflight or deterministic
gates, authorizes GitHub operations, or authorizes merge.

## Acceptance criteria

1. Active signals affect ordering only; expired signals do not.
2. Inhibition is a temporary routing penalty and expires deterministically.
3. Quorum requires distinct authorized voters, excludes the implementation
   worker, rejects stale votes, and never overrides a failed gate.
4. Scouts can publish facts/signals but cannot mutate source or complete an
   implementation task.
5. Matching is deterministic over required capabilities, registered worker
   capabilities, active inhibition, and stable tie-break order.
6. Old databases migrate without data loss; durable evidence is retained.
7. `watch` and `snapshot` expose signal, quorum, inhibition, and scout data.
8. Existing tests remain green and focused biological tests exercise each
   security boundary.

## Verification contract

- Red tests: focused Python/CLI tests for quorum, TTL, inhibition, matching,
  scout restrictions, migration, and authority boundaries.
- Regression tests: existing Node test manifest plus installer/adapter tests.
- Evidence: command output, SQLite read-back, diff stat, and (only if the
  environment provides a headed browser and authenticated GitHub workflow)
  release and bare-URL runtime evidence.
- Untestable here: GitHub issue comments, merge, stable release publication,
  and a fresh unrelated OpenCode bare-URL handoff because the visible browser
  provider and GitHub API authentication are unavailable in this runtime.
