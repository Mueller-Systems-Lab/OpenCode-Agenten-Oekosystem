# ADR-009: Evidence-Graded Runtime Activation Proof

**Status:** Accepted for Issue #16 implementation
**Date:** 2026-07-26

## Context

Installed hook files, a CLI version check, and direct evaluator calls do not
prove that a runtime loaded a hook or that it blocked a real tool invocation.

## Decision

Use a schema-validated proof document with independent control fields and an
activation substatus. Adapter-host simulation, isolated test runtime, and real
runtime evidence are labeled separately. Only a successful restart-persistence
proof without critical bypasses maps to `VERIFIED_IN_SCOPE`.

## Alternatives

- Treat a hook file as active: rejected as a false claim.
- Treat a direct evaluator call as a runtime test: rejected because it bypasses
  the runtime dispatch path.
- Use a proof contract with evidence levels: chosen for fail-closed reporting.

## Consequences

Older structural evidence remains useful but becomes `HOOK_REGISTERED_UNPROVEN`.
Runtime versions without a safe observable hook path return `TOOL_GAP` and an
operator procedure rather than an inferred pass.
