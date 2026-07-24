# Open PR Compatibility Report

## PR #8 — Model Assurance

PR #8 is an open draft based on PR #7 commit `4f36ab5`, not the current master base. Its evaluator, model registry, hard gates, fake models, and declared-but-unimplemented shadow/full modes are not changed by this branch. The compatibility boundary is additive: Governance V2 exposes `VERIFIED_IN_SCOPE` and effect-based authorization, while PR #8's `GREEN_ELIGIBLE` model-assurance classifications remain isolated until retargeting and revalidation.

## PR #11 — Governed frontend design skills

PR #11 is open and currently non-draft; it adds frontend design skills, an agent, and validation tests on base `fe91a867…`. This branch does not modify its remote branch. The new prompt kernel and executor/coordinator roles preserve the PR's read-only UX reviewer boundary and keep frontend-specific policies lazy-loaded. It should be retested against the V2 prompt-injection and capability checks before merge.

Compatibility status: additive files only in this branch; no merge, retarget, comment, or remote branch mutation was performed.
