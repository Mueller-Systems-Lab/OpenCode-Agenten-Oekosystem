# Issue #33 Phase-B Value Proof

Status: `AMBER_OCAE_MODEL_HARNESS_FOUNDATION_IMPLEMENTED_VALUE_NOT_PROVEN`

This is the canonical summary for the fresh causal series written on 2026-08-25.
The raw run records remain local evidence under
`docs/evaluation/issue-33-phase-b-20260825T185000Z/` and are not product
artifacts.

## Frozen contract

- Series: `issue-33-live-series-v1`
- Corpus: `issue-33-corpus.v1`
- Corpus fingerprint: `217693f623ba4f0d197ae58107ee98a017a37f434c5142be0bd1797d56e723d7`
- Cases: 5; repetitions: 2; variants: `generic` and `candidate`
- Planned and completed runs: 40 / 40
- Promotion policy: `issue-33-promotion.v2`, criteria frozen before live calls
- Models: `opencode/hy3-free`, `opencode/nemotron-3-ultra-free`
- Provider transport: OpenCode host free transport; both probes callable
- Paid model calls: 0; paid cost: 0
- Independent persisted-record review: `PASS`

## Paired results

| Model | Generic verified | Candidate verified | Tool Δ | Context Δ | Tool-result Δ | Retry Δ | Runtime failure Δ | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `hy3-free` | 10/10 | 10/10 | 0 | +249.4 | 0 | 0 | 0 | `B_REJECT_NO_VALUE` |
| `nemotron-3-ultra-free` | 9/10 | 6/10 | 0 | +414.36 | 0 | 0 | +0.2 | `E_BLOCKED_NO_LIVE_EVIDENCE` |

The HY3 candidate preserved correctness but increased average input context
volume from 388.2 to 637.6, so its efficiency hypothesis was not proven. The
Nemotron candidate had a `TIMEOUT` and an `INVALID_OUTPUT`, producing a
verified-success regression; it is not promotable under the frozen policy.

## Product decision

- Promoted profiles: none
- Candidate profiles: remain development/evaluation-only
- `generic.v1`: unchanged and remains the installable default fallback
- Installer/product manifest: unchanged; no candidate was accidentally shipped
- Provider credentials: not copied, logged, or installed
- Issue #33: remains open because its required promoted-profile value proof was
  not achieved

The harness foundation is operational and the live evidence is integrity-valid,
but no model-specific optimization passed the correctness-first promotion rule.
