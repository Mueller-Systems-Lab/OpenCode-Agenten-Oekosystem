# Issue 43 — causal harness factor isolation

## Result

```text
FINAL_CLASSIFICATION=AMBER_OCAE_CAUSAL_EXPERIMENT_BLOCKED_MODEL_UNAVAILABLE
EXPERIMENT_ID=issue-43-causal-factor-isolation-20260903T215623Z
```

The experiment was frozen, but the exact required free model did not pass the
preflight. The preflight timed out before any derivation, holdout, or contract
arm was executed. No provider fallback or paid call was made, so this run has
no causal evidence for H1–H4.

## Reality refresh

The refresh at the start of this run found:

| Item | Observed state |
|---|---|
| Branch | `research/issue-43-empirical-capability-qualification` |
| Start HEAD | `f2a380ec2ab35b820d8d870996b4b710682516ea` |
| Upstream HEAD | same as Start HEAD; no divergence after `git fetch --all --prune` |
| Issue | [#43](https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem/issues/43), open |
| PR | [#44](https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem/pull/44), Draft |
| Review threads | none returned by GitHub API |
| OpenCode | `1.18.25` |
| Provider/model | `opencode/muse-spark-1.2-contributor-free` |
| Paid calls allowed | `0` |
| Fallback | disabled and unused |

The earlier qualification state was re-checked against the local checkout and
GitHub rather than assumed. The required model was catalog-eligible, but the
new live reachability preflight returned `TIMEOUT`, hence
`LIVE_MODEL_REACHABLE=NO` for this experiment.

## Frozen design

The freeze was written before the preflight and is preserved in
[`issue-43-causal-factor-isolation-20260903T215623Z-freeze.json`](./issue-43-causal-factor-isolation-20260903T215623Z-freeze.json).

```text
REPOSITORY_FIXTURE_FINGERPRINT=12272215e468a47112cef98f0062e357b065f1124e39ae96716305f556d88395
DERIVATION_CORPUS_FINGERPRINT=ce63fbc19d2fd7294865d565cd107d4f56130cccc289c774e466005350897db5
HOLDOUT_CORPUS_FINGERPRINT=d3e181571481511ccbbc630b3ed640eb3453b4f0992b3c39c5a5bd74e1159590
TOOL_CONTRACT_FINGERPRINT=ee57effac5f6c2b15dcd431e1b50d1bb82d4dcda23e4602403a9951c34a704de
OBSERVATION_CONTRACT_FINGERPRINT=936593a4920bf93bc51ddd4780775075adfa1a4d88cfbbaceb99dc8ab58f1b91
VERIFIER_VERSION=issue-43-live-verifier.v1
EXECUTION_ORDER_FINGERPRINT=895c5b7b1d09e7b8d18271e325109d677b95b95a4ac0b66de3639093ccf9e018
PRIMARY_PLAN_FINGERPRINT=df2fdaec87ad8737b267241ae294e3248b6c97affe561d06f3a536de8b51d9bd
CONTRACT_PLAN_FINGERPRINT=6e2c33d30e20ac6c187a56069c7a90f770ff388f2e8c24dd7b9faa84c44244fe
TIMEOUT_MS=90000
RETRY_BUDGET=0
```

The deterministic counterbalanced schedule contains 180 frozen rows. Primary
arms were planned at 18 derivation and 12 holdout observations per arm. The
contract sub-experiment was planned at two repetitions. The runner's maximum
of three repetitions and the provider/runtime budget limited the derivation
target below the aspirational 20-per-arm target; the holdout target was met in
the frozen plan.

Primary arms:

| Arm | Tool exposure | Contract framing | Observation |
|---|---|---|---|
| A | full/generic | baseline | raw/baseline |
| B | task-minimal | baseline | raw/baseline |
| C | full/generic | baseline | deterministic adapted |
| D | task-minimal | baseline | deterministic adapted |

The separate contract arms were full/generic exposure, raw observation, and
`BASELINE`, `SHORT_EXPLICIT`, or `EXAMPLE_ASSISTED` framing respectively.
No treatment was changed after the preflight result.

## Implementation required to make the factors isolatable

Only experimental-correctness blockers were addressed:

- qualification plans now accept arbitrary frozen arm identifiers, allowing
  A–D and the independent contract arms;
- exposure arms write both permission policy and the legacy model-facing tool
  map, so the minimal arm actually hides tools rather than merely denying
  execution;
- contract framing is a deterministic prompt factor with three frozen levels;
- the live executor records argument diagnostics and structural load metrics;
- live adapted arms use a project-local OpenCode `tool.execute.after` plugin
  seam, which transforms the tool result before the next model step while
  retaining the raw receipt;
- bounded concurrency (`1..2`) preserves frozen record order, and timeout
  handling kills the process group and resolves promptly.

Focused regression tests cover the arm contract, contract framing, raw-view
authority, bounded ordering, and timeout cleanup. No target repository layout,
provider/model routing, verifier authority, or production profile was changed.

## Live evidence

```text
PREFLIGHT_MODEL_REACHABLE=NO
PREFLIGHT_FAILURE_CLASS=TIMEOUT
DERIVATION_ROWS_EXECUTED=0
HOLDOUT_ROWS_EXECUTED=0
CONTRACT_ROWS_EXECUTED=0
PAID_CALLS=0
FALLBACK_USED=NO
```

Consequently, every arm metric is `NOT RUN` and no effect estimate is valid:

```text
TOOL_EXPOSURE_EFFECT=NOT_ESTIMABLE
OBSERVATION_ADAPTATION_EFFECT=NOT_ESTIMABLE
COMBINED_EFFECT=NOT_ESTIMABLE
OBSERVATION_EFFECT_UNDER_MINIMAL_TOOLS=NOT_ESTIMABLE
TOOL_EXPOSURE_EFFECT_UNDER_ADAPTED_OBSERVATIONS=NOT_ESTIMABLE
```

For the same reason:

```text
TOOL_CONTRACT_BASELINE_ARGUMENT_VALIDITY=NOT_RUN
TOOL_CONTRACT_SHORT_EXPLICIT_ARGUMENT_VALIDITY=NOT_RUN
TOOL_CONTRACT_EXAMPLE_ASSISTED_ARGUMENT_VALIDITY=NOT_RUN
BEST_TOOL_CONTRACT=NONE
HOLDOUT_A=0/0
HOLDOUT_B=0/0
HOLDOUT_C=0/0
HOLDOUT_D=0/0
HOLDOUT_CONFIRMATION=NOT_RUN_MODEL_UNAVAILABLE
BEST_RESEARCH_ARM=NONE
```

### Observation interposition status

The code path is wired to the OpenCode `tool.execute.after` lifecycle and local
contract tests verify that raw observations remain authoritative. However, no
adapted live arm reached a tool call in this experiment, so live interposition
cannot be claimed:

```text
GENUINE_LIVE_OBSERVATION_INTERPOSITION=NO
RAW_OBSERVATION_FINGERPRINTING=FAIL
MODEL_FACING_OBSERVATION_FINGERPRINTING=FAIL
VERIFIER_RAW_AUTHORITY=PASS
```

`PASS` for verifier authority is a structural contract result, not a live
qualification result. The intended live trace will record raw and model-facing
fingerprints, adapter identity/version, lossiness, truncation, provenance, and
tool-call ID for every adapted observation.

## Gates and limitations

The architecture sentinel, security review, governance-drift check, secret
scan, documentation validation, focused harness tests, and `git diff --check`
passed. An initial concurrent full-suite invocation had one transient
integration failure; the affected post-merge test was rerun in isolation and
passed (`1282/1282`, two supported skips). The complete suite was then rerun
serially after this report was added and passed (`1327/1327`, no skips).

```text
CORRECTNESS_REGRESSION=NO
SECURITY_REGRESSION=NO
PROMOTED_PROFILE=NONE
PROMOTION_DECISION=MODEL_UNAVAILABLE
EVIDENCE_STRENGTH=LIMITED_BY_PROVIDER_OR_RUNTIME
```

No correctness or security regression was observed in local gates; live
treatment correctness was not assessed because no treatment ran. This report
does not overwrite the earlier live qualification report.

## Required final record

```text
FINAL_CLASSIFICATION=AMBER_OCAE_CAUSAL_EXPERIMENT_BLOCKED_MODEL_UNAVAILABLE
START_HEAD=f2a380ec2ab35b820d8d870996b4b710682516ea
FINAL_HEAD=ff6f13f051fb10b4f3ccd94e4b202e76f54b5f35
BRANCH=research/issue-43-empirical-capability-qualification
ISSUE=43
PR=44
OPENCODE_VERSION=1.18.25
LIVE_MODEL_PROVIDER=opencode
LIVE_MODEL=muse-spark-1.2-contributor-free
LIVE_MODEL_REACHABLE=NO
PAID_CALLS=0
FALLBACK_USED=NO
ARM_A_RUNS=0
ARM_A_VERIFIED_SUCCESS=0/0
ARM_A_ARGUMENT_VALIDITY=NOT_RUN
ARM_A_OBSERVATION_COMPREHENSION=NOT_RUN
ARM_A_TOOL_CALLS=0
ARM_A_INPUT_CONTEXT=NOT_RUN
ARM_A_TOOL_RESULT_VOLUME=NOT_RUN
ARM_A_LATENCY_AVG_MS=NOT_RUN
ARM_B_RUNS=0
ARM_B_VERIFIED_SUCCESS=0/0
ARM_B_ARGUMENT_VALIDITY=NOT_RUN
ARM_B_OBSERVATION_COMPREHENSION=NOT_RUN
ARM_B_TOOL_CALLS=0
ARM_B_INPUT_CONTEXT=NOT_RUN
ARM_B_TOOL_RESULT_VOLUME=NOT_RUN
ARM_B_LATENCY_AVG_MS=NOT_RUN
ARM_C_RUNS=0
ARM_C_VERIFIED_SUCCESS=0/0
ARM_C_ARGUMENT_VALIDITY=NOT_RUN
ARM_C_OBSERVATION_COMPREHENSION=NOT_RUN
ARM_C_TOOL_CALLS=0
ARM_C_INPUT_CONTEXT=NOT_RUN
ARM_C_TOOL_RESULT_VOLUME=NOT_RUN
ARM_C_LATENCY_AVG_MS=NOT_RUN
ARM_D_RUNS=0
ARM_D_VERIFIED_SUCCESS=0/0
ARM_D_ARGUMENT_VALIDITY=NOT_RUN
ARM_D_OBSERVATION_COMPREHENSION=NOT_RUN
ARM_D_TOOL_CALLS=0
ARM_D_INPUT_CONTEXT=NOT_RUN
ARM_D_TOOL_RESULT_VOLUME=NOT_RUN
ARM_D_LATENCY_AVG_MS=NOT_RUN
TOOL_CONTRACT_BASELINE_ARGUMENT_VALIDITY=NOT_RUN
TOOL_CONTRACT_SHORT_EXPLICIT_ARGUMENT_VALIDITY=NOT_RUN
TOOL_CONTRACT_EXAMPLE_ASSISTED_ARGUMENT_VALIDITY=NOT_RUN
BEST_TOOL_CONTRACT=NONE
GENUINE_LIVE_OBSERVATION_INTERPOSITION=NO
RAW_OBSERVATION_FINGERPRINTING=FAIL
MODEL_FACING_OBSERVATION_FINGERPRINTING=FAIL
VERIFIER_RAW_AUTHORITY=PASS
HOLDOUT_A=0/0
HOLDOUT_B=0/0
HOLDOUT_C=0/0
HOLDOUT_D=0/0
HOLDOUT_CONFIRMATION=NOT_RUN_MODEL_UNAVAILABLE
CORRECTNESS_REGRESSION=NO
SECURITY_REGRESSION=NO
BEST_RESEARCH_ARM=NONE
MEASURABLE_TOOL_EXPOSURE_VALUE=INSUFFICIENT
MEASURABLE_OBSERVATION_ADAPTATION_VALUE=INSUFFICIENT
MEASURABLE_TOOL_CONTRACT_VALUE=INSUFFICIENT
MEASURABLE_COMBINED_VALUE=INSUFFICIENT
PROMOTED_PROFILE=NONE
PROMOTION_DECISION=MODEL_UNAVAILABLE
TEST_FILES=99
TESTS=1327/1327
FAILURES=0
SKIPS=0
ARCHITECTURE_SENTINEL=PASS
SECURITY_REVIEW=PASS
GOVERNANCE_DRIFT=PASS
SECRET_SCAN=PASS
GIT_DIFF_CHECK=PASS
```

## Live blockers

- Required model preflight timed out before the first live row; no causal arm
  or holdout evidence exists.
- GitHub push and external comment actions were blocked by the local bootstrap
  governance gate because this checkout had no valid Task Capsule. The
  attempted actions were fail-closed and did not transmit commits.

## Research findings

- No individual transformation can be credited or rejected from this run.
- The experiment infrastructure now separates exposure, contract framing, and
  observation adaptation, and preserves raw verifier authority, but that
  separation is not a model-performance result.
- No profile was promoted.

## Next highest-value step

Run the preserved frozen plan when the exact required model passes preflight,
then compute the five planned contrasts and contract-arm argument-validity
comparison. Any treatment change requires a new experiment ID, freeze, and
untouched holdout.

## Next highest-value step

Re-run this exact frozen experiment when
`opencode/muse-spark-1.2-contributor-free` passes the preflight. Do not change
the arms, corpora, adapter, or contract framing and do not reuse a holdout
after any treatment modification; a changed treatment requires a new
experiment ID and a new freeze.
