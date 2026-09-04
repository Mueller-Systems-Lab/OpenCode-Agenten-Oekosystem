# Issue #43 — Free-model observation-interposition qualification

## Frozen identity

- Experiment: `issue-43-free-model-observation-canary-opencode-big-pickle-20260904T121500Z`
- Provider/model: `opencode/big-pickle`
- Display name: `Big Pickle`
- OpenCode: `1.18.27`
- Selection: candidate `1`; zero-cost path `PASS`
- Selected inventory/model identity fingerprint: `c81fbf3860567cff076896250d02f60a73a84e8e9c5808c2dbd338034ddbf540`
- Model selection lock: `YES`
- Candidate evidence: [preflight matrix](issue-43-free-model-preflight-matrix-big-pickle-20260904T121500Z.md)
- Run evidence: [machine-readable experiment report](issue-43-free-model-observation-interposition-big-pickle-20260904T121500Z.json)
- Freeze evidence: [experiment freeze](issue-43-free-model-observation-canary-attempt-20260904T121552Z-freeze.json)

## Selection result

The current OpenCode verbose inventory contained 41 zero-cost candidates; 35
were eligible after excluding DeepSeek and six explicitly non-tool models.
Candidates were preserved in current inventory order. Candidate 1 passed the
single bounded primary preflight with exact provider/model identity, normal
completion, one successful `read` interaction, zero observed cost, DEBUG logs,
and no target/provider fallback. Search stopped immediately; no later
candidate was called.

## Experiment result

The explicit project plugin registration path was used. The adapter module
loaded (`adapter_loaded`), but the plugin-init probe did not satisfy the exact
`PLUGIN_INIT_OK` completion contract. Per the stop rule, the run stopped at
`FIRST_FAILING_STAGE=PLUGIN_INIT`.

Consequently:

- `CONTROL_0`: `NOT_RUN`
- `CANARY_1_IDENTITY`: `NOT_RUN`
- `CANARY_2_ENVELOPE`: `NOT_RUN`
- Envelope regression: `INSUFFICIENT`
- Raw/model-facing receipt authority gates: `NOT_RUN`
- `PROMOTED_PROFILE`: `NONE`
- Target model switch/fallback: not observed
- Auxiliary model: not observed in the selected run evidence

This result does not attribute the plugin-init failure to model quality and
does not support a claim about Envelope-only correctness on this model.

## Exact serialization and lifecycle differential

Not run because no valid Identity or Envelope canary exists. The sanitized
plugin-init DEBUG trace records session creation, plugin loading evidence, the
exact target model, and session disposal; it does not expose the internal
provider message-role payload boundary. No serialization differential is
inferred.

## Classification

`AMBER_OCAE_FREE_MODEL_OBSERVATION_EVIDENCE_INSUFFICIENT`

## Validation

- Full canonical suite: `98/98` files; `1290` tests; `1288` passed; `0` failed; `2` skipped; exit `0`.
- Focused harness test: `25/25` passed.
- Documentation validation: `PASS`.
- Architecture/production sentinel: `PASS`.
- Governance drift: `PASS`.
- Security adversarial wrapper: `NEEDS_REVIEW_AI_TOOL_RECOVERY` (exit `1`), with `adversarial_security_result=VERIFIED_IN_SCOPE`, zero secret bytes/transcript/log values, and zero remote writes.
- `git diff --check`: `PASS` after final edits.
- DEBUG artifacts are sanitized; raw secret-bearing logs are not persisted (`DEBUG_LOG_SECRET_SCAN=PASS`).

## Required machine-readable handoff

```text
FINAL_CLASSIFICATION=AMBER_OCAE_FREE_MODEL_OBSERVATION_EVIDENCE_INSUFFICIENT
START_HEAD=cac482b3af2ab9937274f6ed7543a664ca642108
FINAL_HEAD=2cae23e
BRANCH=research/issue-43-empirical-capability-qualification
ISSUE=43
PR=44
OPENCODE_VERSION=1.18.27
FREE_MODEL_CANDIDATES_DISCOVERED=41
FREE_MODEL_CANDIDATES_ELIGIBLE=35
FREE_MODEL_CANDIDATE_LIST_FINGERPRINT=c5ad494ae17617fc3c1adc2546239108695687d7ba6e60da2e61ad997088a7da
FREE_MODEL_SELECTION_ORDER_FINGERPRINT=81f644272ee941463ec7633e14dc6d9bb041264213da2ca8b164a9f8699555d8
FREE_MODEL_PREFLIGHT_ATTEMPTS=1
FREE_MODEL_PREFLIGHT_MATRIX:
1. opencode/big-pickle -> PASS
2-41. NOT_ATTEMPTED_AFTER_FIRST_SUCCESS
SELECTED_CANDIDATE_INDEX=1
SELECTED_PROVIDER=opencode
SELECTED_MODEL=big-pickle
SELECTED_DISPLAY_NAME=Big Pickle
SELECTED_ZERO_COST_PATH=PASS
SELECTED_MODEL_REACHABLE=YES
MODEL_SELECTION_LOCKED=YES
TARGET_MODEL_SWITCH_USED=NO
TARGET_MODEL_FALLBACK_USED=NO
TARGET_PROVIDER_FALLBACK_USED=NO
AUXILIARY_MODEL_USED=NO
AUXILIARY_MODEL_PROVIDER=NONE
AUXILIARY_MODEL=NONE
AUXILIARY_MODEL_PURPOSE=NONE
OPENCODE_PRINT_LOGS_SUPPORTED=YES
OPENCODE_DEBUG_LOG_LEVEL_SUPPORTED=YES
DEBUG_LOGGING_ENABLED=YES
DEBUG_LOG_SECRET_SCAN=PASS
PLUGIN_REGISTRATION_MODE=EXPLICIT_PROJECT_PLUGIN
PLUGIN_INITIALIZATION=FAIL
EXPERIMENT_ID=issue-43-free-model-observation-canary-opencode-big-pickle-20260904T121500Z
CONTROL_0_RUNS=0
CONTROL_0_VERIFIED_SUCCESS=0/0
CANARY_1_IDENTITY_RUNS=0
CANARY_1_IDENTITY_VERIFIED_SUCCESS=0/0
CANARY_2_ENVELOPE_RUNS=0
CANARY_2_ENVELOPE_VERIFIED_SUCCESS=0/0
FIRST_FAILING_STAGE=PLUGIN_INIT
RAW_OBSERVATION_FINGERPRINTING=NOT_RUN
MODEL_FACING_OBSERVATION_FINGERPRINTING=NOT_RUN
CALL_RESULT_CORRELATION=NOT_RUN
RAW_RECEIPT_PROPAGATION=NOT_RUN
VERIFIER_RAW_AUTHORITY=NOT_RUN
MESSAGE_ROLE_PRESERVED=UNOBSERVABLE
MESSAGE_ORDER_PRESERVED=NOT_RUN
ENVELOPE_REGRESSION=INSUFFICIENT
CROSS_MODEL_COMPARISON=CROSS_MODEL_DESCRIPTIVE_ONLY
PROMOTED_PROFILE=NONE
TEST_FILES=98
TESTS=1288/1290
FAILURES=0
SKIPS=2
ARCHITECTURE_SENTINEL=PASS
SECURITY_REVIEW=FAIL
GOVERNANCE_DRIFT=PASS
SECRET_SCAN=PASS
GIT_DIFF_CHECK=PASS
```

## Remaining uncertainty

- The selected model reached the normal tool preflight but did not complete the
  exact plugin-init probe, so the observation interposition path remains
  unqualified.
- No conclusion can be drawn about Control, Identity, or Envelope correctness.
- Cross-model comparison is descriptive only; no new model benchmark exists.

## Next highest-value step

Diagnose the explicit plugin-init contract with a new experiment identity or a
separately authorized harness probe. Do not continue this frozen experiment,
switch the target model, promote a profile, or retry the failed measured run.

## Repair attempt and frozen-track outcome

The frozen experiment identity and all three treatment fingerprints were
preserved. The new immutable attempt is recorded in
`issue-43-free-model-observation-canary-attempt-20260904T133743Z.json`.

The plugin-init root cause is proven as `STRICT_INIT_TEST_BUG`: the historical
predicate coupled host/plugin readiness to exact model text even though the
historical response and adapter load succeeded. OpenCode 1.18.27 contract
comparison found no plugin API drift. Host-owned module, context, factory, and
before/after-hook evidence now passes; the full analysis is in
`issue-43-big-pickle-plugin-initialization-root-cause.md`.

The locked Big Pickle security reproduction is `VERIFIED_IN_SCOPE`; the prior
wrapper review state is classified as incomplete recovery evidence, not a
security-authority failure. The canonical current suite is `100/100` files,
`1335/1335` tests, zero failures, and zero skips.

After the repaired pre-experiment gates passed, CONTROL ran for five runs and
produced `3/5` verified successes. The two failures were
`VERIFIER_REJECTION`; the required stop rule therefore set
`FIRST_FAILING_STAGE=CONTROL`, and Identity/Envelope were not run. The current
classification is `AMBER_OCAE_BIG_PICKLE_CONTROL_UNSTABLE` and no profile was
promoted.
