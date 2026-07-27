# ADR-010: Canonical User Action Handoff

**Status:** Accepted for Issue #18 implementation
**Date:** 2026-07-27

## Context

Completion surfaces used free-form owner actions and tool-gap prose. That made
it possible to delegate an effect merely because one CLI was missing, even
when another authenticated connector or a more suitable agent could perform
the same authorized effect. Markdown alone could not prevent that drift across
OpenCode, Hermes, bootstrap reports, lifecycle output, and closure evidence.

## Decision

Governance V2 owns one versioned `user_action_handoff` contract. JSON Schema
defines the portable data shape and controlled reason codes. The runtime
validator adds semantic checks that JSON Schema cannot express reliably:

- the concrete effect, available tools, authentication, permissions,
  authorization, alternative capabilities, suitable agents, and personal
  non-delegability are checked before delegation;
- an available and authorized capability rejects the user action;
- executed effects, recommendations, residual risks, and generic tool gaps are
  rejected;
- GitHub actions require `github_web`, a known target, visible controls,
  confirmation, and an abort condition;
- the deterministic renderer redacts secrets and portable local-user paths,
  sorts and deduplicates producer input, rejects noncanonical external ordering,
  and always emits the German terminal section.

Generated prompts and runtime-specific bundles reference the canonical
semantics. Machine-readable completion objects embed the same structure.
`scripts/validate-ecosystem.mjs` verifies cross-surface anchors, while
`scripts/validate-user-action-handoff.mjs` validates concrete JSON and Markdown
artifacts.

## Alternatives

- Prompt-only guidance was rejected because it is not executable enforcement.
- Independent OpenCode and Hermes formats were rejected because they permit
  semantic drift.
- A free-form `owner_actions` array was rejected as the canonical format because
  it cannot prove capability-first reasoning.
- Automatically converting every legacy owner action was rejected because
  missing evidence must fail closed.

## Consequences

New final-status evidence and generated reports carry
`ocae-user-action-handoff.1`. Empty lists remain explicit and deterministic.
The canonical array field is `actions`; every entry is constrained by
`source_category: non_delegable_user_action`.
Legacy `owner_actions` may remain as a compatibility display field, but a
non-empty legacy list without the canonical structure is not accepted as
completion evidence. GitHub UI labels record whether they were live checked,
derived from official documentation, or merely expected and not live checked.

No GitHub mutation is performed by rendering or validation. The contract does
not create authorization; it only records why an essential effect could not be
delegated.
