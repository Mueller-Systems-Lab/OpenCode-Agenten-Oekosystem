# Governance V2 Secret Isolation Plan

## Implementation Tasks

1. Add the schema-validated bootstrap security profile and V2 result schemas.
2. Add secret classification, canonical path resolution, symlink/hardlink
   handling, and safe metadata/content inspection.
3. Add actor-attributed audit storage with publishable redaction.
4. Add the central egress gate for all model-visible tool results.
5. Add typed lifecycle state and structured denial/recovery behavior.
6. Add the local authenticated MCP broker exposing only bootstrap tools.
7. Add Bubblewrap argument construction for model and deterministic action
   sandboxes, including secret masks, clean environment, hidden `.git`, and
   resource scopes.
8. Add the secure OpenCode launcher and isolated configuration.
9. Route bootstrap JSON statuses to V2-only classifications and retain
   `GREEN_SAFE` solely as a deprecated input alias.
10. Add unit, contract, deterministic bypass, positive runtime, and
    adversarial provider tests.
11. Run security before compliance review, both full suites, validators,
    idempotence, rollback, security scan, remote fresh clone, and remote-head
    AI E2E.
12. Commit, push normally, update Draft PR #12, and leave merge/deployment
    disabled.

## Rollback

- Code rollback: revert the closure commits without rewriting history.
- Runtime rollback: the secure controller uses the existing installer backup
  manifest and typed rollback action.
- Test target rollback: discard only temporary test projects.
- Remote rollback: no force-push; use a new revert commit if required.

## Known Uncertainties

- The free OpenCode provider must be revalidated inside the isolated model
  namespace without host credentials.
- Bubblewrap provider networking is host-networked because the model requires
  outbound access; target and deterministic action namespaces remain isolated
  from provider credentials and target secrets.
- The prior external provider may have received the test sentinel tool result;
  this is treated as a test-data boundary incident, not a production credential
  exposure.
