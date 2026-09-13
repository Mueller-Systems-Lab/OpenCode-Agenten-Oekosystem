# Issue 43 — Canonical Model Transport Architecture Audit

Date: 2026-09-04

## Result

The pre-change repository state was classified as:

```text
C) CURRENT_LIVE_QUALIFICATION_BYPASSES_CANONICAL_ADAPTER
```

`runtime/harness/live-qualification.mjs` directly constructed the OpenCode CLI
model selector and had only the older provider-executor marker. The installed
OpenCode runtime was separately observed as `1.18.27`; its live debug output
resolved `providerID=opencode`, `modelID=big-pickle`, and `llm.runtime=ai-sdk`.

The current OCAE state is:

```text
TRANSPORT_ARCHITECTURE_CLASSIFICATION=OPENAI_COMPATIBLE_TRANSPORT_ALREADY_CANONICAL
HOST_TRANSPORT=OPENCODE
MODEL_TRANSPORT=OPENAI_COMPATIBLE_ADAPTER
MODEL_TRANSPORT_CONTRACT_ID=ocae.openai-compatible-model-transport.v1
MODEL_TRANSPORT_CONTRACT_VERSION=1.0.0
```

The adapter is provider-neutral. Provider packages, endpoint conversion,
credentials, retries, and host/session mechanics remain outside OCAE core.

## Runtime facts

| Fact | Evidence |
|---|---|
| OpenCode model selection | `opencode --help` documents `--model provider/model`; `opencode models` lists provider/model IDs |
| Custom OpenAI-compatible host adapter | installed Z.AI config uses `npm: @ai-sdk/openai-compatible` and an environment secret reference |
| Chat surface | Z.AI configuration points at its `/v4` OpenAI-compatible base; the OpenCode provider documentation maps `@ai-sdk/openai-compatible` to Chat Completions |
| Free surface | live debug probe succeeded through OpenCode `ai-sdk`; endpoint family is retained as `UNKNOWN` until directly exposed by the runtime |
| OCAE direct SDK/schema dependency | none in the canonical harness transport module or verifier path |

## Gates

- `OPENAI_COMPATIBLE_ADAPTER_CONFORMANCE=PASS` is deterministic and model-quality independent.
- GLM-5.3 Flash and free-model qualification runners construct the same contract-bound OpenCode adapter.
- `MODEL_TRANSPORT_FINGERPRINT` is part of qualification identity and plan fingerprints.
- Provider-specific verifier semantics and raw-observation authority remain forbidden to change.
- The portability gate is available as the one-request
  `scripts/run-issue-43-transport-portability-canary.mjs` runner. It requires
  explicit `OCAE_PORTABILITY_PROVIDER` and `OCAE_PORTABILITY_MODEL` values and
  performs no model optimization.
- Cross-provider portability remains `NOT_RUN` until GLM calibration and the separate canary execute.
