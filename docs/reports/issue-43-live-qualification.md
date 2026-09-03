# Issue #43 — First live adaptive-harness qualification

Run date: 2026-09-03. Evidence artifact:
[`issue-43-live-qualification-20260903T1854Z-control-fix.json`](issue-43-live-qualification-20260903T1854Z-control-fix.json).

## Result

The selected current zero-cost hosted model was `opencode/muse-spark-1.2-contributor-free`
on OpenCode `1.18.25`. It passed the canonical preflight and a real read/write
tool-use probe with reported cost `0`, no fallback, and exact provider/model
identity. Both A/B arms used that same provider, model, host, frozen fixtures,
grants, verifier, retry budget (`0`), and timeout (`90s`). Primary model
switching and provider fallback were disabled.

The existing deterministic `muse.v1` candidate was used without post-observation
tuning. The first exploratory artifact
(`issue-43-live-qualification-20260903T184612Z.json`) is retained but excluded:
the candidate permission boundary was not enforced by the initial live seam, so
that run was not a valid causal comparison. The corrected run used per-fixture
OpenCode permission configuration and is the only result used below.

## Frozen identities

| Item | Fingerprint / version |
|---|---|
| Derivation corpus | `ce63fbc19d2fd7294865d565cd107d4f56130cccc289c774e466005350897db5` |
| Confirmatory holdout | `d3e181571481511ccbbc630b3ed640eb3453b4f0992b3c39c5a5bd74e1159590` |
| Generic harness | `ccbfe49d4e6f860dc1718aa3dd15102d3c742132f93ea93641a1b06d65a4f034` |
| Candidate harness | `08437194efd028fffa0ba33400d96f5395906e3485275f6a5223d75185913fbf` (`muse.v1`) |
| Verifier | `issue-43-live-verifier.v1` |
| Tool contract | `5dd7e55ea752a1030554f41a6669cc9b9d06328ffdb4856a46491383db361006` |
| Observation contract | `35602a159fd2946214d8a084ebedc6e6f6f9888d3d96696382bc755bf7634d74` |
| Plan | `244d653892ec72fc2fbf5ed7d7cf013847508ede7375e39fba025bf3080f3bc6` |

Execution was deterministically counterbalanced per case. The corrected sequence
is persisted in the JSON artifact; it alternates candidate-first and
generic-first across adjacent case pairs rather than using one fixed arm order.

## A/B measurements

Counts are shown as successes/samples where applicable; volumes are character
counts and latency is the arithmetic mean per run.

| Measure | Generic derivation (n=6) | Candidate derivation (n=6) | Generic holdout (n=4) | Candidate holdout (n=4) |
|---|---:|---:|---:|---:|
| Verified success | 6/6 | 6/6 | 3/4 | 3/4 |
| Tool selection | 6/6 | 6/6 | 4/4 | 4/4 |
| Tool argument validity | 4/6 | 6/6 | 3/4 | 1/4 |
| Required tool used | 6/6 | 6/6 | 4/4 | 4/4 |
| Observation comprehension | 6/6 | 6/6 | 3/4 | 2/4 |
| Fabricated results | 0 | 0 | 0 | 0 |
| Tool calls | 27 (4.50/run) | 14 (2.33/run) | 13 (3.25/run) | 13 (3.25/run) |
| Unnecessary tool calls | 9 (1.50/run) | 0 (0/run) | 6 (1.50/run) | 0 (0/run) |
| Invalid tool calls | 3 (0.50/run) | 0 (0/run) | 1 (0.25/run) | 3 (0.75/run) |
| Context volume | 1,699 | 4,021 | 1,246 | 2,794 |
| Raw tool-result volume | 7,559 | 4,711 | 2,527 | 1,712 |
| Retries | 0 | 0 | 0 | 0 |
| Mean latency | 14,849.5 ms | 12,512.5 ms | 11,873.75 ms | 13,839.25 ms |

Across all ten runs per arm, verified success was `9/10` for both arms,
observation comprehension was `9/10` generic versus `8/10` candidate, tool
argument validity was `7/10` versus `7/10`, fabricated results were `0` versus
`0`, raw tool-result volume was `10,086` versus `6,423`, and mean latency was
`13,659.2 ms` versus `13,043.2 ms`. The candidate therefore showed directional
efficiency improvement in this small sample, but no verified-success gain and
worse holdout observation comprehension and argument validity.

Holdout confirmation was `3/4` versus `3/4`: no paired candidate wins and no
paired candidate losses. This is not enough evidence to establish generalizable
adaptive value or statistical significance, so `muse.v1` was not promoted.

## Observation and security controls

The retained rows include raw observation receipts, derived model-facing
metadata, explicit lossiness/truncation fields, preserved raw fingerprints,
verifier results, failure classes, tool records, and bounded volumes. The
artifact reports all six observation-validation checks as passing. The verifier
uses the authoritative fixture state and raw receipt path; fabricated-result
count was zero in both arms.

The live CLI natively delivered tool observations to the model. The recorded
adapter view proves receipt derivation and provenance accounting, but this run
does not by itself prove a fully interposed OCAE observation adapter replacing
the host's native model-facing tool message. Existing deterministic tests cover
prompt-injection containment, stale/contract handling, parallel correlation,
compaction awareness, and model-switch rehydration. No live row expanded scope,
grants, approvals, routing, or reported success through untrusted content.

## Blocker and minimal fix

The live blocker was that the qualification runner accepted only deterministic
fixture executors and did not retain the live identity, receipts, or measured
volumes needed for a causal run. The minimal fix added an explicitly marked,
exact-identity canonical-live seam, bounded evidence retention, and deterministic
counterbalancing. A targeted test covers the authorization/identity seam and
native event parsing; the corrected run also exposed and fixed the missing
per-fixture permission boundary before its results were accepted.

## Decision

`FINAL_CLASSIFICATION=AMBER_OCAE_LIVE_EVIDENCE_INSUFFICIENT`

`PROMOTION_DECISION=INSUFFICIENT_LIVE_EVIDENCE`. The run proves current free-model
reachability and live tool use, and gives a reproducible first controlled result,
but does not prove adaptive-harness value. The highest-value next step is a
larger repeated holdout using the same frozen protocol, plus a genuinely
interposed model-facing observation path if Issue #43 is intended to measure
OCAE adaptation rather than host-native observation handling.
