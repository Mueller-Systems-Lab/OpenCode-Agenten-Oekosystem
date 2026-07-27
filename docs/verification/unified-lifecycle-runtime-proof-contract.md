# Verification Contract: Unified Lifecycle

## Desired behavior

The repository exposes one deterministic local lifecycle command that reuses
the existing installers, maintains safe ownership/provenance semantics, and
returns a precise, machine-readable runtime activation result.

## Acceptance criteria

- Lifecycle and registry commands have help, JSON output, stable exit codes,
  path validation, and no hidden global state.
- The runtime proof schema validates all activation fields and cannot represent
  incomplete evidence as restart-persistent verification.
- Safe, forbidden, path-escape, secret, approval, receipt, and replay controls
  are independently represented and tested.
- Registry lock contention and malformed input are fail-closed; portable export
  removes local absolute paths.
- Legacy installer dry-run/apply/rollback contracts remain green.

## Red tests

- lifecycle mode detection and update eligibility
- proof classification when required controls are absent
- registry schema, local-reference redaction, and concurrent locking
- CLI help, JSON, and invalid-path exit contracts
- isolated OpenCode and Hermes adapter-contract allow/block/replay controls;
  neither contract test claims that a real runtime process loaded the hook

## Regression tests

The canonical test runner, bootstrap, installer, rollback, approval, runtime
adapter, redaction, sandbox, and validator suites must remain green.

## Reality gate and evidence

- current red and green test output with exit codes
- JSON schema validation and source-lock/hash assertions
- `git diff --check`, diff review, and original-worktree comparison
- fresh-clone and spaced-path evidence
- isolated-runtime and real-runtime evidence explicitly classified by scope

## Untestable assumptions

No production runtime is started or restarted. A user runtime whose protocol
cannot be observed safely is reported as `TOOL_GAP` with an operator procedure.
