# Pull Request Draft — Canonical User Action Handoff

This document prepares the pull request without creating one. The current
governance requires a separate PR gate, and the implementation request did not
authorize that effect.

## Coordinates

- **Title:** `feat: enforce canonical user-action handoff in generated reports`
- **Head:** `feat/canonical-user-action-handoff-contract`
- **Base while Issue #16 remains unmerged:**
  `feat/unified-lifecycle-runtime-proof-v2`
- **Issue:** `#18`
- **Dependency:** Issue #16 / PR #17

## Body

Implements a canonical, machine-enforced German user-action handoff across
Governance V2, completion JSON, OpenCode prompts, Hermes bundles, bootstrap
outputs, lifecycle reports, and Spec-Kit completion surfaces.

### Included

- controlled reason codes and complete capability-first evidence;
- deterministic renderer and fail-closed structured/Markdown validators;
- GitHub web-only guidance with target, visible controls, confirmation order,
  and abort conditions;
- false-delegation rejection when an authorized tool, connector, or suitable
  agent exists;
- secret and portable-local-path redaction;
- OpenCode, Hermes, bootstrap, lifecycle, closure, registry, and installer
  parity;
- positive, negative, security, drift, integration, and fresh-clone evidence.

### Dependency and merge order

This is a stacked change on PR #17 until Issue #16 is merged. Do not target
`master` or merge this pull request before the dependency is integrated and the
base effect is reviewed again.

### Verification

- `npm test`
- `node scripts/validate-ecosystem.mjs`
- `node scripts/generate-governance.mjs --check`
- focused user-action handoff and security suites
- fresh remote clone of the exact pushed head

Closes #18 when merged.
