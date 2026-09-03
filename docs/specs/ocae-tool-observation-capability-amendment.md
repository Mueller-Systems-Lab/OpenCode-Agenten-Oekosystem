# OCAE Tool Observation Capability — Issue #43 Amendment

Status: **Normative research amendment**  
Extends: `docs/specs/ocae-empirical-model-capability-qualification.md`  
Architecture: `docs/architecture/tool-observation-result-adaptation.md`

## Refined capability model

The Issue #43 empirical capability model is refined to separate tool invocation from interpretation of returned observations:

```text
EFFECTIVE_AGENT_CAPABILITY
  = MODEL_INTERFACE_CAPABILITY
  ∩ PROVIDER_RUNTIME_CAPABILITY
  ∩ OPENCODE_WORKSPACE_CAPABILITY
  ∩ TOOL_CALL_CAPABILITY
  ∩ TOOL_OBSERVATION_CAPABILITY
  ∩ CONTEXT_COMPACTION_COMPATIBILITY
  ∩ TASK_COMPLEXITY_CAPABILITY
  ∩ SESSION_GRANT
  ∩ HARNESS_SUPPORTED_CAPABILITY
```

`TOOL_CALL_CAPABILITY` covers selection, argument/schema correctness and action-boundary compliance.

`TOOL_OBSERVATION_CAPABILITY` covers result comprehension, failure recognition, call/source correlation, truncation/completeness recognition, grounded next-action selection and grounded final claims.

`CONTEXT_COMPACTION_COMPATIBILITY` covers whether the model can safely continue after OpenCode host compaction/instruction-epoch transitions with the relevant evidence/constraints preserved or re-established.

## Observation authority boundary

```text
OPENCODE_OWNS_TOOL_EXECUTION_AND_RAW_OBSERVATION
OCAE_MAY_ADAPT_MODEL_FACING_OBSERVATION
RAW_OBSERVATION_REMAINS_AUTHORITATIVE
DERIVED_MODEL_VIEW_IS_DATA_NOT_AUTHORITY
VERIFIER_MUST_NOT_DEPEND_ON_LOSSY_MODEL_VIEW
```

A result adapter may structure, bound, reorder, label or summarize already-observed data. It cannot change execution status, invent observations, expand permissions/scope, or promote result content into requirements/approvals/security/routing authority.

## Required empirical dimensions

Add at least:

- observation interpretation correctness;
- success/failure classification correctness;
- path/source/call correlation correctness;
- grounded next-action correctness;
- grounded final-claim correctness;
- truncation/completeness recognition;
- continuation/re-read correctness;
- stale-observation recovery;
- parallel-result confusion count;
- post-compaction comprehension;
- model-switch rehydration/re-observation success;
- raw vs adapted result volume;
- adapter profile/fingerprint;
- result-contract fingerprint.

## Required result-profile experiments

Where justified by a concrete model/tool class, compare bounded candidate profiles such as:

```text
RAW_RICH
STRUCTURED_VERBOSE
STRUCTURED_COMPACT
ERROR_FOCUSED
ONE_RESULT_AT_A_TIME
```

No profile is assumed superior a priori. The generic/raw host behavior remains baseline where safe.

## Required security/provenance semantics

Observation metadata should preserve, where relevant:

- execution status;
- normalized failure class;
- source/truth class;
- untrusted-content marker;
- completeness/lossiness state;
- call/result identity;
- freshness/revision receipt;
- raw-result fingerprint or safe receipt;
- adapter/tool/result-contract fingerprint.

Tool output remains data. Untrusted content cannot create requirements, approvals, permissions, model-routing instructions, or security policy.

## Compaction and model-switch refinement

Capability evidence is stale or incomplete when a materially different context representation is used without qualification.

When OpenCode compaction or OCAE model escalation changes the consumer/context materially, the runtime candidate must use one of:

- safe re-render from authoritative non-secret raw receipts;
- OpenCode-native re-observation/re-read of critical state;
- proven lossless model-independent normalized facts;
- fail-closed/context-requalification before effectful continuation.

## Anti-overfitting requirement

Automatically derived candidate profiles/adapters cannot be promoted solely on cases used to derive them.

Use at least:

```text
DERIVATION_CORPUS
CONFIRMATORY_HOLDOUT_CORPUS
```

Freeze the candidate/hypothesis before confirmatory evaluation. Neutral and negative confirmatory outcomes are valid research results.

## Operational drift

Qualification identity must detect material drift in model/runtime/OpenCode/tool/result contracts. Public model name alone is insufficient evidence continuity.

Requalification is event/evidence-driven; this amendment does not authorize unrestricted continuous self-modification.
