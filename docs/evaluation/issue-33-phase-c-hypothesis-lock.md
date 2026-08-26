# Issue #33 Phase C — HY3 Mechanism Analysis and Candidate Lock

Status before implementation: `HYPOTHESIS_FORMULATED_NOT_LOCKED`

## Evidence basis

The Phase-B development/diagnostic dataset is
`issue-33-corpus.v1`, fingerprint
`217693f623ba4f0d197ae58107ee98a017a37f434c5142be0bd1797d56e723d7`.
It is not a confirmatory holdout.

For HY3, the observed input-context deltas exactly match the deterministic
static renderer deltas for every case:

| Case | Role | Static delta | Observed delta |
| --- | --- | ---: | ---: |
| isolated-bugfix | BUILD | +276 | +276 |
| multi-file-change | PLAN | +216 | +216 |
| structured-output-exactness | REVIEW | +276 | +276 |
| tool-minimal-artifact | TOOL_USE | +276 | +276 |
| controlled-retry | RESEARCH | +203 | +203 |

Phase-B also recorded zero tool calls, zero tool-result volume, and zero
retries for HY3 in both arms. The current renderer only emits prompt text;
`SUMMARIZE` and compression hints do not invoke a compression or truncation
mechanism.

## HY3 attribution

`HY3_CONTEXT_DELTA_ATTRIBUTION=STATIC_PROFILE_OVERHEAD`

- generic base context: unchanged;
- model-profile overhead: three compression hints, `SUMMARIZE` result hint,
  concise/alternate framing, and the renderer's implicitly activated compact
  planning output;
- task-role overlay: retained in both arms and not the cause of the delta;
- tool presentation: unchanged `FULL_TOOLSET` and zero observed tool calls;
- result formatting: no measured result-volume reduction;
- compression/truncation: declarative only, never activated by this harness;
- repeated instructions: profile directives are appended to the composed text
  and cost more than the claimed savings.

## Candidate V2 hypothesis

`HY3_V2_HYPOTHESIS=Remove static profile overhead; retain only compact framing
that is cheaper than generic and do not claim compression/truncation unless a
runtime mechanism actually performs it.`

`MECHANISM=The v2 profile removes all compression hints, SUMMARIZE/truncation
claims, and compact planning directives (including the renderer's implicit
CONCISE→COMPACT conversion). It keeps the shared task-role overlay,
canonical tool exposure, standard output contract, and standard instruction
order. Concise framing is retained only as a measured low-overhead rendering
choice.`

`EXPECTED_EFFECT=Lower input-context volume than generic on new cases, with no
change to tool calls, permissions, routing, retries, or verifier semantics.`

`CORRECTNESS_RISK=LOW_TO_MEDIUM`: removing advisory scaffolding could reduce
task adherence; any verified-success regression rejects the candidate.

## Verification contract

- Candidate implementation: development/evaluation-only `hy3.v2`.
- Promotion policy: existing frozen `issue-33-promotion.v2`; no threshold
  changes. For context volume, lower is better, at least two complete pairs
  are required, and verified success may not regress.
- Red test: v2 must resolve as `hy3.v2`, contain no compression/truncation
  directives, and produce a shorter composed context than generic for every
  supported role in the diagnostic corpus.
- Regression tests: resolver fallback, authority, composition, fingerprint,
  evaluation integrity, and full existing harness test groups.
- Holdout contract: an independent agent creates new cases for the same five
  product classes after this candidate is locked. The corpus fingerprint and
  promotion policy are frozen before any live call.
- Product boundary: no installer, routing, provider credential, or product
  profile promotion change.

## Lock record

Status: `CANDIDATE_LOCKED=TRUE`

Lock timestamp: `2026-08-26`

Locked implementation: `hy3.v2`, development/evaluation-only, with effective
fingerprints by task role:

```text
BUILD=509ed3d5f098eedcc63c4b91967057431770774be37aca41a9c5865c9c4e1687
PLAN=47006a32ead095f3bdb136b6883c259660cf10dfc6651d6478d9e16e0148ed0d
REVIEW=d98205cbf1dc23fa27569f7e10c3d68e7cb64197e50ab15a80098fec74cd696c
TOOL_USE=b64e6635ca5f6a0c1f98518adc5e4bf7d318f50434bf032de271f3af191627ee
RESEARCH=c56f999efbee7c3e8bef00dda6d527629df17e1a0b3dc5859ca073b37218d745
```

The implementation and focused regression tests pass. The existing frozen
promotion policy remains unchanged and is locked for the confirmatory series.

Nemotron remains `REJECTED_FOR_CORRECTNESS`; no `nemotron.v2` is authorized
without a new root-cause proof. A second model-specific v2 profile is deferred
because the existing evidence shows no generic weakness for Muse or another
replacement candidate.
