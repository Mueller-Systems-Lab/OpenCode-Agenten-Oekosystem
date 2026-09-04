# Issue #43 GLM-5.2 free DEBUG log differential

Experiment: `issue-43-glm52-free-observation-canary-20260904T103234Z`
Target: `openrouter/z-ai/glm-5.2:free`
OpenCode: `1.18.27`

The traces below are sanitized extracts. Timestamps, request IDs, and temporary paths are omitted or normalized where present.

## Differential interpretation

- CONTROL_0: not captured
- IDENTITY: not captured
- ENVELOPE: not captured
- Exact OpenCode internal message roles and provider request payload ordering are not exposed by this CLI surface; message role is therefore UNOBSERVABLE.
- The observable CLI event order and adapter trace order are retained in the evidence JSON; any provider-side resume ordering beyond that boundary is not inferred.

## Controlled continuation attempt

Attempt: `issue-43-glm52-free-observation-canary-attempt-20260904T112939Z`

- Preflight DEBUG trace: captured and sanitized.
- CONTROL_0 / IDENTITY / ENVELOPE DEBUG traces: not run because `FIRST_FAILING_STAGE=PRE_FLIGHT`.
- Provider response: `free-models-per-day`.
- Rate-limit class: `DAILY_FREE_QUOTA_EXHAUSTED`.
- Reset evidence: none exposed.
- Target routing: `openrouter/z-ai/glm-5.2:free` remained the only target path.
- Auxiliary routing: `openrouter/google/gemini-3.8-flash`, purpose `TITLE_GENERATION`.
- `TARGET_MODEL_SWITCH_USED=NO`; the repeated `llm.model` line for the title
  request is classified with the preceding title lifecycle event.

The raw DEBUG text is unchanged in the attempt artifact. The reporting-only
classification correction is recorded there, while message role and full
provider request ordering remain `UNOBSERVABLE` at the OpenCode 1.18.27 CLI
boundary.
