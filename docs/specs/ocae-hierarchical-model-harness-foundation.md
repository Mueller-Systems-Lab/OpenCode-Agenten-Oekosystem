# OCAE Hierarchical Model-Specific Harness Foundation

## Status

- Source of truth: GitHub issue #33 (milestone task capsule)
- Baseline: `86528ca593dae26d0570ac31f0cb4946e988179e` (origin/master)
- Workflow risk tier: `HIGH_HUMAN_GATE`
- Owner authorization: issue #33 task capsule (implementation within the
  capsule only)

## Goal

Give the canonical governed runtime a hierarchical, model-specific worker
harness layer: a deterministic resolver that composes a per-model prompt/tool
harness (L1 model profiles, L2 task-role overlays) above the unchanged
canonical core (L0), so that model-specific behavioral tuning becomes
declarative data under runtime authority instead of per-model runtime forks.
Model-specific value must be measured before any profile is promoted;
candidates never apply in production automatically.

## Product realignment

The issue implementation is a product optimization within the installable
OCAE ecosystem, not a second host or control plane. The canonical product
invariant is:

`OCAE_IS_AN_OPENCODE_URL_INSTALLABLE_AGENT_ECOSYSTEM`

The installer always ships the generic product profile and resolver contract.
The candidate registry, evaluation runner, benchmark corpus, and evaluation
reports remain development/evaluation-only until an explicit promotion makes
a profile an installable artifact. No developer checkout, home-directory
configuration, provider secret, GitHub token, or private key is an
installation prerequisite. Provider auth is supplied by OpenCode as an
external host capability.

## In Scope

- A frozen model-harness contract (`ecosystem.model-harness.v1`) with
  fail-closed forbidden keys and deterministic validators.
- A declarative, frozen model-harness profile registry (generic + candidate
  profiles for free opencode-provider models).
- A declarative task-role overlay registry (PLAN/BUILD/REVIEW/RESEARCH/
  TOOL_USE).
- A deterministic harness resolver with canonical-JSON sha256 fingerprint
  (no timestamps, no run ids).
- A pure apply layer: worker task-text composition, tool-exposure filtering
  (hide-only, never add), and flat evidence fields.
- Additive catalog data: provider `opencode` inventory entry plus five
  free-tier model entries (availability `configured` until evaluation probes
  them with evidence).
- Minimal additive runtime wiring in `runtime/run.mjs` after route selection
  (event `model.harness.resolved`; harness contract invalid → BLOCKED with
  `HARNESS_CONTRACT_INVALID`).
- Five additive production-sentinel invariants and structural checks.
- Deterministic contract-level test suite (zero model calls) in `test/harness/`.

## Out of Scope

- Any change to the canonical pipeline, controller authority, retry/escalation
  semantics, or terminal decision ownership.
- Any change to `DEFAULT_ROUTING_POLICY.allowed_providers` (production routing
  stays `['deepseek','openai']`; evaluation passes its own policy object).
- Any change to governance policy core/generated artifacts, controller
  modules, approval modules, workflows, or agent definitions.
- Live model evaluation and profile promotion (separate follow-up milestone
  under the promotion rules below; the evaluation harness is designed here).
- Per-model executable code: profiles are data only.
- Auto-apply of candidate profiles in production.
- Requiring any model-specific profile for a fresh installation.

## Architecture Invariants

- **SHARED_CORE_OWNS** — L0 (canonical core) owns contracts, routing policy,
  pipeline, controller, terminal decisions, budgets, and grants. The harness
  layer never replaces or bypasses any of them.
- **MODEL_PROFILE_MAY_CONTROL** — an L1 model profile may only refine prompt
  shaping vocabulary: context policy, tool description/exposure shaping,
  result anchoring, planning granularity, retry hints, and known-failure
  mitigations.
- **MODEL_PROFILE_MUST_NOT_CONTROL** — a profile must never carry permissions,
  tool allowlists, filesystem/network/GitHub/credential scope, provider/model
  or route selection, retry budgets, escalation, cost authorization,
  acceptance criteria, requirements, scope, terminal decisions, promotion, or
  evidence integrity. All forbidden keys fail closed at any depth.
- **WORKER_SELF_SELECT_HARNESS=DENIED** — a worker-requested profile is always
  ignored and recorded as `worker_self_selection: 'DENIED'`.
- **MODEL_PROFILE_CANNOT_REPLACE_CANONICAL_PIPELINE** — the effective harness
  shapes worker input text and tool exposure only; the pipeline, verify,
  reviews, and controller are unchanged and remain mandatory.
- **GENERIC_HARNESS_FALLBACK_REQUIRED** — an unknown or non-selectable model
  always resolves to the safe generic harness; the task can always run.
- **ROUTER chooses model, RESOLVER chooses profile** — routing policy selects
  provider/model; the harness resolver then deterministically maps the
  selected model to a profile. Neither the worker nor the profile can
  influence the route.
- **MODEL_CAPABILITY_DOES_NOT_CREATE_REQUIREMENT** — adding catalog entries or
  profiles creates no new runtime requirement; the harness layer is optional
  and additive (routing without harness behaves exactly as before).
- **INSTALLATION_DOES_NOT_REQUIRE_DEVELOPER_PRIVATE_STATE** — a fresh isolated
  OpenCode-compatible target must install and validate core artifacts without
  the developer home, credentials, checkout path, or Git metadata.
- **OPENCODE_IS_THE_HOST** — OCAE installs into the OpenCode environment and
  does not create a competing user-facing platform.

## Hierarchical Composition

```text
L0  Canonical core (unchanged authority)
     contracts · routing policy · pipeline · controller · budgets · grants
L1  Model profiles (declarative data, runtime-selected)
     generic.v1 (active) · hy3.v1 · muse.v1 · nemotron.v1 (candidates)
L2  Task-role overlays (declarative data, runtime-selected)
     PLAN · BUILD · REVIEW · RESEARCH · TOOL_USE
```

Effective harness = generic baseline ⊕ model profile policies ⊕ model profile
`task_role_overrides` for the matching role ⊕ role overlay (role wins per
top-level policy key). The composition is a deterministic shallow merge; the
fingerprint is the sha256 of the canonical JSON of the effective harness.

## Acceptance Criteria

1. `validateModelHarnessProfile` rejects any profile carrying a forbidden key
   at any depth, and `createModelHarnessProfile` throws `CONTRACT_INVALID`.
2. Only `generic` may hold status `active`; candidate profiles apply only with
   explicit `allow_candidate: true`; otherwise generic fallback resolves.
3. `resolveModelHarness` is deterministic: identical inputs produce identical
   fingerprints (verified over repeated calls) and never mutate its inputs.
4. A worker-requested profile never changes the resolution and is recorded as
   denied.
5. `applyToolExposure` may only hide granted tools; any policy that would add
   a tool not in the granted set throws `SECURITY_VIOLATION`.
6. `composeWorkerTaskText` is a pure string function honoring
   `instruction_order`, verbosity, compression hints, anchoring, and planning
   directives; deterministic for identical input.
7. `runTask` with routing enabled resolves the harness after route selection,
   emits `model.harness.resolved` with flat evidence fields (fingerprint, no
   secrets), and attaches `route.harness` additively.
8. Harness contract invalid input under routing resolves to BLOCKED with
   reason `HARNESS_CONTRACT_INVALID` (routing rejection path).
9. The sentinel guards the five new invariants structurally; harness modules
   never import controller/approval authority.
10. All previous tests stay green; the new suite is deterministic with zero
    model calls.
11. A fresh isolated target reports `CORE_READY`, installs `generic.v1`,
    discovers the OCAE agents, and does not contain evaluation-only runtime
    files; provider absence is reported separately as
    `PROVIDER_NOT_CONFIGURED`.

## Evaluation Requirements

Live evaluation (separate follow-up, design fixed here): 5-case corpus × 2
arms (generic vs model profile with `allow_candidate: true`) × 2 repetitions ×
≥2 models, `PAID_MODEL_CALLS=0` using free opencode-provider models, evidence
under `evidence/model-harness-evaluation-*/`. Catalog availability flips from
`configured` to `reachable` only after real probe evidence, in the same change
that carries the evidence.

## Promotion Rules

A candidate profile is promoted only when ALL hold:

- `NO_CORE_REGRESSION` — canonical core tests unchanged and green.
- `NO_SECURITY_REGRESSION` — no sentinel/security test regression.
- `NO_SIGNIFICANT_VERIFIED_SUCCESS_REGRESSION` — verified-success rate on the
  corpus must not regress materially versus the generic arm.
- `MEASURABLE_MODEL_SPECIFIC_VALUE` — the profile's stated hypothesis shows
  measurable improvement in its target dimension with recorded evidence.

Lifecycle: `candidate → promoted | rejected`. Candidates never auto-apply in
production; promotion is an explicit, evidence-carrying state change of the
declarative registry.

## Verification Contract

Deterministic contract tests (zero model calls, manifest group `unit`):

- `test/harness/resolver.test.mjs` — deterministic resolution incl.
  fingerprint; unknown model → `GENERIC_FALLBACK`; candidate without
  `allow_candidate` → generic fallback; candidate with `allow_candidate` →
  model profile; exact model→profile mapping; identity normalization forms.
- `test/harness/composition.test.mjs` — L0/L1/L2 merge semantics
  (role overlay > model profile > generic baseline per policy key;
  `task_role_overrides` apply only for the matching role); composed harness
  never contains forbidden keys; `core_authority_unchanged` marker present.
- `test/harness/fingerprint.test.mjs` — identical effective harness →
  identical fingerprint; any meaningful profile change → different
  fingerprint; different task role → different fingerprint; deterministic
  re-computation.
- `test/harness/authority.test.mjs` — adversarial: worker self-selection
  denied; forbidden keys rejected (create throws); tool exposure never adds
  and throws `SECURITY_VIOLATION` on attempts; scope/acceptance authority
  rejected; resolver input immutability.
- `test/harness/generic-fallback.test.mjs` — unknown model resolves to the
  safe generic harness; task text composes; evidence fields present.
- `test/harness/apply.test.mjs` — composition determinism, instruction order,
  STRICT anchoring restated, EXPLICIT action boundaries, FULL vs
  TASK_MINIMAL tool exposure.
- `test/harness/runtime-wiring.test.mjs` — `runTask` integration with stubbed
  executor: `model.harness.resolved` event with fingerprint; `route.harness`
  present; worker profile request → `worker_self_selection: DENIED`.

Live evaluation definition: see *Evaluation Requirements*; executed in the
follow-up milestone, results recorded under
`evidence/model-harness-evaluation-*/`.
