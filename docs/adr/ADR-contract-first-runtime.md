# ADR: Contract-First Runtime

Status: Accepted for this migration

```
The ecosystem is contract-first, not agent-first.

LLMs and agents are workers.

Deterministic runtime components own gates,
retry authorization and terminal decisions.
```

The ten versioned `ecosystem.*.v1` contracts under `runtime/contracts/`
(ecosystem.task.v1, ecosystem.baseline.v1, ecosystem.research.v1,
ecosystem.plan.v1, ecosystem.build-input.v1, ecosystem.build-result.v1,
ecosystem.verification.v1, ecosystem.review.v1, ecosystem.decision.v1,
ecosystem.run-event.v1) are the single interchange surface between workers and
the runtime. `run_id` originates only in `ecosystem.task.v1` and is passed
through by every other contract. Terminal states DONE/FIX/SPLIT/BLOCKED are
decided only by the deterministic controller (`runtime/controller/controller.mjs`)
with the Security Hard Block (blocking finding at severity HIGH or CRITICAL) as
top priority; there is no LLM majority decision and no second orchestration
layer. The native OpenCode adapter (`runtime/adapters/native-opencode.mjs`) is
a seam that maps plan and build output into contracts and back, preserving
OpenCode as the planner/builder while the runtime consumes only validated
contracts.

## Retirement Note (2026-08-17)

Legacy execution fallback retired after real-worker adoption proof
(`GREEN_OCAE_REAL_WORKER_ADOPTION_PROVEN` → `GREEN_OCAE_LEGACY_COMPATIBILITY_RETIRED`).

The plugin `chat.message` entry (`.opencode/plugins/canonical-governance.mjs` and
the installer-generated hook) no longer falls back to the
`LEGACY_COMPATIBILITY_PATH`. If the canonical runtime cannot be entered, the run
fails fast with `CANONICAL_RUNTIME_UNAVAILABLE` and stays observable
(`ocae.runtime-entry-failure.v1`, `fallback_attempted=false`).
`runtime/agent/run-state.mjs` remains only as non-terminal helper bookkeeping
for tests and completion diagnostics; it is not installed and not reachable
from the normal entry.
