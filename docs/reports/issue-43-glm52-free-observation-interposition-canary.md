# Issue #43: GLM-5.2 free/OpenRouter observation-interposition canary

Date: 2026-09-04
Experiment: `issue-43-glm52-free-observation-canary-20260904T103234Z`
OpenCode: `1.18.27`
Branch/HEAD: `research/issue-43-empirical-capability-qualification` / `4ee38da3d2a88c1a49a9c650bdace01f115d20a3`

## Classification

`AMBER_OCAE_GLM52_FREE_OBSERVATION_DIAGNOSIS_BLOCKED_MODEL_UNAVAILABLE`

The exact free model was discovered and pinned, but no valid canary was run. OpenRouter returned `Rate limit exceeded: free-models-per-day` before a normal completion. The run stopped before CONTROL_0 as required; no model substitution was made.

## Exact target identity

- UI label: `GLM 5.2 (free)`
- OpenCode provider ID: `openrouter`
- OpenCode model ID: `z-ai/glm-5.2:free`
- Canonical runtime entry: `openrouter/z-ai/glm-5.2:free`
- Inventory display name: `GLM 5.2 (free)`
- Inventory status: `active`
- Inventory costs: input `0`, output `0`, cache read/write `0`
- Paid GLM-5.2 entry `z-ai/glm-5.2` was present separately and was not selected.

## Logging and preflight

Every OpenCode live invocation used the required flags:

```text
--print-logs --log-level DEBUG
```

`opencode --help` exposed both flags. The sanitized inventory and preflight traces are retained in the machine-readable evidence JSON. DEBUG logging was observed in the OpenCode stderr lifecycle trace.

The preflight request reached OpenCode session creation and resolved the requested model path, but OpenCode first invoked its internal title-model path `openrouter/google/gemini-3.8-flash`, then resolved `openrouter/z-ai/glm-5.2:free`. The target request was rejected by OpenRouter's free-model daily limit. Therefore `MODEL_SWITCH_USED=YES` is recorded as an observed host behavior, while `PAID_CALLS=0` and `FALLBACK_USED=NO` remain recorded.

Because the target was unavailable before a valid completion, the explicit plugin initialization probe and all measured ladder layers were not run. The explicit project-plugin registration path remains frozen as `./ocae-observation-adapter.js`; no auto-discovery path was used.

## Frozen contracts

- Tool-contract fingerprint: `e6c9f7f9aa095578c0138f69c73076a4af7583ed7c8409dc1bb14f0fcd5cd33c`
- Observation-contract fingerprint: `638a4d824837ef4d97d1ade5fe59b80b39984e025e01c4e0126b2a7810d5b73d`
- Adapter: `ocae.live.tool-execute-after@1.0.0`
- Verifier: `issue-43-live-verifier.v1`
- Fixture: `issue-43-read-observation.v1`
- Execution order: `CONTROL_0 → CANARY_1_IDENTITY → CANARY_2_ENVELOPE`
- Timeout: `90000 ms`; harness retry budget: `0`
- Profile promotion: none

The complete freeze artifact is [the experiment freeze JSON](./issue-43-glm52-free-observation-canary-20260904T103234Z-freeze.json). The complete sanitized evidence is [the experiment evidence JSON](./issue-43-glm52-free-observation-canary-20260904T103234Z.json).

## Final validation

- Full local suite: `1331/1331` passed, `0` failed, `0` skipped.
- Architecture/production sentinel: `PASS`.
- Governance drift: `PASS`.
- Documentation validation: `PASS`.
- DEBUG-log credential scan: `PASS`.
- `git diff --check`: `PASS`.
- Security adversarial result: `VERIFIED_IN_SCOPE`, with zero secret bytes, zero secret values in transcript/log, and zero remote writes. The wrapper exit was `1` with `NEEDS_REVIEW_AI_TOOL_RECOVERY`; this is recorded as a review-state wrapper result, not as a demonstrated security data leak.

## Canary results

| Layer | Runs | Result | Status |
| --- | ---: | ---: | --- |
| CONTROL_0 | 0 | 0/0 | not run; blocked by preflight |
| CANARY_1_IDENTITY | 0 | 0/0 | not run |
| CANARY_2_ENVELOPE | 0 | 0/0 | not run |

No tool selection, argument validity, observation comprehension, receipt propagation, serialization, or latency result is claimed. `FIRST_FAILING_LAYER=CONTROL` means the required control gate could not be established, not that a control-model defect was observed.

## DEBUG lifecycle differential

No CONTROL/IDENTITY/ENVELOPE traces exist because the ladder did not start. The preflight DEBUG trace is captured and the compact differential artifact is [issue-43-glm52-free-debug-log-differential.md](./issue-43-glm52-free-debug-log-differential.md). It shows session creation, internal title-model resolution, target-model resolution, repeated provider stream errors, and session disposal. No tool call, tool result, `tool.execute.after`, model resume, or successful session continuation occurred.

OpenCode's CLI event surface does not expose internal message-role labels or the complete provider request-message array. Accordingly, `MESSAGE_ROLE_PRESERVED=UNOBSERVABLE` and message-order preservation is unobservable for this blocked run.

## Receipt and authority

No measured run produced a tool receipt. The implementation still preserves the required authority boundary: raw observations are created by the runtime adapter, model-facing views are derived data, and the verifier is not allowed to use an envelope as authority. These properties were covered by the targeted harness tests; they are not live GLM-5.2 observations.

## Cross-runtime interpretation

`CROSS_RUNTIME_COMPARISON=CROSS_RUNTIME_DESCRIPTIVE_ONLY`. The prior immutable GLM-5.3/Z.AI result cannot be compared for envelope sensitivity because the GLM-5.2/OpenRouter ladder produced zero valid samples. `ENVELOPE_REGRESSION_REPLICATED=INSUFFICIENT`; `ROOT_CAUSE_GENERALIZATION=INSUFFICIENT`.

## Next step

Repeat this frozen identity after the OpenRouter free-model daily limit is cleared, first requiring a normal target completion and a clean explicit-plugin initialization probe. Do not use the paid GLM-5.2 entry, a fallback model/provider, or a different GLM variant.

## Controlled continuation attempt

Date: 2026-09-04

The frozen experiment specification remained intact. The continuation therefore
keeps the original `EXPERIMENT_ID` and records a new immutable attempt:

- `EXPERIMENT_ID=issue-43-glm52-free-observation-canary-20260904T103234Z`
- `ATTEMPT_ID=issue-43-glm52-free-observation-canary-attempt-20260904T112939Z`
- `TARGET_MODEL_PROVIDER=openrouter`
- `TARGET_MODEL=z-ai/glm-5.2:free`
- `TARGET_MODEL_REACHABLE=NO`
- `FREE_MODEL_PATH=PASS`
- `PAID_CALLS=0`
- `TARGET_MODEL_SWITCH_USED=NO`
- `TARGET_MODEL_FALLBACK_USED=NO`
- `TARGET_PROVIDER_FALLBACK_USED=NO`
- `AUXILIARY_MODEL_USED=YES`
- `AUXILIARY_MODEL_PROVIDER=openrouter`
- `AUXILIARY_MODEL=google/gemini-3.8-flash`
- `AUXILIARY_MODEL_PURPOSE=TITLE_GENERATION`

The target preflight again returned `free-models-per-day`. This is classified as
`RATE_LIMIT_CLASS=DAILY_FREE_QUOTA_EXHAUSTED`; no Retry-After or reset value was
exposed. The run stopped before plugin initialization and before CONTROL_0:

- `PREFLIGHT_RESULT=BLOCKED`
- `FIRST_FAILING_STAGE=PRE_FLIGHT`
- `PLUGIN_INITIALIZATION=NOT_RUN`
- `CONTROL_0=NOT_RUN`
- `IDENTITY=NOT_RUN`
- `ENVELOPE=NOT_RUN`
- `RAW_OBSERVATION_FINGERPRINTING=NOT_RUN`
- `MODEL_FACING_OBSERVATION_FINGERPRINTING=NOT_RUN`
- `CALL_RESULT_CORRELATION=NOT_RUN`
- `RAW_RECEIPT_PROPAGATION=NOT_RUN`
- `VERIFIER_RAW_AUTHORITY=NOT_RUN`

This corrects reporting semantics only. The prior blocked artifact's derived
`first_failing_layer=CONTROL` wording was not an executed control failure; the
new canonical field is `FIRST_FAILING_STAGE=PRE_FLIGHT`, with all observation
gates `NOT_RUN`. Likewise, the target/auxiliary distinction is now explicit:
the adjacent `llm.model` title lifecycle line is attributed to auxiliary title
generation, not target-model switching. The raw sanitized DEBUG trace is
unchanged, and the corrected interpretation is recorded in the attempt artifact.

The required fingerprints remain unchanged:

- `TOOL_CONTRACT_FINGERPRINT=e6c9f7f9aa095578c0138f69c73076a4af7583ed7c8409dc1bb14f0fcd5cd33c`
- `OBSERVATION_CONTRACT_FINGERPRINT=638a4d824837ef4d97d1ade5fe59b80b39984e025e01c4e0126b2a7810d5b73d`
- `EXECUTION_ORDER_FINGERPRINT=503ffbe04835c26752a392659e5051744f91a51ca203daa87877fdd9b6dfecc5`
- `FROZEN_EXPERIMENT_INTEGRITY=PASS`

Artifacts: [attempt evidence JSON](./issue-43-glm52-free-observation-canary-attempt-20260904T112939Z.json), [attempt freeze JSON](./issue-43-glm52-free-observation-canary-attempt-20260904T112939Z-freeze.json), and [updated DEBUG differential](./issue-43-glm52-free-debug-log-differential.md).

No Envelope conclusion is possible. `ENVELOPE_REGRESSION_REPLICATED=INSUFFICIENT`,
`ROOT_CAUSE_GENERALIZATION=INSUFFICIENT`, and `PROMOTED_PROFILE=NONE` remain in
force. No paid fallback, provider fallback, model substitution, or production
routing change occurred.
