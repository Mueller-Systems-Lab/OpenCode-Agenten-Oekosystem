# Hierarchical Model-Specific Harness Foundation Plan

Source: issue #33 task capsule · Spec:
`docs/specs/ocae-hierarchical-model-harness-foundation.md` · Baseline:
`86528ca593dae26d0570ac31f0cb4946e988179e` · Risk tier: `HIGH_HUMAN_GATE`.

## Implementation Tasks

1. Spec, plan, ADR, architecture doc (this document set) — before code.
2. `runtime/harness/model-harness-contract.mjs` — contract id/version,
   statuses, task roles, policy keys, fail-closed forbidden keys, validators,
   frozen profile factory.
3. `runtime/harness/model-harness-profiles.mjs` — declarative frozen registry
   (`generic.v1` active; `hy3.v1`, `muse.v1`, `nemotron.v1` candidates),
   `findProfileForModel`, `getProfile`.
4. `runtime/harness/task-role-profiles.mjs` — frozen role overlays for
   PLAN/BUILD/REVIEW/RESEARCH/TOOL_USE.
5. `runtime/harness/harness-resolver.mjs` — identity normalization,
   deterministic L0/L1/L2 composition, generic fallback, sha256 fingerprint,
   `worker_self_selection` denial.
6. `runtime/harness/apply-harness.mjs` — `composeWorkerTaskText`,
   `applyToolExposure` (hide-only), `harnessEvidenceFields`.
7. `runtime/harness/index.mjs` — barrel exports.
8. `runtime/routing/model-catalog.mjs` — additive: provider `opencode`
   inventory entry + 5 free-tier entries (`configured`), CATALOG_VERSION
   `1.2.0`; existing entries and `DEFAULT_ROUTING_POLICY.allowed_providers`
   unchanged.
9. `runtime/run.mjs` — additive wiring after `routeSelectedEvent`:
   `resolveModelHarness`, freeze route with `harness`, emit
   `model.harness.resolved`; `CONTRACT_INVALID` → BLOCKED
   `HARNESS_CONTRACT_INVALID`.
10. `scripts/lib/production-sentinel.mjs` — 5 new invariants + structural
    checks; `runtime/production-baseline.json` updated (invariants list +
    recomputed fingerprint + required artifacts + milestone entry).
11. `test/harness/*` — 7 deterministic test files, registered in
    `test/test-manifest.json` group `unit`.

## File List

Created:

- `docs/specs/ocae-hierarchical-model-harness-foundation.md`
- `docs/plans/hierarchical-model-harness-foundation-plan.md`
- `docs/adr/ADR-hierarchical-model-harness-foundation.md`
- `docs/architecture/hierarchical-model-harness.md`
- `runtime/harness/model-harness-contract.mjs`
- `runtime/harness/model-harness-profiles.mjs`
- `runtime/harness/task-role-profiles.mjs`
- `runtime/harness/harness-resolver.mjs`
- `runtime/harness/apply-harness.mjs`
- `runtime/harness/index.mjs`
- `test/harness/resolver.test.mjs`
- `test/harness/composition.test.mjs`
- `test/harness/fingerprint.test.mjs`
- `test/harness/authority.test.mjs`
- `test/harness/generic-fallback.test.mjs`
- `test/harness/apply.test.mjs`
- `test/harness/runtime-wiring.test.mjs`

Modified (additive only):

- `runtime/routing/model-catalog.mjs`
- `runtime/run.mjs`
- `scripts/lib/production-sentinel.mjs`
- `runtime/production-baseline.json`
- `test/test-manifest.json`

## Test Matrix

| Test file | Covers |
|---|---|
| resolver.test.mjs | determinism (5 repeats deep-equal), unknown→fallback, candidate gating, exact mapping, normalize forms |
| composition.test.mjs | L2>L1>L0 merge, task_role_overrides scoping, forbidden-key absence, core marker |
| fingerprint.test.mjs | stability, sensitivity (verbosity/exposure/granularity/mitigation), role sensitivity, no timestamps |
| authority.test.mjs | self-selection denial, forbidden keys (validate fail + create throw), SECURITY_VIOLATION on add-attempt, hide-only, input immutability |
| generic-fallback.test.mjs | safe harness for unknown model, composable task text, evidence fields |
| apply.test.mjs | deterministic composition, instruction order, STRICT anchoring, EXPLICIT boundaries, FULL/MINIMAL exposure |
| runtime-wiring.test.mjs | runTask event `model.harness.resolved` + fingerprint, route.harness, DENIED event, routing unchanged without harness |

## Evaluation Design (follow-up milestone, fixed here)

- Corpus: 5 cases (isolated bugfix, multi-file change, structured-output
  exactness, tool-minimal artifact task, controlled retry).
- Arms: generic (baseline) vs model profile with `allow_candidate: true`.
- Repetitions: 2 per case per arm.
- Models: ≥2 free opencode-provider models (hy3-free,
  muse-spark-1.2-contributor-free, nemotron-3-ultra-free pool).
- Budget: `PAID_MODEL_CALLS=0` — free-tier models only, local opencode
  runtime auth.
- Evidence: `evidence/model-harness-evaluation-<ts>/` with per-run events,
  fingerprints, verification outcomes; no secrets, no PII.
- Catalog effect: entries flip `configured → reachable` only in the change
  that carries the probe evidence.

## Promotion Application Procedure

1. Evaluation report completed under `evidence/model-harness-evaluation-*/`
   with corpus, arms, repetitions, models, and verified-success comparison.
2. Check the four promotion conditions (NO_CORE_REGRESSION,
   NO_SECURITY_REGRESSION, NO_SIGNIFICANT_VERIFIED_SUCCESS_REGRESSION,
   MEASURABLE_MODEL_SPECIFIC_VALUE) against the report.
3. On pass: flip the profile status `candidate → promoted` in
   `model-harness-profiles.mjs`, set `evidence_metadata.value_proven: true`
   and `evidence_path` to the evaluation directory, bump
   `MODEL_HARNESS_REGISTRY_VERSION` minor, update the architecture doc
   registry table, add regression tests pinning the promoted status.
4. On fail: set status `rejected` with the evidence path, keep generic
   fallback behavior unchanged.

## Rollback

- Feature branch rollback: delete `feature/hierarchical-model-harness-foundation`
  before merge, or `git revert` the merge commit after merge (no history
  rewrite, no force-push).
- Runtime rollback: all changes are additive; reverting `runtime/run.mjs`
  restores pre-harness routing behavior exactly.
- Catalog rollback: remove the 5 `opencode` entries and the provider
  inventory line; `DEFAULT_ROUTING_POLICY` is untouched throughout.

## Verification Commands

- `node --check` on every new/modified `.mjs` file
- `npm test` (full suite)
- `node scripts/validate-ecosystem.mjs`
