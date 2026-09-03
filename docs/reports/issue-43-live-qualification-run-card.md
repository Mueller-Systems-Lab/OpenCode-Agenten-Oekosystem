# Issue #43 — First Live Qualification Run Card

Status: implementation blocker identified; live run pending the minimal executor seam.

## Goal of the run

Run the first controlled live empirical qualification and causal A/B comparison
of `generic.v1` versus the existing deterministic `muse.v1` candidate against
one currently reachable, zero-cost hosted model.

## Why necessary

The existing Issue #43 qualification contracts freeze corpora and derive
candidates but only accept deterministic fixture executors. That prevents a
truthful live answer to whether the adaptive harness adds verified value.

## Risk Tier

MEDIUM_REVIEW — external hosted model calls are authorized only through the
existing OpenCode free transport; no repository production behavior is changed.

## Context Level

HOT — Issue #43, PR #44, current branch, runtime, catalog, and gates were
refreshed immediately before this run.

## Source of Truth

GitHub Issue #43 and the local runtime/qualification contracts.

## Scope

- development-only live qualification executor/runner seam;
- one contract/regression test for live executor authorization and identity;
- this report and the generated non-secret live evidence.

## Out of Scope

- production routing or promotion;
- changes to `generic.v1`, candidate policy, corpus cases, verifier rules,
  permissions, provider fallback, or model switching;
- paid, DeepSeek, local-model, or alternate-provider calls.

## Hard Constraints

- exact provider/model match for both arms;
- `MODEL_SWITCHING_PRIMARY_AB=DISABLED` and provider fallback disabled;
- zero paid calls and no fallback;
- fixed grants, timeout/retry budgets, fixtures, order, and verifier;
- raw observations remain authoritative and untrusted tool content remains data;
- all failed rows are retained.

## Non-Touch Areas

Production runtime policy, installed payloads, canonical model routing, secrets,
credentials, and historical reports.

## Involved Agents

Primary Codex agent; deterministic repository tests and the canonical OpenCode
CLI free transport. No delegated agent is required.

## Verification Contract

### Desired Behavior

The development runner executes the frozen qualification plan against one exact
live OpenCode provider/model, records paired generic/candidate observations and
verifier-backed metrics, and fails closed on identity/cost/fallback mismatch.

### Acceptance Criteria

1. The live executor is accepted only with canonical-live marking and exact
   provider/model metadata.
2. Both arms use the same frozen corpus, model, grants, verifier, timeout, and
   disabled fallback/switching settings.
3. Every row retains raw-observation receipt metadata, model-facing adaptation
   metadata, verifier outcome, failure class, and measured volumes/latency.
4. Derivation and independent holdout results are paired and reported with raw
   counts; no promotion occurs automatically.
5. Targeted and canonical repository gates pass.

### Red Tests

The existing runner-contract tests are the regression baseline. The new live
executor contract test is the blocker-specific test and must fail if the seam
accepts an unmarked or mismatched provider executor.

### Regression Tests

`test/harness/empirical-capability.test.mjs`, `test/harness/evaluation.test.mjs`,
the canonical aggregate, architecture sentinel, security review, governance
drift, secret scan, and `git diff --check`.

### Reality Gate

Fresh OpenCode preflight and a real tool-use probe, followed by the frozen live
derivation and holdout run against the selected free model.

### Evidence Types

| Evidence | Source | Collection |
|---|---|---|
| Provider reachability | OpenCode health probe | exact model override, zero-cost output |
| Tool capability | isolated OpenCode fixture | read/write/verification events |
| A/B outcome | live runner JSON | per-row records and paired metrics |
| Repository integrity | local gates | test and static-check output |

### Untestable Assumptions

| Assumption | Why untestable here | Risk |
|---|---|---|
| Free transport availability remains stable for the run | provider state is external | incomplete evidence; classify honestly |
| Small sample estimates generalize | this is the first bounded experiment | no significance claim |

## Test Matrix

Targeted live-run contract tests, full canonical test suite, architecture
sentinel, security review, governance drift, secret scan, and diff check.

## Evidence Plan

Persist only non-secret identity, fingerprints, execution order, tool metadata,
verification results, bounded metrics, and failure classes under `docs/reports/`.

## Owner-Approval-Status

Live zero-cost hosted connector: APPROVED by the explicit Issue #43 task.
Production promotion: NOT_REQUESTED. Paid fallback: DENIED by task constraint.

## Rollback Strategy

The live seam and report are development-only. Revert the separately identified
live seam/test/report changes; delete only the generated report if requested.

## Expected Completion Classification

`GREEN_OCAE_LIVE_ADAPTIVE_HARNESS_VALUE_PROVEN`,
`GREEN_OCAE_LIVE_QUALIFICATION_PROVEN_NO_ADAPTIVE_VALUE`,
`AMBER_OCAE_LIVE_EVIDENCE_INSUFFICIENT`, or an explicit red/block classification
based on observed evidence.
