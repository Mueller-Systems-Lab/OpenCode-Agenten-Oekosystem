# Migration: Canonical User Action Handoff

## Applies to

This migration applies to report producers, lifecycle consumers, bootstrap
templates, OpenCode prompts, Hermes handoffs, and machine-readable
`final-status` evidence.

## Producer migration

1. Replace free-form required owner tasks with an `actions` array conforming to
   `governance/user-action-handoff.schema.json`.
2. Select a controlled `reason_code`; prose alone is invalid.
3. Record the concrete effect and the completed capability, authentication,
   permission, authorization, alternative-tool, suitable-agent, and
   non-delegability checks.
4. Reject the handoff when the effect is already executed or an authorized
   capability can perform it.
5. Use `github_web` and concrete visible controls for GitHub actions.
6. Render with `renderUserActionHandoff` or append with
   `appendUserActionHandoff`; do not build the terminal section manually.

When no required action remains, producers must emit an empty `actions` array.
The renderer then produces exactly:

```markdown
## Erforderliche Aktion durch den Nutzer

Keine Aktion durch den Nutzer erforderlich.
```

## Consumer compatibility

`owner_actions` remains readable on legacy lifecycle results during the
transition. It is not sufficient evidence for a new user action. Registry
entries with non-empty `owner_actions` and no canonical handoff fail validation
so they can be reviewed instead of being silently upgraded.

Machine-readable `final-status` evidence now requires
`user_action_handoff`. `createClosureEvidence` supplies the canonical empty
state when callers do not pass one, preserving source compatibility for callers
that use the constructor.

## Validation and rollback

Validate structured and rendered artifacts with:

```text
node scripts/validate-user-action-handoff.mjs --input handoff.json --markdown report.md
```

Validate repository-wide parity with:

```text
node scripts/validate-ecosystem.mjs
```

Rollback is a code rollback of the producer and schema changes. Do not convert
structured evidence back into free-form tasks automatically; that discards the
capability and authorization proof.
