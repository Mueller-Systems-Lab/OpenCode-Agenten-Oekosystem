# Issue #43 Deep-Dive Gap Analysis

Date: **2026-09-03**  
Status: **Research findings — deterministic contract slice implemented; live qualification not claimed**
Scope: end-to-end adaptive harness path from task intake through verified completion

## Executive finding

Issue #43 started with empirical model capability and adaptive tool/context policy. The deeper architecture review shows that the useful optimization surface is larger:

```text
TASK
  ↓
DISCOVERY / CONTEXT ACQUISITION
  ↓
TOOL SELECTION + ARGUMENTS
  ↓
RAW TOOL OBSERVATION
  ↓
MODEL-FACING OBSERVATION ADAPTATION
  ↓
MODEL INTERPRETATION / NEXT ACTION
  ↓
MUTATION / MORE OBSERVATION
  ↓
VERIFICATION
  ↓
RECOVERY / ESCALATION / MODEL SWITCH
```

OCAE already has strong security/governance/routing/context foundations, but the empirical harness research must qualify the **whole information loop**, not only tool calling.

Normative companion architecture:

- `docs/architecture/opencode-workspace-host-boundary.md`
- `docs/architecture/tool-observation-result-adaptation.md`

## Host reality refresh

Current OpenCode documentation checked on 2026-09-03 confirms relevant host primitives:

- built-in `read`, `grep`, `glob`, `bash`, edit/write and experimental `lsp` tools;
- project/worktree context exposed to tools/plugins;
- model/agent-specific tool permissions;
- `tool.execute.before` and `tool.execute.after` plugin seams;
- custom and MCP tools with heterogeneous contracts;
- automatic conversation compaction;
- dynamic/nested `AGENTS.md` instruction discovery;
- experimental APIs exposing tool IDs/schema and LSP/MCP status.

This reinforces the architecture decision: OCAE should reuse host mechanics and optimize policy/representation rather than recreate an IDE.

Reference set:

- https://opencode.ai/docs/tools/
- https://opencode.ai/docs/plugins/
- https://opencode.ai/v2/docs/build/plugins
- https://opencode.ai/v2/docs/compaction
- https://opencode.ai/v2/docs/instructions
- https://opencode.ai/docs/server/

## Finding 1 — Tool calling and tool-result comprehension are separate capabilities

Current Issue #43 metrics already include selection, arguments, grounding, and result volume, but they do not yet make the separation first-class.

Required split:

```text
TOOL_CALL_CAPABILITY
TOOL_OBSERVATION_CAPABILITY
```

A model may execute `pytest` or `grep` correctly but misunderstand a large trace/result. Removing the tool would be the wrong optimization; adapting the returned observation may be sufficient.

**Decision:** add model/tool-class observation-comprehension qualification and model-facing result profiles.

## Finding 2 — Raw reality and model view must be separate

Result adaptation can become dangerous if the normalized/summarized view becomes the verification source.

Required separation:

```text
RAW_OBSERVATION = authority/evidence input
DERIVED_MODEL_VIEW = bounded communication aid
MODEL_INTERPRETATION = hypothesis
VERIFIER = terminal correctness authority
```

**Decision:** every lossy view must be explicit and verifier logic must use raw observation or independent executable state.

## Finding 3 — Compaction changes what the model later sees

OpenCode V2 compaction is intentionally lossy. Current documentation states that compacted checkpoints preserve structured summary plus recent context, and tool output in retained serialized context can be limited to a bounded character count.

OCAE already has a `context-engineering` skill with COLD/WARM/HOT levels, source-of-truth hierarchy, stale-context handling, and hard-constraint reinjection after compaction/handoff. What is missing from Issue #43 is **empirical binding between model capability evidence and the host compaction state**.

Risks:

- a result profile proven immediately after tool execution may behave differently after compaction;
- important completeness/error markers may be omitted in a checkpoint;
- a model switch may consume a checkpoint authored for another model;
- an old nested instruction may remain durable in the session after source changes.

**Decision:** record relevant compaction/instruction epoch state in qualification evidence when material; test pre/post-compaction comprehension and recovery.

## Finding 4 — Tool output is untrusted content

OCAE already applies an untrusted-content principle in Visual QA and has MCP/prompt-injection/security work elsewhere. The same principle must become generic for tool observations.

Tool results can contain strings such as `IGNORE PREVIOUS INSTRUCTIONS`, fake approvals, fake test-success claims, or commands embedded in:

- repository files;
- logs;
- web results;
- MCP responses;
- custom tool output;
- generated files;
- screenshots/OCR-like content;
- subagent output.

**Decision:** normalization may label/delimit content but must never promote tool-returned text to requirement, permission, approval, routing, security, or owner authority.

## Finding 5 — Freshness is a per-observation property

OCAE already distinguishes stale context from current reality, but Issue #43 needs finer-grained observation freshness.

Example:

1. model reads `config.ts`;
2. another tool edits `config.ts`;
3. model later reasons from the old read result.

The old observation was truthful when produced but is now stale.

**Decision:** evaluate lightweight freshness receipts such as file/workspace revision or content fingerprint where materially useful. Revalidation must use OpenCode-native mechanics; no parallel index is required.

## Finding 6 — Parallel tool calls create a correlation problem

Protocol support for parallel calls does not prove that a concrete model correctly associates multiple results with their originating calls.

Potential failures:

- combine result A with path B;
- attribute one error to another call;
- continue before all required results arrive;
- produce a final answer based on one successful and one failed call without noticing the failure.

**Decision:** measure call-result correlation separately. Candidate mitigation may serialize calls/results for weaker models.

## Finding 7 — Tool contracts drift

Input tool schemas and result behavior can change with:

- OpenCode version;
- built-in tool version;
- plugin version;
- MCP server version;
- custom tool implementation;
- provider/model bridge.

OpenCode exposes tool inventory/schema APIs, but a schema alone does not capture result semantics.

**Decision:** bind empirical evidence to both tool-input contract and relevant result-contract/adapter fingerprints. Stale contracts invalidate candidate application until safely requalified.

## Finding 8 — Custom and MCP tools need a generic fallback adapter

Built-in `read` or `grep` can receive dedicated adapters, but custom/MCP tools may return arbitrary text or structured payloads.

**Decision:** use a hierarchy:

```text
TOOL_SPECIFIC_ADAPTER
  ↓ fallback
NORMALIZED_GENERIC_ENVELOPE
  ↓ fallback
RAW_BOUNDED_WITH_EXPLICIT_METADATA
```

No requirement that every external tool conform to one universal OCAE schema.

## Finding 9 — Model switching can invalidate the current representation

OCAE routing supports bounded retry/escalation/provider fallback. A run can therefore continue with a different model.

A model-facing context/result profile optimized for model A is not automatically suitable for model B.

**Decision:** on model identity change, the harness must not blindly treat prior model-specific adapted observations as canonical. Candidate strategies:

- re-render a new model view from safe raw-result receipts;
- re-read/re-observe critical state with OpenCode-native tools;
- retain only model-independent normalized facts that are proven lossless;
- force a context requalification point before effectful continuation.

This is a high-priority architecture gap.

## Finding 10 — Agent/subagent output is also a tool observation

OpenCode `task`/delegation results and OCAE subagent handoffs are another information interface. OCAE already reinjects hard constraints before delegation, but Issue #43 does not yet measure whether the receiving model correctly understands a subagent result.

**Decision:** treat delegation output as an observation class with provenance, scope, confidence/evidence links, and no inherited authority beyond the parent task/grant.

## Finding 11 — Result adaptation should be deterministic before using another LLM

Using a second LLM to summarize every tool result can add cost, latency, nondeterminism, prompt-injection surface, and a second hallucination point.

**Decision:** prefer deterministic parsing/structuring/truncation for known tool classes. If an LLM-based observation compressor is ever evaluated, it is a separately qualified non-authoritative component with raw-evidence verification.

## Finding 12 — Qualification can overfit its own corpus

Once candidate policies are automatically derived from measured failures, testing those candidates only on the same corpus risks tuning to fixtures.

Issue #33 already used frozen hypotheses/corpora and promotion thresholds; the next milestone needs an explicit anti-overfitting design.

**Decision:** separate at least:

```text
DISCOVERY / DERIVATION CORPUS
CONFIRMATORY HOLDOUT CORPUS
```

Freeze candidate/hypothesis before confirmatory runs. Promotion evidence cannot rely solely on cases used to derive the candidate.

## Finding 13 — Operational model identity can drift without changing the public name

Hosted free aliases can be remapped; local model quantization/runtime settings can change; provider bridges can change behavior.

**Decision:** capability evidence needs expiry/staleness semantics based on observable operational fingerprints, not only `provider/model-name`. Requalification is event/evidence-driven, not unrestricted continuous learning.

## Finding 14 — The harness needs an information budget, not only a token budget

For weaker models, the limiting factor may be number of simultaneous concepts/sources rather than raw token count.

Candidate dimensions:

- max relevant files at once;
- max result rows;
- max concurrent unresolved errors;
- max distinct tool-result classes in one step;
- max branches in a plan;
- max stale/uncertain facts retained.

**Decision:** qualify both token/byte volume and structural information load.

## Finding 15 — Stop conditions for discovery are as important as expansion rules

A discovery policy that continually searches for more context wastes tokens and can reduce model reliability. A policy that stops too early misses the defect.

**Decision:** evaluate bounded **evidence sufficiency / stop rules** such as:

- required symbol/test relationship found;
- verifier can answer the current sub-question;
- marginal discovery no longer changes candidate file set;
- uncertainty remains above threshold → expand;
- scope/budget boundary reached → stop/fail safely.

These rules must remain deterministic/policy-based where possible and cannot create new task scope.

## Finding 16 — Result/error taxonomy must preserve governance distinctions

The model must distinguish at least:

- execution success;
- execution failure;
- invalid arguments/schema;
- permission denial;
- owner approval required;
- timeout;
- unavailable optional capability;
- partial/truncated output;
- context overflow/compaction recovery;
- stale observation;
- verifier rejection.

Collapsing these into generic `ERROR` harms recovery and can accidentally encourage unauthorized retries.

**Decision:** define a canonical observation failure taxonomy mapped from OpenCode/OCAE host events without overriding controller authority.

## Finding 17 — Source-of-truth class should travel with observations

OCAE already defines a source-of-truth hierarchy in `context-engineering`:

```text
Reality > Executable > Evidence > Documentation > Memory/Chat
```

Issue #43 should reuse it for observation envelopes so the model can distinguish, for example, a live test exit code from README prose or a subagent hypothesis.

**Decision:** include a bounded provenance/truth-class field where useful. This is classification metadata, not new authority.

## Consolidated capability model

The refined empirical model is:

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

And the adaptive surface is:

```text
TOOL EXPOSURE
DISCOVERY STRATEGY
TOOL DESCRIPTION
ARGUMENT SCAFFOLDING
OBSERVATION ADAPTATION
CONTEXT / COMPACTION POLICY
TASK DECOMPOSITION
RECOVERY FEEDBACK
MODEL-SWITCH REHYDRATION
VERIFICATION
```

## Priority recommendation

Implement/research in this order:

1. raw-observation / model-view separation and result adapter contract;
2. observation comprehension metrics + deterministic synthetic fixtures;
3. untrusted-result and lossiness invariants;
4. tool/result contract fingerprinting;
5. freshness + call/result correlation;
6. compaction and model-switch rehydration;
7. holdout evaluation / anti-overfitting;
8. custom/MCP/delegation observation classes;
9. information-budget and discovery-stop optimization.

This order preserves the existing stable product boundary and gives the qualification system a truthful measurement substrate before adding more adaptive behavior.
