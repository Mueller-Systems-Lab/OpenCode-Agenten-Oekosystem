# OCAE Empirical Model Capability Qualification

Status: **Research specification**  
Issue: **#43**  
Product impact: **none until separately promoted by evidence**

Normative host-boundary reference: [`../architecture/opencode-workspace-host-boundary.md`](../architecture/opencode-workspace-host-boundary.md)

## 1. Purpose

OCAE already has a deterministic hierarchical model harness and a runtime-owned model catalog. Issue #33 proved that the architecture can resolve model-specific profiles, compose task-role overlays, expose tools conservatively, record evidence, and reject candidate profiles that do not prove value.

This specification defines the next research layer: empirical qualification of what a concrete model/provider/runtime combination can reliably do, and deterministic derivation of bounded candidate harness adaptations from that evidence.

The core hypothesis is:

```text
effective_agent_capability
  = model_interface_capability
  ∩ provider_runtime_capability
  ∩ opencode_workspace_capability
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

OpenCode is the authoritative workspace host and code-intelligence surface. OCAE must reuse OpenCode-native project/worktree, filesystem, search, LSP/code-intelligence, tool transport and context mechanisms where they are sufficient. OCAE owns policy for how those host capabilities are used; it does not own a parallel full-repository index.

Canonical host boundary:

```text
OPENCODE_OWNS_WORKSPACE_MECHANICS
OCAE_OWNS_DISCOVERY_STRATEGY_AND_POLICY
```

OCAE may decide an allowed discovery sequence, tool exposure, result-count bounds, context shaping, bounded expansion, verification points, and model-specific decomposition. Those decisions can only narrow or reorganize an already-authorized surface.

OCAE must not prescribe the target repository's application folder layout. Its existing lightweight discovery of language/framework/package-manager/test/database/monorepo/project signals remains policy input, not a competing source-code intelligence engine.

A future OCAE-owned source index requires a separately evidenced OpenCode host gap and separate authorization as defined by the normative host-boundary document.

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
- deterministic recommendations for tool hiding, OpenCode-native discovery strategy, task decomposition, context shaping, or role scaffolding.

### Qualification layer must never own

- permission expansion;
- provider authorization;
- creation of new project requirements;
- model self-selection;
- automatic production promotion;
- autonomous modification of security/governance policy;
- secret discovery or persistence;
- a parallel full-repository index without separately proven host need.

`QUALIFICATION_DATA_IS_NOT_AUTHORITY` is an explicit invariant.

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

### 4.3 OpenCode workspace capability

Describes the relevant host mechanics available for the qualification fixture/task, including where observable:

- project/worktree context;
- filesystem read/write surface;
- `glob`/pattern discovery;
- `grep`/text search;
- `lsp`/code-intelligence availability for the task language;
- host tool-contract/version identity;
- context/session mechanisms relevant to the experiment.

Qualification evidence must not assume that every OpenCode installation has identical code-intelligence availability. Host capability identity should be fingerprinted sufficiently to detect stale or incomparable evidence.

### 4.4 Empirical tool capability

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

### 4.5 Task-complexity capability

Measure the model under controlled increases in difficulty:

- one-step vs multi-step tasks;
- planning horizon;
- number of relevant files/resources;
- number of simultaneously available tools;
- branching/recovery requirements;
- context size;
- tool-result size;
- structured-output strictness;
- task-local discovery depth and breadth using OpenCode-native primitives.

The objective is not to assign an intelligence score. It is to find stable operating regions for the harness.

### 4.6 Session capability

The actual session grant is authoritative. Qualification can only remove or reframe tools from the granted set.

```text
candidate_exposed_tools ⊆ granted_tools
```

Any candidate profile that references an ungranted tool remains a fail-closed security violation.

## 5. Model/runtime and host identity

Qualification evidence must bind to a stable non-secret identity containing, where available:

- provider identifier;
- model identifier;
- runtime/host class;
- model endpoint class (`hosted`, `local-openai-compatible`, etc.);
- relevant model runtime version;
- OpenCode version/runtime identity;
- OpenCode workspace/tool capability fingerprint;
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
9. **OpenCode-native discovery** — compare bounded discovery strategies such as `glob → grep → read`, `grep → lsp → read`, and other justified combinations without duplicating host indexing.

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
- discovery steps and result counts where applicable;
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
- bounded OpenCode-native discovery sequences and result counts;
- bounded task decomposition;
- role-specific planning granularity;
- context ordering/compression;
- tool-result summarization/truncation hints;
- known-failure mitigations;
- verifier-directed retry hints within canonical retry bounds.

A candidate must never alter routing, grants, security, budget, terminal authority, promotion policy, or target-repository architecture.

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

For every candidate with a concrete hypothesis, compare:

```text
GENERIC_V1_BASELINE
vs
MODEL_SPECIFIC_CANDIDATE
```

Hold constant:

- model/provider/runtime identity;
- OpenCode host capability identity relevant to the test;
- task corpus;
- initial grants;
- verifier;
- retry budget;
- runtime constraints.

Only the intended candidate policy family may differ. Failed runs remain evidence.

Promotion still requires:

```text
NO_CORE_REGRESSION
AND NO_SECURITY_REGRESSION
AND NO_SIGNIFICANT_VERIFIED_SUCCESS_REGRESSION
AND MEASURABLE_MODEL_SPECIFIC_VALUE
```

No profile is promoted merely because it reduces context or because a local model is cheaper.

## 12. Workspace-host invariants

The following are normative for this milestone:

```text
OPENCODE_OWNS_WORKSPACE_MECHANICS
OCAE_MUST_REUSE_HOST_CODE_INTELLIGENCE_WHERE_SUFFICIENT
OCAE_DISCOVERY_STRATEGY_IS_POLICY_NOT_AUTHORITY
OCAE_DISCOVERY_STRATEGY_CANNOT_EXPAND_SCOPE
OCAE_MAY_HIDE_BUT_MUST_NOT_GRANT_TOOLS
TARGET_REPOSITORY_LAYOUT_IS_NOT_PRESCRIBED_BY_OCAE
NO_PARALLEL_FULL_REPOSITORY_INDEX_WITHOUT_EVIDENCED_HOST_GAP
HOST_GAP_REQUIRES_SEPARATE_REQUIREMENT_AND_AUTHORIZATION
```

A strategy that assumes unavailable/stale host capabilities must fall back safely or fail closed; it must not silently synthesize a substitute source of truth.

## 13. Expected research outcomes

Valid terminal outcomes include:

- measurable model-specific value and a separately reviewable promotion candidate;
- safe but neutral optimization (`NOT_PROMOTED_NO_VALUE`);
- correctness regression (`REJECTED_FOR_CORRECTNESS`);
- security/authority regression (`REJECTED_FOR_SECURITY`);
- insufficient evidence.

A neutral/negative model result can still satisfy the milestone if the qualification system correctly measures and rejects non-value.

## 14. Non-goals

- claiming that harnessing changes model weights or training knowledge;
- replacing OpenCode as the host;
- replacing OpenCode's workspace, file-search, LSP/code-intelligence, tool transport, or context substrate;
- prescribing target-project application folder layout;
- autonomous self-modification of production policy;
- unrestricted continuous learning;
- online reinforcement learning as a requirement;
- benchmarking every provider/model;
- automatic production promotion;
- weakening any canonical OCAE security/governance boundary.
