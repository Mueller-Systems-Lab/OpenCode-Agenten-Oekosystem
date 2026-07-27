# Specification — Canonical User Action Handoff Contract

Issue: #18
Dependency: Issue #16 / PR #17 while not merged
Feature branch: `feat/canonical-user-action-handoff-contract`

## Goal

Every relevant ecosystem-generated or ecosystem-required completion report ends
with a deterministic German user-action section containing only actions that
the agent system has proved it cannot perform itself in the concrete run.

## Scope

- Governance V2 policy and generated IR
- machine-readable user-action handoff schema
- controlled reason codes and capability evidence
- dependency-free renderer and validator
- bootstrap run reports and generated project instructions
- machine-readable final-status closure reports
- OpenCode prompt-kernel and project-agent instruction injection
- Hermes native bundle and generated handoff parity
- Spec-Kit completion prompts
- positive, negative, drift, bootstrap, security, and E2E tests
- migration documentation and ADR

## Out of Scope

- changes to Issue #16, PR #17, or their feature branch
- merge, deployment, force push, remote CI, or direct `master` changes
- `.github/workflows` changes
- global OpenCode or Hermes configuration
- automatic modification of unrelated existing projects
- general next-step management
- translating all technical documentation into German

## User Stories

### US1 — No user action

As a user, when the system completed all authorized work, I see the exact empty
state and no recommendation is presented as mandatory.

Acceptance:

- the final section title is exact and last;
- its body is exactly `Keine Aktion durch den Nutzer erforderlich.`;
- the structured action array is empty.

### US2 — Genuine non-delegable action

As a user, I receive a concrete physical, legal, personal, permission-bound, or
authorization-bound action only after a capability-first decision.

Acceptance:

- a controlled reason code is present;
- all capability evidence fields are explicit;
- the reason/evidence combination permits delegation;
- the action was not already executed and is not optional.

### US3 — GitHub owner approval

As a repository owner, I receive a complete GitHub web-UI sequence when a known
GitHub effect requires my non-delegable personal approval.

Acceptance:

- repository and target object are known;
- platform is `github_web`;
- ordered controls have visible labels;
- button/menu/tab/input order is explicit;
- an abort condition is present;
- no CLI-only guidance or unresolved placeholder is present;
- label provenance is `live_checked`, `official_docs`, or
  `current_expected_not_live_checked`.

### US4 — False delegation prevention

As a user, I am not asked to commit, push, create a PR, or use a missing CLI when
an authorized alternative capability or suitable agent can complete the effect.

Acceptance:

- available + authenticated + permitted + authorized capability causes
  delegation rejection;
- a missing CLI does not imply a tool gap when a connector can perform the
  effect;
- a suitable agent prevents delegation caused only by current-agent choice.

### US5 — Cross-runtime parity

As an integrator, I get the same contract semantics in Governance V2, OpenCode,
Hermes, bootstrap outputs, Spec-Kit prompts, and final-status JSON.

Acceptance:

- one canonical schema and runtime module own the semantics;
- generated policy derives from the canonical policy;
- drift tests compare mandatory constants and reason codes;
- a fresh fixture bootstrap contains the contract and produces a valid report.

## Functional Requirements

### FR-001 — Required section

The renderer always emits `## Erforderliche Aktion durch den Nutzer` as the last
level-two section of a German completion report.

### FR-002 — Empty state

When `actions` is empty, the section contains exactly
`Keine Aktion durch den Nutzer erforderlich.` and nothing else.

### FR-003 — Reason codes

Only these reason codes are accepted:

- `PHYSICAL_ACTION_REQUIRED`
- `RESOURCE_UNREACHABLE`
- `MISSING_PERMISSION`
- `MISSING_AUTHORIZATION`
- `NON_DELEGABLE_OWNER_APPROVAL`
- `PERSONAL_LEGAL_DECISION`
- `MANUAL_SECURITY_CONFIRMATION`

### FR-004 — Capability-first evidence

Each action records whether capability discovery ran and explicitly records tool
availability, authentication, permission, authorization, suitable-agent
availability, personal-decision requirement, and the checked effect.

### FR-005 — Required-only input

Actions must have required obligation and a source category of
`non_delegable_user_action`. Recommendations, residual risks, next steps, and
already executed actions are rejected.

### FR-006 — Determinism

Actions are deduplicated by semantic effect and target, then sorted by explicit
order and stable identifier. Externally supplied handoffs in noncanonical order
fail validation instead of being silently reinterpreted.

### FR-007 — GitHub web UI

GitHub actions require a known target, `github_web`, ordered web controls with
visible labels, confirmation, and abort conditions. Shell, `git`, and `gh`
instructions are not accepted as the sole or primary user path.

### FR-008 — Redaction

Titles, reasons, targets, and rendered steps pass through the existing security
redaction layer. Portable outputs do not expose recognized absolute local-user
paths on Linux, macOS, Windows, WSL, media mounts, or root-owned locations.

### FR-009 — Validator

The validator detects at least all positive/negative cases listed in Issue #18
and returns stable machine-readable error codes.

### FR-010 — Completion JSON

Machine-readable `final-status` closure evidence includes a validated
`user_action_handoff`; final-status without it is invalid.

### FR-011 — Bootstrap

Applied bootstrap output contains the contract in generated `AGENTS.md`, Hermes
handoffs, the canonical schema copy, and the final bootstrap run report.

### FR-012 — Prompt injection

The permanent prompt kernel, generated AGENTS section, Spec-Kit completion
prompts, and Hermes bundle instruct completion producers to use the canonical
renderer/validator semantics without duplicating the whole schema.

## Nonfunctional Requirements

- dependency-free ESM implementation;
- JSON Schema draft 2020-12;
- fail-closed validation;
- stable error codes and output ordering;
- idempotent bootstrap;
- no network use in tests;
- no real GitHub mutation in tests;
- no `.env` reads;
- no new package dependency;
- no `.github/workflows` modification.

## Edge Cases

- duplicate semantic actions with different text;
- standards sentence plus real actions;
- a GitHub target known but UI not live-checked;
- English technical labels inside an otherwise German report;
- capability connector available while the preferred CLI is absent;
- action changed from pending to executed before rendering;
- action authorized for a different repository or branch;
- malformed or unknown fields from untrusted tool output;
- a residual risk that contains imperative wording.

## Clarify Result

`NOT_REQUIRED`: repository reality, Issue #18, the implementation prompt, and
existing Governance V2 define all choices necessary for implementation. No
owner question is needed.
