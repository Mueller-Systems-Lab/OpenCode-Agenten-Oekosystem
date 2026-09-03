# OCAE Empirical Model Capability Qualification

Status: **Research specification**  
Issue: **#43**  
Product impact: **none until separately promoted by evidence**

## 1. Purpose

OCAE already has a deterministic hierarchical model harness and a runtime-owned model catalog. Issue #33 proved that the architecture can resolve model-specific profiles, compose task-role overlays, expose tools conservatively, record evidence, and reject candidate profiles that do not prove value.

This specification defines the next research layer: empirical qualification of what a concrete model/provider/runtime combination can reliably do, and deterministic derivation of bounded candidate harness adaptations from that evidence.

The core hypothesis is:

```text
effective_agent_capability
  = model_interface_capability
  ∩ provider_runtime_capability
  ∩ empirical_tool_capability
  ∩ task_complexity_capability
  ∩ session_grant
  ∩ harness_supported_capability
```

This is an operational capability model, not a claim about model weights or training data.

## 2. Problem statement

A binary catalog field such as `tool_support: true` is necessary but insufficient for smaller, free, or local models. Two models can both support tool calling while differing substantially in:

- tool selection accuracy;
- argument/schema accuracy;
- ability to ground claims in observed tool output;
- recovery after an invalid or failed tool call;
- tolerance for many simultaneously exposed tools;
- ability to preserve a plan across multiple steps;
- sensitivity to input context or tool-result volume;
- reliability under PLAN, BUILD, REVIEW, RESEARCH, or TOOL_USE roles.

A generic harness may therefore hide useful latent capability or overload a weaker model. OCAE should measure these differences instead of assuming them.

## 3. Architecture boundary

All Issue #33 authority boundaries remain binding.

### Canonical core owns

- security and permissions;
- scope authority;
- provider/model routing authority;
- retry and escalation authority;
- budgets and cost authorization;
- terminal decisions;
- evidence integrity;
- production promotion.

### Qualification layer may own

- bounded probe task selection from an authorized frozen corpus;
- capability observation and scoring;
- evidence aggregation;
- generation of development-only candidate profile data;
- deterministic recommendations for tool hiding, task decomposition, context shaping, or role scaffolding.

### Qualification layer must never own

- permission expansion;
- provider authorization;
- creation of new project requirements;
- model self-selection;
- automatic production promotion;
- autonomous modification of security/governance policy;
- secret discovery or persistence.

`QUALIFICATION_DATA_IS_NOT_AUTHORITY` is a new explicit invariant.

## 4. Capability layers

### 4.1 Model interface capability

Describes protocol-level features that the model can use through the selected host/provider:

- native or emulated tool calling;
- structured output level;
- vision input;
- context-window class;
- parallel tool-call support where proven;
- streaming/response behavior where relevant.

These capabilities must be evidence-backed or provider/runtime-verified. They must not be inferred from marketing copy alone.

### 4.2 Provider/runtime capability

Describes what the current execution path actually exposes for the model:

- model reachable or only configured;
- tool interface exposed;
- MCP bridge available;
- image input available;
- structured response mode available;
- local/remote runtime identity;
- transport-specific restrictions.

The same underlying model served through two runtimes may therefore qualify as two different operational identities.

### 4.3 Empirical tool capability

Per tool or normalized tool class, measure at least:

- selection correctness;
- argument validity;
- execution/result grounding;
- fabricated-result incidence;
- recovery after invalid call;
- recovery after real tool failure;
- unnecessary-tool-call rate;
- task completion after tool use.

Example conceptual record:

```json
{
  "tool_class": "filesystem.read",
  "samples": 20,
  "selection_correct": 19,
  "arguments_valid": 20,
  "grounded_final_claims": 19,
  "fabricated_result_count": 0,
  "recovery_success": 2,
  "recovery_attempts": 2
}
```

Exact production schema is deferred to implementation, but sample counts must always accompany rates.

### 4.4 Task-complexity capability

Measure the model under controlled increases in difficulty:

- one-step vs multi-step tasks;
- planning horizon;
- number of relevant files/resources;
- number of simultaneously available tools;
- branching/recovery requirements;
- context size;
- tool-result size;
- structured-output strictness.

The objective is not to assign an intelligence score. It is to find stable operating regions for the harness.

### 4.5 Session capability

The actual session grant is authoritative. Qualification can only remove or reframe tools from the granted set.

```text
candidate_exposed_tools ⊆ granted_tools
```

Any candidate profile that references an ungranted tool remains a fail-closed security violation.

## 5. Model/runtime identity

Qualification evidence must bind to a stable non-secret identity containing, where available:

- provider identifier;
- model identifier;
- runtime/host class;
- model endpoint class (`hosted`, `local-openai-compatible`, etc.);
- relevant host/runtime version;
- qualification corpus fingerprint;
- harness fingerprint;
- tool-contract fingerprint;
- verifier version.

Do not persist credentials, secret endpoint tokens, private absolute paths, or prompt content that may contain secrets.

## 6. Local-model support

OCAE should support research qualification of a local OpenAI-compatible runtime without coupling the architecture to LM Studio or any other single vendor.

A local model is not trusted because it is local. It must satisfy the same rules as hosted models:

- real reachability probe;
- real tool-use evidence;
- real verifier-backed success evidence;
- no claimed capability without proof;
- safe generic fallback when unqualified;
- no automatic production promotion.

Useful non-sensitive runtime metadata may include context limit, quantization/runtime label if explicitly available, and local execution class. Hardware identifiers are optional and must not be required for model identity.

## 7. Qualification corpus

Every causal comparison must use a frozen corpus with a stable fingerprint. The corpus should cover independent capability dimensions rather than only end-to-end coding tasks.

Minimum groups:

1. **Tool protocol** — choose the correct tool and produce valid arguments.
2. **Grounding** — report only values actually observed from tool results.
3. **Recovery** — recover from invalid arguments and real tool failures.
4. **Toolset pressure** — repeat equivalent tasks while increasing irrelevant exposed tools.
5. **Planning horizon** — equivalent task families at increasing step depth.
6. **Context pressure** — controlled context and tool-result volume increases.
7. **Role behavior** — PLAN, BUILD, REVIEW, RESEARCH, TOOL_USE overlays.
8. **Structured output** — exact schema/output compliance where authorized.

Tasks must be deterministic or verifier-deterministic wherever possible.

## 8. Metrics and evidence semantics

Persist raw counts before derived rates. At minimum:

- `verified_success_count / sample_count`;
- tool selection correctness;
- argument validity;
- grounded-result correctness;
- fabricated-result count;
- recovery success/attempts;
- retries;
- unnecessary tool calls;
- input context volume;
- tool-result volume;
- latency/throughput if reliably observable;
- failure-class distribution.

Small samples must not be reported with false statistical precision. Qualification records should use qualitative bands only when the conversion rule is frozen and documented.

## 9. Adaptive candidate derivation

Qualification evidence may generate a **candidate** harness recommendation. Candidate generation must be deterministic from a frozen rule set.

Permitted candidate adaptations include:

- `FULL_TOOLSET` → `TASK_MINIMAL_TOOLSET`;
- shorter or more explicit tool descriptions;
- explicit tool-call contracts;
- one-tool-at-a-time scaffolding;
- bounded task decomposition;
- role-specific planning granularity;
- context ordering/compression;
- tool-result summarization/truncation hints;
- known-failure mitigations;
- verifier-directed retry hints within canonical retry bounds.

A candidate must never alter routing, grants, security, budget, terminal authority, or promotion policy.

## 10. Task decomposition contract

Adaptive decomposition is allowed only as a transformation of an already-authorized task.

Required invariants:

- subtask union must remain within original scope;
- decomposition may reduce work size but not create requirements;
- each subtask must inherit the same or narrower permission set;
- terminal completion requires verifier evidence for the original task, not merely subtask completion;
- decomposition depth must be bounded;
- no recursive unbounded agent spawning.

## 11. Causal evaluation

Any candidate claiming value must be compared against `generic.v1` under identical conditions:

- same model/provider/runtime;
- same task corpus;
- same permissions;
- same granted tools before candidate hiding;
- same verifier;
- same retry budget;
- same host constraints where controllable.

Change one hypothesis family at a time whenever practical.

Promotion remains:

```text
NO_CORE_REGRESSION
AND NO_SECURITY_REGRESSION
AND NO_SIGNIFICANT_VERIFIED_SUCCESS_REGRESSION
AND MEASURABLE_MODEL_SPECIFIC_VALUE
```

A neutral or negative result is a valid research result and must be preserved.

## 12. Proposed outputs

The research implementation should ultimately produce:

- a versioned empirical capability-record schema;
- a deterministic qualification runner;
- frozen qualification corpora;
- a local OpenAI-compatible runtime probe path;
- persisted evidence bundles and fingerprints;
- a candidate-derivation function;
- per-model qualification summaries;
- generic-vs-candidate A/B evidence;
- explicit `PROMOTED`, `REJECTED`, or `NOT_PROMOTED_NO_VALUE` decisions.

## 13. Non-goals

This work does not:

- modify model weights;
- claim access to model training data;
- implement online reinforcement learning;
- authorize unrestricted self-modifying prompts;
- make production policy self-evolving;
- turn benchmark scores into authority;
- make a local model production-ready merely because it runs successfully;
- replace OpenCode as OCAE's host.

## 14. Research interpretation

The intended research question is no longer simply:

> Which model is best?

It becomes:

> For a given authorized task and runtime, what is the smallest sufficient model, tool surface, context shape, and task decomposition that maximizes verified success without violating OCAE's authority and security invariants?

That question is compatible with OCAE's free-first and evidence-first architecture and is especially relevant to local and small models.
