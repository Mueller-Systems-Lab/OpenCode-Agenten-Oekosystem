# Issue #43 — Empirical Qualification Implementation Slice

Status: **development/evaluation contracts implemented; no production profile promoted**
Date: 2026-09-03
Branch: `research/issue-43-empirical-capability-qualification`

## Implemented surface

- `runtime/harness/empirical-capability-contract.mjs` provides the versioned, fail-closed identity/fingerprint contract, eight capability families, raw-count metrics, stale-evidence checks, and zero-sample-safe claims.
- `runtime/harness/observation-adapter.mjs` keeps the raw observation receipt authoritative and derives deterministic tool-specific, generic, or bounded model-facing views. Status/failure, provenance, completeness, lossiness, untrusted-content, freshness, call identity, adapter, and contract fingerprints remain explicit.
- `runtime/harness/qualification-runner.mjs` provides frozen derivation/holdout corpora, paired generic/candidate plans, bounded native discovery policy, bounded scope-preserving decomposition, raw metric records, candidate derivation, and paired holdout confirmation.
- `runtime/harness/local-runtime.mjs` provides explicit-only vendor-neutral local OpenAI-compatible runtime metadata. No endpoint scan or model call is performed when the endpoint is not configured.
- `docs/schemas/empirical-capability.schema.json` documents the persisted capability-record shape.

## Authority and safety result

The research modules do not import or replace the canonical runtime, routing policy, permission evaluator, retry controller, terminal verifier, OpenCode tools, or workspace mechanics. Candidate derivation only hides already-granted tools and labels policy data; it cannot grant tools, expand scope, alter routing, change budgets, or become terminal authority. No parallel repository index is present.

The observation adapter always marks tool-returned content as untrusted data. Lossy views expose explicit completeness/lossiness metadata. Critical stale observations fail closed, model switching rehydrates from raw receipts or requests re-observation, and compaction continuity requires hard-constraint reinjection plus provenance preservation.

## Qualification status

- Deterministic fixture qualification: run by `test/harness/empirical-capability.test.mjs`.
- Hosted free-model qualification: not run in this implementation turn; no hosted model call is claimed.
- Local model qualification: `LOCAL_MODEL_QUALIFICATION=NOT_RUN_EXPLICIT_ENDPOINT_REQUIRED`.
- Candidate promotion: none. Deterministic holdout mechanics are present; no model-specific profile is installed or promoted.

## Known limitations

- The live OpenCode provider connector remains the existing canonical evaluation seam; this slice does not add a provider connector or invoke a model.
- Observation comprehension is represented as verifier-supplied deterministic fixture metrics. Live model comprehension and post-compaction behavior still require a separately authorized, zero-cost qualification run with frozen corpus evidence.
- The current research result is therefore an operational contract/fixture milestone, not a claim that a particular model-specific candidate improves verified success.
