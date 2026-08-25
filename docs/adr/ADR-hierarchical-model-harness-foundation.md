# ADR: Hierarchical Model-Specific Harness Foundation

## Status

Accepted for implementation under issue #33 (HIGH_HUMAN_GATE milestone task
capsule). Completion is subject to the verification contract in
`docs/specs/ocae-hierarchical-model-harness-foundation.md`.

## Context

The canonical runtime routes work to a deterministic provider/model selected
by runtime policy, but every worker receives the same generic task framing.
Different models fail differently: some waste context by restating tasks and
echoing tool output, some fabricate tool results or pick wrong tools, some
degrade structured output near the end of long answers. The ecosystem needs a
way to tune worker prompting and tool shaping per model without forking the
runtime: one canonical, governed core must keep sole authority over
contracts, routing, pipeline, controller decisions, budgets, and grants
(SHARED_CORE_OWNS). Model-specific needs are real but must never become
model-specific authority.

## Decision

### Product anchor and installation boundary

OCAE is a URL-installable agent ecosystem hosted by OpenCode:

`OCAE_IS_AN_OPENCODE_URL_INSTALLABLE_AGENT_ECOSYSTEM`

A supported release must be reproducibly installable into a fresh OpenCode
environment from the canonical HTTPS repository URL without developer-private
filesystem state or credentials. OpenCode remains the host; the installed
OCAE runtime, agents, governance, generic harness, and any explicitly
promoted profiles are the product surface.

The generic profile is the required portable baseline. Candidate profiles and
the A/B evaluation runner are development/evaluation infrastructure and are
not installed into normal targets unless a candidate has been explicitly
promoted into the product registry. Provider authentication remains an
external OpenCode host capability.

Introduce a three-layer hierarchical harness above the unchanged canonical
core:

- **L1 model profiles** — declarative, frozen data records
  (`ecosystem.model-harness.v1`) keyed by exact `{provider, model}` match,
  refining only prompt-shaping vocabulary (context policy, tool description
  and exposure shaping, result anchoring, planning granularity, retry hints,
  known-failure mitigations). Profiles carry an evidence lifecycle
  (`candidate → promoted | rejected`) and can never become executable code.
- **L2 task-role overlays** — declarative refinements per task role
  (PLAN/BUILD/REVIEW/RESEARCH/TOOL_USE) that override model-profile policy
  keys per top-level policy object.
- **A deterministic resolver** — a pure runtime function that maps the
  route-selected model plus task role to an effective harness via a fixed
  merge (generic baseline ⊕ model profile ⊕ matching task-role overrides ⊕
  role overlay), with generic fallback for unknown models, sha256 canonical
  fingerprint (no timestamps, no run ids), and unconditional denial of worker
  self-selection. The router chooses the model; the resolver chooses the
  profile; the worker chooses neither.

Fail-closed forbidden keys (permissions, tool allowlists, scopes, provider or
model selection, retry budgets, escalation, cost authorization, acceptance
criteria, requirements, scope, terminal decisions, promotion, evidence
integrity, controller/route internals) make profile authority escape a
contract violation, not a configuration option. Profiles are data, not
runtime: they cannot replace the canonical pipeline, and the apply layer can
only shape worker input text and hide already-granted tools — never add tools
or permissions.

## Alternatives Considered

### Per-model runtime stacks

Rejected. A separate pipeline/controller per model would create architecture
drift: N cores to test, secure, and freeze; terminal authority and contract
invariants would fragment per provider. The shared core must stay single and
canonical; model specifics belong in data above it.

### Single generic harness only

Rejected. A generic harness is the safe baseline and stays the mandatory
fallback, but it cannot express known failure mitigations (fabricated tool
results, structured-output degradation) or efficiency tuning per model. With
no measurable model-specific value channel, model weaknesses would be worked
around by prompt edits scattered through call sites with no evidence
lifecycle.

### LLM-based resolver (a model choosing the harness)

Rejected. Non-deterministic: the same route and role could yield different
effective harnesses across runs, breaking fingerprint-based evidence and
auditability. Harness selection is a runtime decision and must be
deterministic, auditable, and cheap (pure function, zero model calls).

### Worker self-selected harness

Rejected. A worker choosing its own harness is authority escape equivalent to
model self-selection. Requests are ignored and recorded as
`worker_self_selection: 'DENIED'`.

## Consequences

- Model-specific tuning becomes versioned, reviewable data with an evidence
  lifecycle; promotion requires measured value and no core/security/
  verified-success regression.
- Every effective harness is fingerprinted; run events carry the fingerprint,
  making worker input shaping exactly reproducible and auditable.
- Unknown and non-selectable models always fall back to the safe generic
  harness — no task is ever blocked by harness resolution (only malformed
  contract input under routing fails closed with
  `HARNESS_CONTRACT_INVALID`).
- The core stays frozen: harness modules import nothing from controller or
  approval; the sentinel guards the authority boundary structurally.
- Cost of maintenance: each new candidate profile requires a live evaluation
  (free-tier models, `PAID_MODEL_CALLS=0`) before promotion; the registry
  stays deliberately small.

The canonical installation and artifact classification are defined by
`bootstrap/manifest.json`; its product contract is the source for what is
installed, what is evaluation-only, and how post-install capability status is
reported.
