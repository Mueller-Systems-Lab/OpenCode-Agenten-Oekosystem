# Issue #43: GLM-5.3 observation-interposition root cause

Date: 2026-09-04
Provider/model: `zai-coding-plan/glm-5.3`
OpenCode: `1.18.25`
Start head: `2c083485c16ea3818e3a32e098ef47fa79189a8e`

## Conclusion

The original C/D timeout collapse had a concrete host-integration cause: the live harness placed its plugin in OpenCode's auto-discovered `.opencode/plugins` directory. In OpenCode 1.18.25 this path stalled before OpenCode initialization: no model request, tool event, or adapter trace was emitted before the 90-second timeout. The same hook loaded and ran when registered explicitly as `plugin: ["./ocae-observation-adapter.js"]` in the project `opencode.jsonc`.

That is an `OPENCODE_HOST_CONTRACT_MISMATCH` in the harness registration path, not evidence that `tool.execute.after` itself is intrinsically unsafe. The minimal fix uses explicit project-plugin registration and keeps the raw receipt authoritative.

The repaired path then isolated a second, later boundary. The ladder reached 3/3 for the no-interposition control and 3/3 for an identity adapter. Envelope-only adaptation was the first correctness regression at 2/3. Its only semantic change was replacing the raw result string with a JSON string containing `status`, `tool`, `content`, and `complete`; tool-call IDs, result metadata, status, ordering-visible event shape, and raw receipt links remained intact. This is classified as `MODEL_FACING_FORMAT_OR_WRAPPING` / GLM-5.3 format sensitivity. Structured transformation and truncation were not run because the ladder stopped at the first failing layer.

## Canary ladder

The deterministic task was: read `data/input.txt`, write the exact content to `data/output.txt`, verify it, and report the path. Three sequential live repetitions were used. No fallback or paid call was allowed.

| Layer | Result | Average latency | First-layer finding |
| --- | ---: | ---: | --- |
| `CONTROL` | 3/3 | 32,125 ms | Healthy raw path |
| `IDENTITY` | 3/3 | 31,522 ms | Healthy explicit interposition |
| `ENVELOPE_ONLY` | 2/3 | 31,833 ms | First correctness regression |
| `STRUCTURED_TRANSFORM` | not run | — | Stopped by gate B |
| `TRUNCATED` | not run | — | Stopped by gate B |

The machine-readable, non-secret trace is [the canary evidence JSON](./issue-43-observation-interposition-canary-20260904T071014Z.json).

## Protocol and evidence audit

For all executed interposed runs:

- `tool_call_id`, tool identity, result status, and call/result correlation: preserved.
- Before/after result metadata hash and metadata-key set: unchanged.
- Identity raw-content hash: unchanged before and after the hook.
- Envelope raw-content hash: intentionally changed only in the model-facing output; the raw receipt hash remained unchanged.
- Raw receipts were created and linked to each observed `tool_call_id`; the verifier continued to use the raw receipt.
- The captured event stream retained the expected `step_start → tool_use → step_finish` progression. OpenCode's internal role labels are not exposed by this CLI event stream, so role preservation remains `UNKNOWN`; no role corruption was observed.

No authoritative receipt disappeared in the repaired identity or envelope runs. The prior fabricated-result proxy was therefore a consequence of the pre-init auto-discovery stall producing no adapter receipt, not a verifier-authority loss after successful interposition.

## Timing decomposition

For the repaired interposed runs, the hook measured approximately 37–48 ms of tool execution and 0.42–0.44 ms of adapter/hook work per observed tool result. The provider-resume gap was approximately 4.6–5.2 seconds, and first model event latency was approximately 7.8–14.1 seconds. These figures do not support an adapter latency or retry-loop explanation for the prior 76–82 second adapted rows.

The prior timeout rows stopped before OpenCode initialization. They are classified as a plugin discovery/initialization stall (`SESSION_STATE_STALL` in the bounded timeout taxonomy), not `ADAPTER_TIMEOUT`, `PROVIDER_TIMEOUT`, or `MODEL_TIMEOUT`.

## Minimal change

The live harness now:

- registers the generated adapter explicitly through the temporary project's `plugin` config entry;
- removes reliance on the failing auto-discovered `.opencode/plugins` path;
- supports explicit `IDENTITY`, `ENVELOPE_ONLY`, `STRUCTURED_TRANSFORM`, and `TRUNCATED` canary modes;
- records non-secret fingerprints, metadata keys, call correlation, event sequence, and timing decomposition;
- preserves raw receipts and verifier authority.

No production routing was changed, no profile was promoted, and no factorial rerun was performed.

## Remaining uncertainty

- The exact GLM-5.3 internal reason for the single envelope failure is not observable from OpenCode's JSON event stream. The failure is reproducible as a 2/3 envelope result in the ladder and a separate focused 2/3 envelope reproduction, while identity remained 3/3.
- Structured transformation and truncation are intentionally unqualified after Gate B.
- A dedicated tool-execution-failure ladder was not run after the success-path stop; failure-state adaptation remains a follow-up, not an assumption.
- The observed auto-discovery stall is established for OpenCode 1.18.25 in this runtime and is not generalized to other OpenCode versions or providers.
