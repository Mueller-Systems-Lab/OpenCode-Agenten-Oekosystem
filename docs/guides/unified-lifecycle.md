# Unified Lifecycle Guide

`scripts/ocae.mjs` is a repository-local lifecycle orchestrator. It keeps the
two established ownership boundaries: `bootstrap-project.mjs` manages the
legacy overlay, and `install-governance.mjs` manages Governance V2, provenance,
generated bridges, and its backup format.

```bash
node scripts/ocae.mjs inspect --target <project> --json
node scripts/ocae.mjs plan --target <project> --json
node scripts/ocae.mjs install --target <project> --json
node scripts/ocae.mjs update --target <project> --json
node scripts/ocae.mjs verify --target <project> --json
node scripts/ocae.mjs status --target <project> --json
node scripts/ocae.mjs rollback --target <project> --backup <backup-dir> --json
```

`inspect` differentiates `NOT_INSTALLED`, `OVERLAY_ONLY`, `GOVERNANCE_ONLY`,
and `BOTH_LAYERS`. `plan` is read-only. Install and update stop for path
escapes, symlinks, malformed manifests, locally modified managed files, or
unmanaged owner conflicts. The legacy commands remain usable when an operator
needs to operate one layer only.

The source lock's installed commit is compared with the checked-out lifecycle
source. `CURRENT`, `UPDATE_AVAILABLE`, and `UNAVAILABLE` remain provenance
facts; a source mismatch never authorizes a silent downgrade or an overwrite of
owner content. A second no-change Governance V2 apply is reported as
`NOOP_IDEMPOTENT` and does not add a redundant local metric record.

## Registry

The registry is an explicit local JSON file. It is not a service or a global
database.

```bash
node scripts/ocae.mjs register --target <project> --registry ./ocae-registry.json --json
node scripts/ocae.mjs update --target <project> --registry ./ocae-registry.json --json
node scripts/ocae.mjs verify --target <project> --registry ./ocae-registry.json --json
node scripts/ocae.mjs status --registry ./ocae-registry.json
node scripts/ocae.mjs list --registry ./ocae-registry.json --json
node scripts/ocae.mjs remove --registry ./ocae-registry.json --project-id <id> --json
node scripts/ocae.mjs export --registry ./ocae-registry.json --json
```

Entries separate portable project/provenance data from `local.target_reference`.
Portable export removes local references and local backup/evidence locations.
Concurrent updates use a short-lived local lock; malformed or symlinked registry
files fail closed. `register` is an upsert. Supplying `--registry` to lifecycle
`update` or `verify` refreshes the entry without changing the lifecycle result's
classification; `verify` records the last activation substatus separately.

## Runtime activation proof

The proof schema records each claim independently. It uses these activation
states: `NOT_INSTALLED`, `INSTALLED_UNVERIFIED`, `HOOK_REGISTERED_UNPROVEN`,
`ACTIVATION_VERIFIED`, `RESTART_PERSISTENCE_VERIFIED`, `BYPASS_RISK`,
`TOOL_GAP`, and `RED_BLOCK`.

`VERIFIED_IN_SCOPE` requires successful installation and integrity, runtime
detection, a registered hook, safe allow, forbidden block, scope-escape block,
secret isolation, required approval/receipt/replay controls, restart evidence
when in scope, and no critical bypass path. A static scan or an adapter
simulation alone cannot make that claim.

`--simulate` exercises the isolated adapter control contract without executing a
dangerous action. Its evidence scope is `adapter-simulation`; it is intentionally
insufficient for runtime activation and restart persistence. It returns
`SIMULATION_ONLY`, even when every synthetic control passes.

For OpenCode, the verified bridge file is `.opencode/plugin/governance-v2.ts`;
its presence is not itself a registration claim. The project configuration must reference that bridge, and a
compatible runtime must still invoke it before `HOOK_REGISTERED_UNPROVEN` can
advance to activation controls. If the runtime reads a global profile, cannot
expose plugin state, or cannot be restarted in a safe isolated scope, report the
path as `TOOL_GAP` rather than widening the test to a user runtime.

## Controlled operator procedure for a real runtime

Use a disposable project and a non-production runtime profile. Do not point this
procedure at a developer's global configuration or a running service.

1. Create a fresh disposable target, initialise only the project-local runtime
   configuration, and run `inspect`, `plan`, and `install`.
2. Start the runtime through its documented project-local launcher. Record the
   runtime version, effective project config, and hook/plugin registration using
   metadata only; do not include provider credentials or prompts.
3. Issue a read-only positive control such as `git status` through the runtime.
4. Submit the negative control `git push --force` only to the controlled test
   adapter or an isolated non-network remote. Record that execution was blocked
   before side effect.
5. Submit a target-root escape, synthetic `.env` read, approval-required action
   without receipt, valid narrow receipt, and consumed/expired/wrong-context
   receipt. Record booleans and evidence references, never fixture contents.
6. Stop that disposable runtime, start a new runtime process, and repeat the
   positive and negative controls. A module re-import does not count.
7. Run the launcher, direct-CLI, configuration, plugin, subprocess, shell, MCP,
   and direct-import bypass review. Any open critical path is `BYPASS_RISK` or
   `RED_BLOCK`; any unavailable safe observation path is `TOOL_GAP`.

## Local metrics

For an installed target, lifecycle operations write a local JSONL run metric by
default under `.agent-governance/evidence/`. It contains identifiers, timestamps,
action counts, classifications, and evidence paths only. It has no prompts,
secret values, complete tool output, personal data collection, or network
transmission. Use `--no-metrics` to disable it or `--metrics <path>` for a
project-local alternative.
