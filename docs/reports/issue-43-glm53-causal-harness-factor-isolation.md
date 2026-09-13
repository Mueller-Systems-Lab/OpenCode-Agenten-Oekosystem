# Issue #43 — GLM-5.3 causal harness-factor isolation

Run date: 2026-09-04. This is a new experiment and does not replace the
historical Muse evidence. Raw evidence is retained in
[`issue-43-glm53-causal-factor-isolation-20260903T235910Z.json`](./issue-43-glm53-causal-factor-isolation-20260903T235910Z.json);
the pre-run freeze is
[`issue-43-glm53-causal-factor-isolation-20260903T235910Z-freeze.json`](./issue-43-glm53-causal-factor-isolation-20260903T235910Z-freeze.json).

## Result

`FINAL_CLASSIFICATION=RED_OCAE_GLM53_CAUSAL_CORRECTNESS_REGRESSION`

The exact canonical route was `zai-coding-plan/glm-5.3` through OpenCode
`1.18.25` (`opencode-cli-free-transport`). Preflight passed and all planned
rows ran: 160 primary rows and 120 tool-contract rows. No factor is promoted.
The raw generic baseline A was the strongest primary arm. Minimal exposure B
reduced tool calls but reduced verified success on holdout. Deterministic
observation adaptation C/D caused a large verified-success and comprehension
regression, including a live adapter failure. The three contract variants all
had `40/40` tool-argument validity, so this experiment does not reproduce the
previous Muse argument-validity weakness.

## Runtime, cost, and identity

| Item | Value |
|---|---|
| Provider | `zai-coding-plan` |
| Model | `glm-5.3` |
| Runtime identity | `opencode-cli-free-transport` |
| OpenCode | `1.18.25` |
| Preflight | reachable YES; canonical entry PASS; provider/model match PASS; live evidence YES |
| Fallback / model switch | `NO / NO` |
| Cost path | `EXISTING_AUTHORIZED_PLAN` |
| Runtime-reported preflight cost | `0` |
| Metered paid fallback | `NO` |
| Generic GLM-specific profile | none; arms use `generic.v1` harness content |
| Promotion | `NONE` |

The reported cost is the runtime's observed preflight field. The experiment
classification is based on the authorized Z.AI Coding Plan path and does not
claim an independently verified monetary price.

## Frozen experiment contract

| Item | Fingerprint / value |
|---|---|
| Experiment ID | `issue-43-glm53-causal-factor-isolation-20260903T235910Z` |
| Repository fixture | `12272215e468a47112cef98f0062e357b065f1124e39ae96716305f556d88395` |
| Derivation corpus | `ce63fbc19d2fd7294865d565cd107d4f56130cccc289c774e466005350897db5` |
| Confirmatory holdout | `d3e181571481511ccbbc630b3ed640eb3453b4f0992b3c39c5a5bd74e1159590` |
| Tool contract | `ee57effac5f6c2b15dcd431e1b50d1bb82d4dcda23e4602403a9951c34a704de` |
| Observation contract | `936593a4920bf93bc51ddd4780775075adfa1a4d88cfbbaceb99dc8ab58f1b91` |
| Verifier | `issue-43-live-verifier.v1` |
| Execution order | counterbalanced per case/arm; persisted in freeze |
| Execution-order fingerprint | `b4bdb56f8ecd59a19b93359c6c56b7f6c931cb38afd975836b95ee57146095d2` |
| Primary plan fingerprint | `frozen JSON artifact` |
| Contract plan fingerprint | `frozen JSON artifact` |
| Primary repetitions | `4` — 24 derivation and 16 holdout observations per arm |
| Contract repetitions | `4` — 24 derivation and 16 holdout observations per variant |
| Timeout / retry budget | `90,000 ms / 0` |

The primary arm treatment fingerprints were: A
`b82649c24b9faa1ebba8699bf90c350503306e475fae7c44c5cbccc7dc26932a`, B
`7b049f73d2b96467210f1dd0fc9180f6acfc0e0ff38a0a9b93ec832998ffbe85`, C
`bfcb8e61f7c16b28fc90266b0c5bc2fe00f4fc24017c14098853ccb83ecbc811`, and D
`9e9c73db4722fda83aef5e3975a2cc6cd9d33bccc4aef2c9dad013a709a5d697`.

## Primary 2×2 factorial arms

| Arm | Tool exposure | Observation | Contract |
|---|---|---|---|
| A | `FULL_GENERIC` | raw/baseline | `BASELINE` |
| B | `TASK_MINIMAL` | raw/baseline | `BASELINE` |
| C | `FULL_GENERIC` | deterministic adapted | `BASELINE` |
| D | `TASK_MINIMAL` | deterministic adapted | `BASELINE` |

Counts below combine derivation and holdout (`n=40` per arm); context and
result volumes are character counts; latency is mean milliseconds.

| Arm | Verified | Tool selection | Argument validity | Observation comprehension | Fabricated-result metric | Tool calls | Input context | Tool-result volume | Avg latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 32/40 | 40/40 | 39/40 | 28/40 | 0 | 69 | 10,460 | 18,694 | 15,333 |
| B | 28/40 | 39/40 | 40/40 | 24/40 | 1 | 48 | 10,460 | 18,892 | 14,460 |
| C | 7/40 | 10/40 | 39/40 | 5/40 | 30 | 14 | 10,460 | 1,443 | 76,257 |
| D | 6/40 | 10/40 | 40/40 | 6/40 | 30 | 7 | 10,460 | 964 | 81,888 |

The fabricated-result metric is deliberately conservative: in this runner it
also counts required-tool runs with no authoritative observation receipt, so
the C/D values are not a claim that 30 model outputs were independently proven
to be fabricated. Failure classes and raw records are in the JSON artifact.

Holdout-only verified success was A `9/16`, B `8/16`, C `7/16`, and D `4/16`.
The paired comparisons were A→B: one baseline-only success loss; A→C: four
losses; and A→D: six losses. Holdout confirmation therefore failed for all
three treatment comparisons.

## Effect decomposition

Values are treatment minus comparison; rates are absolute percentage-point
deltas, tool calls/volumes/latency are arithmetic mean deltas.

| Effect | Verified success | Tool selection | Argument validity | Observation comprehension | Tool calls | Tool-result volume | Latency |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tool exposure: B − A | -0.100 | -0.025 | +0.025 | -0.100 | -0.525 | +4.950 | -873 ms |
| Observation adaptation: C − A | -0.625 | -0.750 | 0.000 | -0.575 | -1.375 | -431.275 | +60,924 ms |
| Combined: D − A | -0.650 | -0.750 | +0.025 | -0.550 | -1.550 | -443.250 | +66,555 ms |
| Adaptation under minimal tools: D − B | -0.550 | -0.725 | 0.000 | -0.450 | -1.025 | -448.200 | +67,429 ms |
| Tool exposure under adaptation: D − C | -0.025 | 0.000 | +0.025 | +0.025 | -0.175 | -11.975 | +5,631 ms |

Interpretation: GLM-5.3 showed a measurable tool-minimization cost in verified
correctness and no correctness benefit from adaptation. Adaptation reduced
visible result volume but did not preserve comprehension or grounded success.
These are causal findings for this frozen GLM/runtime/harness identity, not a
general model ranking.

## Tool-contract framing sub-experiment

All variants used the same GLM route, full granted tool set, baseline/raw
observation policy, fixture, permissions, verifier, and four repetitions.

| Variant | Framing | Runs | Verified success | Argument validity | Diagnostics | Holdout verified |
|---|---|---:|---:|---:|---|---:|
| A | baseline current schema | 40 | 34/40 | 40/40 | all zero | 10/16 |
| B | short explicit | 40 | 32/40 | 40/40 | all zero | 9/16 |
| C | short explicit + one concise valid example | 40 | 33/40 | 40/40 | all zero | 10/16 |

All contract holdout comparisons failed the no-loss paired confirmation rule
(A→B one loss; A→C two losses). `BEST_TOOL_CONTRACT=NONE` for promotion/value
purposes: example-assisted framing had the fastest all-run mean latency
(`13,659 ms`) but no verified correctness or argument-validity gain.

## Genuine observation interposition

Adapted C/D rows used the live path:

```text
OpenCode raw tool result
  → OCAE deterministic tool.execute.after adapter
  → model-facing adapted observation
  → GLM-5.3
```

The evidence reports:

| Check | Result |
|---|---|
| Genuine live interposition | `YES` |
| Raw observation fingerprinting | `PASS` |
| Model-facing fingerprinting | `PASS` |
| Raw/model-facing fingerprints differ | `YES` |
| Adapter IDs | `ocae.generic`, `ocae.read` |
| Interposition before model | `YES` for all recorded adapted observations |
| Verifier raw authority | `PASS` |
| Adapter failure rows | 1 (`OBSERVATION_ADAPTER_FAILURE`) |

Raw observation receipts, call IDs, provenance, lossiness, truncation, source,
and model-facing fingerprints are retained as bounded metadata. Adapted data
did not control grants, routing, verifier authority, or the terminal decision.

## Security and authority

`RAW_OBSERVATION_REMAINS_AUTHORITATIVE`, `VERIFIER_OWNS_SUCCESS`, and the
canonical runtime identity checks passed. Candidate exposure stayed within the
granted set; worker self-selection, provider fallback, and model switching were
disabled. Tool-result content could not change permissions, provider, model,
verifier result, approval, or success. No production profile was promoted.

## Cross-model comparison

`CROSS_MODEL_MUSE_GLM53_COMPARISON=CROSS_MODEL_DESCRIPTIVE_ONLY`.

The previous Muse experiment remains preserved as
`issue-43-causal-factor-isolation-20260903T215623Z`, with
`MODEL=muse-spark-1.2-contributor-free` and
`RESULT=BLOCKED_MODEL_UNAVAILABLE`. It is not merged with these GLM samples
and no shared capability rate is calculated. The only descriptive observation
from this run is that GLM-5.3 had `40/40` argument validity in every contract
variant, unlike the prior Muse evidence; conditions are not identical, so this
is not a model benchmark.

## Decision and limitations

`RESEARCH_CANDIDATE_VALUE_PROVEN=NO`

`PROMOTED_PROFILE=NONE`

The frozen experiment proves a correctness regression for the adapted arms and
a smaller correctness regression for task-minimal exposure on this fixture. It
does not prove that all model-facing adaptation is unsafe in every task, nor
does it prove a general GLM-5.3 quality ranking. The contract sub-experiment
measured no tool-argument improvement. The next candidate study should first
diagnose why the OpenCode plugin interposition produces timeouts/zero-tool rows
for C/D, then rerun a newly identified experiment; the current evidence must
remain immutable.
