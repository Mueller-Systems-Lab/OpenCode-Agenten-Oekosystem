# Plan Amendment — Tool Observation Qualification and Rehydration

Issue: **#43**  
Extends: `docs/plans/empirical-model-capability-qualification-plan.md`

## Objective

Extend the Issue #43 implementation plan so qualification covers not only tool selection/arguments but also how a concrete model understands tool results over time, across compaction and across authorized model escalation.

## Phase B9 — Observation comprehension fixtures

Add deterministic fixtures for:

- search/grep path-line-value association;
- file read with explicit partial/full state;
- test/compiler failure classification;
- structured vs raw result representations;
- prompt-injection strings embedded in result data;
- stale read after mutation;
- unknown custom/MCP result fallback;
- subagent/delegation result comprehension;
- parallel tool-call/result correlation.

Measure raw counts for interpretation, correlation, grounding, completeness recognition and recovery.

## Phase B10 — Result-profile pressure

For selected models/tool classes, compare bounded result profiles while keeping raw execution constant:

- raw rich;
- structured verbose;
- structured compact;
- error-focused;
- one-result-at-a-time.

Vary one result-policy family at a time. Never use a lossy model view as verifier input.

## Phase B11 — Compaction boundary

Run controlled cases before and after OpenCode compaction where the same critical observation must remain actionable.

Record:

- host compaction identity/state;
- whether the relevant observation remains raw recent context, summarized/checkpoint context, or omitted;
- hard-constraint/source-of-truth reinjection state;
- model comprehension and recovery outcome.

Reuse the existing OCAE context-engineering source-of-truth/staleness principles.

## Phase B12 — Model-switch rehydration

Force a bounded authorized escalation/fallback from model A to model B after model-A-specific observations have been produced.

Verify that model B receives one of:

- a safe re-render from authoritative receipts;
- OpenCode-native re-observation;
- proven lossless model-independent facts;
- an explicit context-requalification block.

Blind inheritance of lossy model-A-specific observation views is a failure.

## Phase E amendment — Candidate derivation

Candidate derivation may additionally use evidence such as:

- poor result comprehension → structured/explicit result profile;
- failure/success confusion → explicit status/failure envelope;
- truncation confusion → explicit completeness/continuation markers;
- parallel-result confusion → serialized calls/results;
- stale-result errors → stronger freshness/re-read rule;
- model-switch fragility → rehydration/re-observation requirement;
- tool-result volume sensitivity → bounded progressive disclosure.

Candidate derivation remains DATA/POLICY, not authority.

## Phase G amendment — Anti-overfitting confirmation

Use separate corpora:

```text
DERIVATION_CORPUS
CONFIRMATORY_HOLDOUT_CORPUS
```

The candidate and hypothesis lock before holdout execution. Promotion evidence must include confirmatory results independent of the cases used to derive the candidate.

## Added metrics

- observation_interpretation_correct;
- success_failure_classification_correct;
- call_result_correlation_correct;
- truncation_recognition_correct;
- continuation_or_reread_correct;
- stale_observation_recovery;
- parallel_result_confusion_count;
- post_compaction_success;
- model_switch_rehydration_success;
- raw_result_volume;
- adapted_result_volume;
- observation_adapter_fingerprint;
- result_contract_fingerprint.

## Added architecture tests

At minimum prove:

1. raw observation remains verifier-accessible;
2. lossy view cannot be verifier authority;
3. adapter cannot change failure to success;
4. prompt injection in a result cannot become authority;
5. truncation is explicit;
6. stale observations are detectable/revalidated when material;
7. parallel results preserve call identity;
8. materially stale result-contract fingerprints cannot apply;
9. model switch triggers safe rehydration/re-observation when required;
10. compaction state is recorded when material;
11. unknown custom/MCP outputs fall back safely;
12. holdout confirmation is required for auto-derived candidate promotion.

## Sequencing recommendation

Implement in this order:

```text
raw/result receipt contract
→ deterministic result adapters
→ comprehension fixtures
→ security/lossiness tests
→ freshness/correlation
→ compaction/model-switch tests
→ candidate derivation
→ holdout A/B confirmation
```

Do not start adaptive production behavior before the truthful observation/evidence substrate is proven.
