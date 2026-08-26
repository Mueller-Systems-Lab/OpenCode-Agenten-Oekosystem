# Issue #33 Phase-C Confirmatory Summary

## Result

`AMBER_OCAE_MODEL_HARNESS_FOUNDATION_IMPLEMENTED_VALUE_NOT_PROVEN`

HY3 v2 passed the independent holdout correctness gate but did not pass the
frozen efficiency promotion gate. Generic and candidate both achieved 15/15
verified successes across 15 paired cases. Mean input context was 474.2 for
generic and 438.6 for candidate, an effect of `0.0750738085` (7.51%), below
the unchanged `0.1` threshold in `issue-33-promotion.v2`.

No profile was promoted. `generic.v1` remains the product default and the v2
profile remains evaluation-only.

## Frozen causal design

- Candidate: `hy3.v2`, locked before holdout creation.
- Holdout: `issue-33-confirmatory-corpus.v2`, fingerprint
  `e3d2f2d095d6407ea4035bacbc3644027e83b444ccd457937c8306f9725f33b8`.
- Corpus: five new cases covering tool selection, multi-step, code/build,
  review/reasoning, and context-heavy work.
- Repetitions: 3; planned/completed runs: 30/30.
- Promotion policy: `issue-33-promotion.v2`, frozen before live execution.
- Paid calls/cost: `0 / 0`.
- Failed records: retained; this series had no runtime failures.

Per-case mean context deltas (generic minus candidate) were:

| Case | Generic | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| tool-selection-new | 438 | 434 | 4 |
| multi-step-new | 532 | 430 | 102 |
| code-build-new | 393 | 389 | 4 |
| review-reasoning-new | 536 | 532 | 4 |
| context-heavy-new | 472 | 408 | 64 |

The independent verifier separately confirmed lock ordering, holdout
independence, freeze state, pair completeness, failure retention, zero paid
effects, preserved product boundary, and absence of promotion.

## Disposition

The HY3 v2 hypothesis is not promoted. Nemotron remains frozen and rejected
for its Phase-B correctness regression; no Nemotron v2 was created. A second
model-specific v2 candidate remains deferred because no independent generic
weakness was established for another free model.

The issue contract and acceptance criteria are unchanged. Issue #33 remains
open for an explicit owner decision between further research and a neutral
result foundation scope. No installer, routing, provider credential, or
candidate auto-install change was made.
