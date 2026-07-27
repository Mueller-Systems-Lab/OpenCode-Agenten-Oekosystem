# ADR-008: Local Lifecycle Orchestrator Wraps Existing Installers

**Status:** Accepted for Issue #16 implementation
**Date:** 2026-07-26

## Context

The overlay bootstrap and Governance V2 installer have different artifacts,
reports, and lifecycle commands. Reimplementing either would duplicate path,
backup, provenance, and ownership logic.

## Decision

Add `scripts/ocae.mjs` and pure lifecycle modules. The command discovers the
target state and delegates to existing scripts through explicit, recorded
operations. It does not replace the legacy entrypoints and does not write a
global registry.

## Alternatives

- Rewrite both installers: rejected because it duplicates security-critical
  write logic.
- Keep documentation-only guidance: rejected because state selection remains
  ambiguous and untestable.
- Add a local wrapper: chosen because it gives one entrypoint while retaining
  tested installers as artifact owners.

## Consequences

The orchestrator must preserve subprocess output boundaries and map legacy
classifications conservatively. It introduces a small command surface but no
new dependency or service.
