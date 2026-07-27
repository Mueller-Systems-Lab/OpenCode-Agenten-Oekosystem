# Implementation Plan: Unified Lifecycle

## Scope boundary

The implementation is limited to new lifecycle modules, schemas, test fixtures
and tests, targeted installer integration, the test manifest, and the listed
documentation. It does not modify `.opencode/policies/`, `.github/`, global
runtime configuration, or the original worktree.

## Work packages

1. Define lifecycle modes, substatus mapping, proof and registry contracts.
2. Add schemas, pure validators, hashing/redaction, and lock-safe local storage.
3. Add red tests for mode detection, proof aggregation, registry corruption and
   concurrency, CLI output, and runtime adapter controls.
4. Implement the `ocae` command as a thin orchestrator around the two existing
   installers. Legacy commands remain untouched except for safe integration
   exports where necessary.
5. Implement proof collection and isolated adapters. A real runtime is an
   optional capability with evidence and an operator plan when unavailable.
6. Update manifests, validation, guides, architecture, and troubleshooting.
7. Execute focused tests, adversarial tests, a path-with-spaces run, a fresh
   clone, isolated runtime tests, and two independent complete test runs.

## Migration

Existing targets are discovered before any write. An overlay-only target is not
assumed to have Governance V2; a Governance-only target is not assumed to have
overlay ownership. The new registry is opt-in and never relocates existing
manifests. Rollback delegates to the backup manifest printed by the original
installer and preserves later owner changes.

## Rollback

Code changes are reversible by a normal revert commit after a later commit gate.
Target rollback continues to use `bootstrap-project.mjs --rollback` or
`install-governance.mjs --rollback`; `ocae rollback` only selects/delegates to
those existing paths. Registry removal is entry-only and never removes target
governance files.
