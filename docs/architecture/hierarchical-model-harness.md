# Hierarchical Model-Specific Harness

Milestone: issue #33 — "Hierarchical Model-Specific Harness Foundation".
Spec: `docs/specs/ocae-hierarchical-model-harness-foundation.md` · ADR:
`docs/adr/ADR-hierarchical-model-harness-foundation.md` · Contract:
`ecosystem.model-harness.v1` (runtime/harness/).

## Product boundary

`OCAE_IS_AN_OPENCODE_URL_INSTALLABLE_AGENT_ECOSYSTEM` is the governing
invariant. The canonical HTTPS URL and `bootstrap/manifest.json` define the
installer contract. OpenCode is the host; OCAE installs its agents, governed
runtime, governance policies, tool integration, generic harness, and only
explicitly promoted profile artifacts into that environment.

The generic product registry is always installable. `model-harness-profiles.mjs`,
`evaluation.mjs`, benchmark reports, candidate experiments, and temporary
evidence are development/evaluation artifacts. Provider credentials and
external MCP availability are discovered host capabilities, not OCAE
installation requirements. Post-install status therefore distinguishes core
readiness, provider readiness, tools, optional capabilities, and blockers.

## Hierarchy

```text
            ┌────────────────────────────────────────────────┐
            │ L0 canonical core (authority, unchanged)        │
            │  contracts · routing policy · pipeline ·        │
            │  controller · budgets · grants · sentinel       │
            └───────────────────▲────────────────────────────┘
                                │ route = { provider, model }  (router decides)
            ┌───────────────────┴────────────────────────────┐
            │ harness resolver (deterministic, pure)         │
            │  selected model → profile → task role →        │
            │  effective harness + sha256 fingerprint        │
            └───────────────────▲────────────────────────────┘
                                │ data only, never authority
        ┌───────────────────────┴────────────────────────┐
        │ L1 model profiles (generic.v1 active;           │
        │    hy3.v1 / muse.v1 / nemotron.v1 candidates)   │
        │ L2 task-role overlays (PLAN/BUILD/REVIEW/       │
        │    RESEARCH/TOOL_USE)                           │
        └─────────────────────────────────────────────────┘
```

The router chooses the model; the resolver chooses the profile; the worker
chooses neither (`WORKER_SELF_SELECT_HARNESS=DENIED`).

## Authority Boundary

| Core owns (profiles never touch) | Profile may control | Profile must not control |
|---|---|---|
| contracts, run_id | context_policy (framing, order, verbosity, compression hints) | permissions, tool allowlists, scopes (fs/net/github/credentials) |
| routing policy, provider/model selection | tool_policy (description verbosity, exposure shaping, action boundaries) | provider, model, route, model/provider override |
| pipeline, plan gate, verify, reviews | result_policy (truncation hint, output anchoring) | retry budget, attempts, escalation |
| controller terminal decisions | planning_policy (granularity) | cost authorization, budgets |
| MCP grants, budgets, health | retry_hints, known_failure_mitigations (text hints only) | acceptance criteria, requirements, scope |
| sentinel, evidence integrity | task_role_overrides (policy keys only) | terminal decision, promotion, controller/route internals |

Forbidden keys fail closed at any depth
(`FORBIDDEN_PROFILE_KEYS` in `runtime/harness/model-harness-contract.mjs`).

## Resolver Flow

```text
input { provider, model, task_role, allow_candidate, worker_requested_profile }
  → normalizeModelIdentity (single normalization point; catalog ids are lowercase)
  → worker_requested_profile ≠ null → worker_self_selection: 'DENIED' (always ignored)
  → task_role ∈ TASK_ROLES ? else CONTRACT_INVALID
  → findProfileForModel (exact model_match; selectable status precedence
      promoted > candidate(only with allow_candidate) ; only generic may be active)
  → no selectable profile → GENERIC_FALLBACK with generic.v1
  → effective_harness = generic baseline
      ⊕ model profile policy keys
      ⊕ model profile task_role_overrides[task_role]   (model refinement first)
      ⊕ role overlay policy keys                       (role wins per key)
  → fingerprint = sha256(canonical JSON, sorted keys, no timestamps/run ids)
  → frozen result { ok, resolution, profile_id, profile_version,
      profile_full_id, task_role, effective_harness, fingerprint,
      worker_self_selection }
```

`effective_harness` carries `core_authority_unchanged: true` — the harness
shapes worker input text and tool exposure only; it can never replace the
canonical pipeline.

## Apply Layer

- `composeWorkerTaskText({ taskText, effectiveHarness })` — pure string
  composition: sections in `instruction_order` (task, constraints,
  output_format, action_boundary, steps), verbosity levels, compression
  hints block, STRICT output-format restatement, planning directives. No LLM,
  no randomness.
- `applyToolExposure({ grantedTools, toolPolicy })` — `FULL_TOOLSET` exposes
  everything granted; `TASK_MINIMAL_TOOLSET` filters granted tools to the
  policy's task-relevant list. Hide-only: a policy naming a tool absent from
  the grant throws `SECURITY_VIOLATION`; no path ever returns an ungranted
  tool.
- `harnessEvidenceFields(resolution)` — flat evidence fields
  (`model_profile`, `profile_version`, `task_role`,
  `effective_harness_fingerprint`, `harness_resolution`) for run events.

Runtime wiring (additive): after successful route selection under
`routing.enabled`, `runTask` resolves the harness, freezes the route with
`route.harness`, and emits `model.harness.resolved` with the flat evidence
fields. Harness contract invalid input takes the routing rejection path:
BLOCKED, `HARNESS_CONTRACT_INVALID`.

## Generic Fallback

Unknown models, non-selectable candidates, and missing profile data always
resolve to the safe generic harness (`generic.v1`, status `active`,
`value_proven: true` as safe baseline). A task is never blocked because a
model has no profile. This is the `GENERIC_HARNESS_FALLBACK_REQUIRED`
invariant.

## Profile Lifecycle and Promotion Policy

```text
candidate ──(live evaluation passes all four gates)──→ promoted
    │                                                    ↑
    └──────────(evaluation fails / regression)───→ rejected
```

Promotion gates (ALL required): `NO_CORE_REGRESSION` AND
`NO_SECURITY_REGRESSION` AND `NO_SIGNIFICANT_VERIFIED_SUCCESS_REGRESSION`
AND `MEASURABLE_MODEL_SPECIFIC_VALUE`. Candidates never auto-apply in
production — production resolution selects `promoted` (or `generic`) only;
`allow_candidate: true` is an explicit per-run evaluation opt-in.

## Evaluation Methodology

5-case corpus × 2 arms (generic vs model profile with `allow_candidate`) × 2
repetitions × ≥2 models, `PAID_MODEL_CALLS=0` (free opencode-provider
models), evidence under `evidence/model-harness-evaluation-*/`. Catalog
entries for the free models flip `configured → reachable` only after real
probe evidence, in the same change that carries the evidence.

## Current Profile Registry Status

| profile_id | model_match | status | hypothesis | value_proven | evidence |
|---|---|---|---|---|---|
| generic.v1 | null (any) | active | safe default harness | true (safe baseline) | — |
| hy3.v1 | opencode/hy3-free | candidate | efficiency: reduce unnecessary context/tool-result volume without reducing verified success | false | pending evaluation |
| muse.v1 | opencode/muse-spark-1.2-contributor-free | candidate | tool-selection: improve correct tool invocation and action boundaries | false | pending evaluation |
| nemotron.v1 | opencode/nemotron-3-ultra-free | candidate | runtime robustness: structured output reliability, failure-signature mitigation | false | pending evaluation |

Registry version `1.0.0` (`MODEL_HARNESS_REGISTRY_VERSION`), task-role
registry version `1.0.0` (`TASK_ROLE_REGISTRY_VERSION`).
