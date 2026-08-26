# Issue #33 — Final Summary

Date: 2026-08-26

Primary milestone: `GREEN_OCAE_HIERARCHICAL_MODEL_HARNESS_FOUNDATION_OPERATIONAL`

Research outcome: `MODEL_SPECIFIC_PROFILE_VALUE = NOT_PROVEN`; promoted profiles: `0`.

## Architecture result

The hierarchical model-harness foundation is operational. The canonical
runtime owns model selection, profile resolution, composition, authority,
permissions, retry, routing, cost, terminal decisions, evidence integrity,
and promotion. Resolver and composition fingerprints are deterministic, the
generic fallback is available for unknown models, and worker self-selection
cannot replace the canonical pipeline.

The architecture and product-boundary work is present on canonical master
through PRs [#34](https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem/pull/34)
and [#35](https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem/pull/35).

## Evaluation result

Phase B evaluated two current free models with the frozen generic-vs-candidate
design and recorded zero paid calls/cost:

| Model | Generic | Candidate | Decision |
| --- | ---: | ---: | --- |
| `hy3-free` | 10/10 | 10/10 | `NOT_PROMOTED_NO_VALUE` |
| `nemotron-3-ultra-free` | 9/10 | 6/10 | `REJECTED_FOR_CORRECTNESS` |

Phase C confirmatory evidence used the frozen corpus
`issue-33-confirmatory-corpus.v2` with fingerprint
`e3d2f2d095d6407ea4035bacbc3644027e83b444ccd457937c8306f9725f33b8`.
The locked `hy3.v2` candidate completed 30/30 planned runs: generic and
candidate each achieved 15/15 verified successes. Input context decreased
from 474.2 to 438.6, an effect of 7.51%, below the frozen 10% promotion
threshold. The decision is `B_REJECT_NO_VALUE`.

The hypothesis lock, confirmatory summary, frozen corpus and plan, complete
evidence records, and independent verifier are persisted beside this summary.
The verifier result is `PASS`; failures, if present in a series, remain
retained by contract. No `nemotron.v2` was created.

This is `MODEL_SPECIFIC_VALUE_NOT_PROVEN`, not a harness-system failure. The
evaluation successfully detected both no-value and correctness-regression
outcomes and prevented unsafe promotion.

## Product result

`generic.v1` remains the production/default installable harness and fallback.
Candidate profiles remain development/evaluation-only. There are no changes to
production routing, installer model selection, provider credentials, default
model policy, generic fallback behavior, or automatic promotion.

## Acceptance reconciliation

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| Resolver/composition/authority tests | PASS | Canonical harness and authority test groups; PR #34/#35 gates |
| Deterministic fingerprint | PASS | Harness fingerprint tests and persisted Phase-C fingerprints |
| ≥2 free models evaluated | PASS | [`issue-33-phase-b-value-proof-summary.md`](issue-33-phase-b-value-proof-summary.md) |
| Value or documented neutral/negative result | PASS | Phase-B summary and [`issue-33-phase-c-confirmatory-summary.md`](issue-33-phase-c-confirmatory-summary.md) |
| No regression for promoted profile | N/A — no promoted profile | Promotion count is zero; candidate results are not promoted |
| Paid calls = 0 | PASS | Confirmatory evidence and independent verifier |
| Sentinel / required gates | PASS | `ocae-required`, security review, architecture sentinel, and governance drift gates |
| PR merged | PASS | PRs #34 and #35 are merged into `master` |

## Final disposition

Issue #33 closes as a neutral-result foundation milestone. The foundation is
complete; model-specific optimization value was not proven. No further profile
research, candidate v3, adaptive/self-evolving harness work, or continuous
tuning is started by this closure.

Closure decision: no further harness research is part of this release. Future
work is maintenance-only unless a separately authorized, evidence-backed
product requirement or real defect reopens the topic.
