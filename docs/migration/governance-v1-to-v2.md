# Governance V1 → V2 Migration

1. Load `PROMPT-KERNEL.md` as the only permanent prompt context.
2. Generate and verify policy artifacts with `node scripts/generate-governance.mjs` and `node scripts/check-governance-drift.mjs`.
3. Convert owner goals into an Intent Contract and each task into a Task Capsule.
4. Replace Non-Touch checks with read/write/forbidden/external scopes.
5. Classify concrete effects before tool execution; treat unknown effects as fail-closed.
6. Replace repeated action approvals with a signed Approval Receipt or Change Lease. Revoke by receipt ID in the local receipt store.
7. Report new outcomes as `VERIFIED_IN_SCOPE`; accept `GREEN_SAFE` only as a legacy input alias.

Existing V1 receipts and phase approvals are not automatically promoted to V2 authorization because they lack the required effect/resource binding. Existing V1 runtime files remain for compatibility until a later, separately verified installer migration.
