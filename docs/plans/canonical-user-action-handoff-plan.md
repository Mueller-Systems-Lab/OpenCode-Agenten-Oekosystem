# Plan — Canonical User Action Handoff Contract

## Technical Context

- Runtime: Node.js 22, dependency-free ESM, `node:test`
- Canonical source: `governance/policy-core.yaml` plus a new JSON Schema
- Generated truth: `scripts/generate-governance.mjs`
- Reporting: `scripts/lib/report.mjs`
- Bootstrap: `scripts/bootstrap-project.mjs`
- Hermes: `scripts/lib/hermes.mjs` and the canonical YAML skill bundle
- Completion JSON: closure-evidence schema/runtime
- Test runner: `scripts/run-tests.mjs` and `test/test-manifest.json`

## Architecture

1. Add the policy-level contract and schema reference to Governance V2.
2. Add one runtime module that owns constants, normalization, validation,
   capability-first admissibility, deterministic rendering, and markdown
   validation.
3. Make report producers call that module; do not copy renderer logic.
4. Require structured handoff in final-status machine evidence.
5. Copy the canonical schema into bootstrap targets from its source path and
   inject concise contract references into generated OpenCode/Hermes surfaces.
6. Add structural drift validation to the ecosystem validator.

## Data Flow

`observed capabilities + requested effect + authorization context`
→ `structured action candidate`
→ `fail-closed validation`
→ `deduplicate/sort`
→ `redact`
→ `Markdown final section + machine-readable handoff`
→ `post-render validation`.

## Dependency and Coupling Analysis

- The new module imports only the existing redaction module.
- `report.mjs`, closure evidence, and lifecycle output consume the new module.
- The bootstrap copies the canonical schema; it does not own a duplicate.
- Governance generation remains JSON-compatible YAML with no new parser.
- Existing legacy `owner_actions` fields remain readable during migration but
  cannot be treated as canonical output.

## Alternatives

1. **Prompt-only rule:** rejected; no executable validation or machine parity.
2. **Duplicate text in every prompt:** rejected; drift-prone.
3. **Schema only:** rejected; no deterministic rendering or false-delegation
   prevention.
4. **External validation dependency:** rejected; unnecessary network and supply
   chain surface.
5. **Canonical schema + runtime module + derived injection:** selected.

## Security Review Before Compliance

- Treat all structured input as untrusted.
- Reject additional properties and unknown reason codes.
- Require explicit evidence rather than truthy free text.
- Redact with the existing secret/PII boundary before output.
- Reject portable absolute home paths.
- Never execute web steps or CLI text from report data.
- No real GitHub mutations in test paths.

No vulnerability severity claim is made.

## Compliance / Privacy Screening

The feature processes technical capability metadata and report text only. It
does not introduce new personal-data collection, telemetry, retention, or
external transmission. Usernames, tokens, credentials, and local absolute paths
are excluded/redacted. No DSGVO compliance claim is made.

## Migration

- Add structured `user_action_handoff` without silently converting arbitrary
  legacy text.
- Keep legacy `owner_actions` temporarily for input compatibility.
- Report producers emit the structured contract immediately.
- Document that consumers must stop treating recommendations or `owner_actions`
  strings as required actions.

## Rollback

Revert only the feature commits on
`feat/canonical-user-action-handoff-contract`. No database, deployment, remote
CI, global configuration, or Issue-#16 branch rollback is involved.
