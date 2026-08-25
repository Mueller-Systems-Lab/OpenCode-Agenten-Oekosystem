# Issue #33 Evaluation Harness — Local Run Specification

## Goal

Provide a deterministic, causal A/B harness over the canonical OCAE runtime for
comparing the generic harness with a candidate model profile. The harness must
produce auditable paired records and must never turn evaluation into production
routing or permit paid fallback.

## Scope

- Frozen 5-case corpus, corpus fingerprint, and precomputed interleaved plan.
- Generic-vs-candidate arms using the existing `resolveModelHarness`,
  `composeWorkerTaskText`, and canonical `runTask` seam. Fixture execution is
  explicitly marked and cannot be used in live mode. Live provider execution
  requires the explicit `ecosystem.provider-executor.v1` contract with
  `canonicalProviderExecutor: true` and connector metadata; arbitrary callbacks
  are `CONTRACT_INVALID`.
- Bounded call/row budgets and per-call AbortSignal timeouts; non-cancellable
  calls are retained as `TIMEOUT` rather than described as a hard wall-clock
  cutoff. Deterministic verifiers,
  metrics, paired comparison, and predeclared promotion decisions.
- Fixture worker tests only for deterministic infrastructure validation; live
  probes are optional and are not simulated when unavailable.

Out of scope: routing, retry, controller, security, scope, worker, profile, or
resolver redesign; paid providers; automatic candidate promotion; MCP/config
changes; volatile evidence or memory paths.

## Acceptance Criteria

1. The corpus and plan have stable versions/fingerprints and 4–8 supported-role
   cases.
2. Every planned row records model, case, repetition, arm, profile/fingerprint,
   runtime identifiers, outcome, verifier result, latency, failure, and cost
   tier; rows are retained on errors and rate limits.
3. Paired runs share model/case/repetition and differ only in harness profile;
   route, permissions, and granted tools remain unchanged.
4. Paid calls/fallback are retained as observed, classified as
   `FORBIDDEN_EFFECT`, and reject promotion. Timeouts retain rows.
5. Metrics and paired comparisons are deterministic, and promotion logic is
   frozen for decisions A–E. Decision A additionally requires explicit
   `LIVE_ATTEMPTED` status, canonical execution/provenance on every row, no
   `TOOL_GAP` or `PROVIDER_MISMATCH`, and complete pairs; fixture and incomplete
   live evidence fail closed. A marked provider executor must have metadata
   matching each requested provider/model at execution time; mismatches are
   retained failures and cannot promote.
6. Fixture tests prove planning, execution, verifier integration, comparison,
   failures, invariants, and all promotion decisions.
7. Promotion recomputes metrics and paired comparison, requires exact one-to-one
   plan mapping, stable harness fingerprints, canonical provenance, and a real
   `run_id` on every live row; forged or inconsistent evaluation objects fail
   closed. Live rows must also retain the module-private identity binding made
   when the canonical adapter constructs them. Relabelling public fields on a
   fixture row is therefore insufficient.

## Verification Contract

### Desired Behavior

The harness executes a bounded, paired generic/candidate experiment through the
canonical runtime seams and emits reproducible evidence without claiming live
model results that were not obtained.

### Red Tests

- `test/harness/evaluation.test.mjs` initially fails until the corpus, plan,
  runner, metrics, and promotion evaluator exist.
- `test/harness/manifest-completeness.test.mjs` initially fails if a valid core
  test is outside the canonical manifest.
- `test/governance/scope-authority-invariant.test.mjs` currently exposes a stale
  assertion: its “valid context” uses an explicit mobile requirement while
  asserting `responsive_core` is unauthorized.

### Regression Tests

All existing harness, routing, controller, security, governance, sentinel, and
canonical all-test groups remain required. `npm test` is the canonical command.

### Reality Gate

Run the fixture evaluation and canonical tests locally. Probe free-model
connectors immediately before any live run. If unavailable, record `TOOL_GAP`;
never substitute fixture output for live evidence.

### Evidence Types

| Evidence | Source | Collection |
|---|---|---|
| TAP test output | Node test runner | `node --test`, `npm test`, canonical all-test runner |
| Deterministic evaluation records | fixture runner | in-memory test assertions and optional stable evidence report |
| Diff/stat | Git | `git diff --stat`, changed-file list |
| Live availability | connector probe | exact probe output, if capability exists |

### Untestable Assumptions

| Assumption | Why untestable here | Risk |
|---|---|---|
| External free-model availability | Credentials/connectors are environment-specific | Live series may be `TOOL_GAP` |
| Model quality beyond fixture verifier | Requires real provider responses | No promotion without real evidence |

### Frozen Promotion Policy

Promotion policy `issue-33-promotion.v2` is frozen in code/tests and never
automatic. Decision A (`PROMOTE`) first requires genuine canonical live
evidence: `live_status: LIVE_ATTEMPTED`, canonical execution/provenance on
every row, no `TOOL_GAP`, and complete pairs. It then requires no core/security
regression, success preserved, at least 2 complete paired samples, and a
candidate-minus-generic verified-success effect of at least `0.10` on the
configured hypothesis dimension. Fixture output, `TOOL_GAP`, and synthetic
metrics are never sufficient. Decision B (`REJECT_NO_VALUE`) lacks that
measurable value; C (`REJECT_REGRESSION`) fails verified success; D
(`REJECT_INCOMPLETE`) has missing/failed budget invariants or forbidden
effects; E (`BLOCKED_NO_LIVE_EVIDENCE`) is used when live capability is
unavailable or canonical live evidence is not genuine.

### Provenance and persistence limits

Canonical provenance is bound with process-private `WeakSet`/`WeakMap` state at
record construction. It is intentionally not represented by mutable JSON
fields: copying, spreading, serializing, or relabelling a fixture record cannot
recreate the binding. This protects the in-process promotion decision, but it
is not a signature, durable receipt, or proof that a provider returned a real
model response. A marked connector/runTask seam can consequently pass
structural integrity while promotion remains `E_BLOCKED_NO_LIVE_EVIDENCE`.
Only an explicitly supplied live-model evidence receipt, together with the
canonical binding, can satisfy the promotion gate. Persistence, cross-process
attestation, and independent provider truth verification remain out of scope
and must not be inferred from these records.

### Plan

1. Close the manifest/governance defect with a regression contract.
2. Add frozen corpus, plan, runner, metrics, and promotion modules.
3. Add deterministic fixture tests and register them as CORE_REQUIRED unit tests.
4. Run deterministic checks, then probe live capability and record `TOOL_GAP` or
   real evidence without tuning profiles.
5. Run canonical test paths and write the local completion report.
