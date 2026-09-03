# Plan — Empirical Model Capability Qualification and Adaptive Harness Research

Issue: **#43**  
Depends on: **Issue #33 hierarchical model-harness foundation**  
Target classification: **GREEN_OCAE_EMPIRICAL_MODEL_CAPABILITY_QUALIFICATION_OPERATIONAL**

## Objective

Extend OCAE's existing model catalog and hierarchical harness with an evidence-driven qualification path for hosted free and local OpenAI-compatible models. The milestone must prove what a concrete model/runtime combination can reliably do, derive bounded candidate harness adaptations, and evaluate them causally against `generic.v1` without weakening canonical authority.

## Phase 0 — Reality refresh

Before implementation:

1. Record exact `master` head and stable release baseline.
2. Re-read Issue #33 final evidence and current harness/runtime contracts.
3. Inventory the current model catalog, routing policy, harness profile schema, tool exposure, evidence events, and retry/controller boundaries.
4. Confirm current OpenCode host capabilities and available zero-cost model/provider paths.
5. Detect a local OpenAI-compatible endpoint only when explicitly configured; never scan arbitrary local ports.
6. Freeze the milestone corpus and verifier before live model calls.

Output: reality-refresh report and frozen implementation baseline.

## Phase A — Capability record contract

Add a versioned, fail-closed empirical capability schema.

Required identity fields:

- provider
- model
- runtime class
- runtime version where observable
- corpus id/fingerprint
- harness fingerprint
- tool-contract fingerprint
- verifier version

Required evidence families:

- protocol/interface
- tool selection
- argument validity
- result grounding
- fabricated-result detection
- recovery
- toolset-size pressure
- planning horizon
- context/tool-result pressure
- task-role behavior

Rules:

- raw counts are authoritative; rates are derived;
- zero samples cannot produce positive capability claims;
- observation cannot grant permission;
- stale evidence must be detectable by fingerprint mismatch;
- secret-bearing fields are forbidden;
- unknown fields fail closed unless explicitly forward-compatible.

Tests:

- schema validity/invalidity
- deterministic serialization/fingerprint
- no-secret field policy
- stale fingerprint rejection
- capability observation cannot widen scope

## Phase B — Deterministic qualification runner

Build a reusable development/evaluation runner separate from the stable installed payload until promotion.

The runner should execute frozen probe cases and persist one record per run with:

- run id
- model/runtime identity
- task/case id
- exposed tool set
- tool calls
- verifier result
- retry count
- failure class
- context/tool-result volume
- latency when observable
- harness fingerprint

Probe groups:

### B1 — Tool protocol

Measure correct tool selection and valid arguments using simple deterministic tasks.

### B2 — Grounding

Use tools that return synthetic deterministic values. Verify that final claims match observed results and detect fabricated results.

### B3 — Recovery

Inject bounded invalid argument and tool-failure scenarios. Verify successful correction without unauthorized escalation.

### B4 — Toolset pressure

Run equivalent tasks with increasing numbers of irrelevant but granted tools. Measure where tool-selection/argument accuracy changes.

### B5 — Planning horizon

Use equivalent task families at increasing step depth. Verify each intermediate state and final task completion.

### B6 — Context pressure

Increase irrelevant/relevant context and tool-result volume in controlled steps. Measure verified success and efficiency.

### B7 — Role overlays

Evaluate PLAN, BUILD, REVIEW, RESEARCH, TOOL_USE under identical model/runtime conditions.

## Phase C — Hosted free-model qualification

Qualify at least one currently reachable free model already represented in the OCAE catalog.

Selection rules:

- zero paid calls;
- real reachability established immediately before qualification;
- no model is selected because historical data suggests a desired result;
- failed runs are retained.

Deliverable: first empirical capability profile and summary.

## Phase D — Local model qualification

Add a vendor-neutral local OpenAI-compatible provider/runtime adapter for evaluation.

Constraints:

- explicit endpoint/configuration only;
- no credential discovery;
- no arbitrary LAN/local-port scanning;
- no assumption that local means trusted;
- provider/runtime/model identity must be stable enough for evidence reuse;
- generic fallback remains available if qualification fails.

Run the same core qualification corpus against at least one local model.

Deliverable: local empirical capability profile and summary.

## Phase E — Candidate derivation

Implement a deterministic development-only function that maps empirical capability evidence to a bounded harness candidate.

Example rules to test independently:

- high toolset-size sensitivity -> task-minimal tool exposure;
- argument errors -> shorter explicit schema/contract framing;
- fabricated tool results -> explicit action boundary and verifier anchoring;
- weak long-horizon planning -> bounded task decomposition;
- context sensitivity -> context/result compression;
- role-specific weakness -> role overlay adjustment.

Hard rule:

```text
candidate_tools ⊆ granted_tools
```

Candidate derivation must never alter provider/model routing, permissions, budget, retry authority, terminal decisions, or production promotion.

## Phase F — Bounded task decomposition

Introduce deterministic task decomposition only for authorized evaluation tasks.

Requirements:

- original task is authoritative;
- decomposition depth and subtask count are bounded;
- each subtask inherits same-or-narrower scope;
- no subtask can add requirements;
- no recursive unbounded agent spawning;
- original-task verifier determines final success.

Test decomposition against a small/local model where generic long-horizon execution is measurably weaker.

## Phase G — Causal A/B evaluation

For each candidate with a concrete hypothesis, compare:

```text
GENERIC_V1_BASELINE
vs
MODEL_SPECIFIC_CANDIDATE
```

Hold constant:

- model/provider/runtime
- task corpus
- initial grants
- verifier
- retry budget
- runtime constraints

Measure:

- verified success
- functional correctness
- tool correctness
- context volume
- tool-result volume
- tool calls
- retries
- latency when observable
- failure classes

Promotion gate:

```text
NO_CORE_REGRESSION
AND NO_SECURITY_REGRESSION
AND NO_SIGNIFICANT_VERIFIED_SUCCESS_REGRESSION
AND MEASURABLE_MODEL_SPECIFIC_VALUE
```

No candidate is promoted merely because it is different or because a local model is cheaper.

## Phase H — Integration decision

Possible terminal outcomes:

- `PROMOTED` — measurable value, no regression, all gates pass.
- `NOT_PROMOTED_NO_VALUE` — safe but no meaningful gain.
- `REJECTED_FOR_CORRECTNESS` — verified success regression.
- `REJECTED_FOR_SECURITY` — authority/scope/security regression.
- `INSUFFICIENT_EVIDENCE` — sample/run quality inadequate.

The milestone can be GREEN with a neutral/negative research result if the qualification system itself is proven correct and safely rejects non-value.

## Required architecture tests

At minimum add tests proving:

1. qualification data cannot influence routing authority directly;
2. candidate derivation cannot add tools;
3. candidate derivation cannot change permission grants;
4. worker/model cannot self-select qualification or candidate profile;
5. unknown/unqualified model resolves safely to generic behavior;
6. stale capability evidence cannot silently apply;
7. task decomposition cannot expand scope;
8. failed qualification runs remain in evidence;
9. promotion requires verifier-backed value;
10. no paid provider is required by the milestone.

## Documentation outputs

- architecture/specification
- qualification schema reference
- corpus design
- local-runtime adapter contract
- evaluation methodology
- per-model qualification summaries
- final acceptance reconciliation

## Product boundary

Until an explicit promotion PR succeeds:

- `generic.v1` remains the only production/default harness profile;
- stable installer behavior does not change;
- production routing does not change;
- no local provider is automatically configured;
- no credential or endpoint is persisted by OCAE;
- candidate/evaluation artifacts remain development-only.

## Completion criteria

The milestone is complete when:

- contract/schema tests pass;
- qualification runner is deterministic and evidence-preserving;
- one hosted free model and one local model have complete qualification evidence;
- adaptive candidate derivation is proven hide-only/narrow-only;
- task decomposition is bounded and scope-preserving;
- at least one causal generic-vs-candidate evaluation is complete;
- every candidate has an explicit evidence-based disposition;
- architecture/security/governance sentinels pass;
- canonical OCAE test suite passes;
- final summary records paid model calls/cost and preserved failures honestly.

Refs #43.
