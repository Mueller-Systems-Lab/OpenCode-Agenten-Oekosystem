# Unified Lifecycle, Runtime Activation Proof, and Local Registry

**Issue:** [#16](https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem/issues/16)
**Status:** Approved for local implementation
**Base:** `595df52e9bcc16e12c88f8fcada6ea71fd10934b`

## Goal

Provide one project-local CLI that inspects and orchestrates the existing
overlay and Governance V2 installers, records their state in an opt-in local
registry, and reports runtime activation only at the evidence level that has
actually been proved.

## In scope

- `ocae inspect|plan|install|update|verify|status|rollback`
- local registry operations: `register|update|verify|status|list|remove|export`
- JSON schemas and deterministic validation for runtime proofs, registry, and
  local run metrics
- isolated adapter-contract tests for OpenCode and Hermes, with an explicit
  distinction between adapter simulation, isolated runtime evidence, and
  real-user-runtime evidence
- fail-closed ownership, source-lock, path, symlink, and replay handling
- compatibility wrappers around `bootstrap-project.mjs` and
  `install-governance.mjs`; neither installer is removed

## Out of scope

- global configuration, user-home data, production runtimes, provider calls,
  remote CI, telemetry transfer, commits, pushes, PRs, and merges
- changing the OpenCode or Hermes upstream runtimes
- treating an evaluator invocation as a live runtime-hook proof

## User stories and acceptance criteria

1. An operator can run `node scripts/ocae.mjs inspect --target <project> --json`
   and receive the installation mode, provenance, integrity, runtime signals,
   conflicts, and exact non-success conditions without modifying the project.
2. `plan`, `install`, and `update` distinguish no installation, overlay-only,
   governance-only, and combined installations. Existing installers remain the
   only installers that write their respective artifacts.
3. A proof document records each activation claim separately: runtime discovery,
   adapter selection, hook registration, safe control, forbidden control, scope
   escape, secret isolation, approval, receipt, replay, restart, and bypass
   scan. Missing evidence never becomes `ACTIVATION_VERIFIED`.
4. A project is `VERIFIED_IN_SCOPE` only after integrity, both action controls,
   scope and approval controls, restart evidence (when required), and the
   bypass scan have all passed. The substatus remains visible.
5. Registry entries preserve portable identity separately from optional local
   machine references. Portable export contains no absolute path or secret-like
   values. `remove` removes an entry only.
6. A second equal operation produces `NOOP_IDEMPOTENT`; owner edits, untracked
   conflicts, special files, stale locks, and malformed records fail closed.

## Compatibility contract

`bootstrap-project.mjs`, `install-governance.mjs`, `bootstrap.mjs`, and their
documented flags remain supported. `ocae` is additive and becomes the
recommended repository-local lifecycle entrypoint. The lifecycle records
whether a target needs overlay installation, Governance V2 installation, or
both; it never silently deletes or replaces legacy artifacts.

## Non-goals for evidence

An isolated adapter invocation proves that a hook implementation has the
expected allow/block behavior, not that an end-user process loaded it. A real
OpenCode or Hermes process is marked separately and only when its own startup
and hook interaction are observed. Unsupported runtime protocol versions become
`TOOL_GAP`, never an inferred pass.
