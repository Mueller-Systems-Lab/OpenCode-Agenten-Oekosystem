---
name: context-engineering
description: Manages Cold/Warm/Hot context levels, builds context manifests, enforces source-of-truth hierarchy, and re-injects hard constraints after context compaction. Prevents stale context from overriding runtime or repository truth.
compatibility: opencode
metadata:
  hermes: compatible
  risk_tier: all
---

# Context Engineering

Use this skill before any task that spans multiple steps or involves delegation to ensure the agent operates on a valid, current, and complete context foundation.

## When To Use

- Before any multi-step task (more than one agent interaction)
- Before delegation to subagents (issue-orchestrator dispatching plan, build, review, security, compliance, or research agents)
- Before and after Context Compaction (provider switch, memory limit, new task in same session)
- Before any operation that consumes or acts on repository state
- When stale context could lead to incorrect decisions (e.g., acting on outdated source-of-truth)
- When the agent's working memory may contain remnants of a previous, unrelated task

## Workflow

### Step 1 — Classify Current Context

Determine which context level applies to the current session:

| Context Level | Criteria | Allowed Operations |
|---------------|----------|-------------------|
| **COLD** | Agent has task description, repo path/URL, and hard constraints only. No validation of repo state performed yet. | Reality Refresh, Resource Discovery, Context Request |
| **WARM** | Reality Refresh complete, issue/run-report fully read, affected files identified, architecture sketched. | Research, Planning, Delegation to Analysis Subagents, Risk Analysis, Run Card Creation |
| **HOT** | Plan exists, approval obtained, runtime access granted. | Implementation, Code Changes, Test Execution, Review, Evidence Collection |

Transition rules:
- **COLD → WARM**: Reality Refresh completed, issue/run-report read, affected files identified
- **WARM → HOT**: Plan approved, Risk Tier determined, Verification Contract created, Owner Approval obtained
- **HOT → COLD**: Context Compaction required (memory limit, new task, provider switch)

### Step 2 — Build Context Manifest

Produce a structured Context Manifest before any operation that builds on existing context:

```
## Context Manifest
- Context Level: COLD | WARM | HOT
- Source of Truth: (URL/Path)
- Reality Layer: (confirmed facts)
- Hard Constraints: (current state)
- Stale Items: (marked as STALE)
```

Each manifest field is populated as follows:

- **Context Level**: Determined by Step 1 classification
- **Source of Truth**: The authoritative reference for this task — GitHub Issue URL, local run report path, or "local only" when no external source exists
- **Reality Layer**: Confirmed facts from Reality Refresh — e.g., "Git branch is main, 3 uncommitted files, Node 20.11.0 available, no Docker"
- **Hard Constraints**: Current non-negotiable boundaries — e.g., "No new dependencies, no external API calls, budget $0"
- **Stale Items**: Items from previous context that no longer apply — e.g., "Previous source-of-truth Issue #12 is closed (STALE), previous constraint 'use Python 3.10' overridden by runtime Python 3.12 (STALE)"

### Step 3 — Enforce Source-of-Truth Hierarchy

Cross-reference all claims against the Source of Truth Hierarchy and correct any inversion:

| Layer | Name | Priority |
|-------|------|----------|
| 0 | **Reality Truth** (actual repo/runtime state on disk) | Highest — overrides all others |
| 1 | **Executable Truth** (package.json, pyproject.toml, Dockerfile, CI configs, schemas) | Overrides layers 2–4 |
| 2 | **Evidence Truth** (logs, test output, diffs from current or documented prior session) | Overrides layers 3–4 |
| 3 | **Documentation Truth** (issues, ADRs, run reports, policies, README, AGENTS.md) | Overrides layer 4 |
| 4 | **Memory/Chat Context** (chat history, agent memory files, embeddings) | Never overrides layers 0–3 |

**Enforcement action**: If any claim from a lower layer contradicts a higher layer, discard the lower-layer claim and mark it as `STALE` in the manifest. Never adjust reality to match outdated documentation.

### Step 4 — Re-Inject Hard Constraints

Hard Constraints are non-negotiable boundaries that are lost upon Context Compaction or agent handoff. Re-inject all constraints at every required injection point.

**The 10 mandatory Hard-Constraint-Re-Injection points:**

1. ✅ **After Context Compaction** — e.g., memory limit reached, provider switch, new task started
2. ✅ **Before Agent Delegation** — subagent must receive the full constraint set
3. ✅ **Before Apply** — file changes in the target project
4. ✅ **Before Commit**
5. ✅ **Before Push**
6. ✅ **Before PR Creation**
7. ✅ **Before Merge**
8. ✅ **Before Deployment**
9. ✅ **Before Productive Data Operations** — any operation touching production or production-like data
10. ✅ **Before Skill or Memory Writes**

**Typical constraint categories to re-inject:**

| Category | Examples |
|----------|----------|
| Time | Deadline, available sessions, timeout limits |
| Cost | API budget, maximum allowed cost per run |
| Security | No secrets in logs, no insecure protocols, no hardcoded credentials |
| Compliance | DSGVO/GDPR, data minimization, retention limits, right to deletion |
| Scope | Only specific files/modules, exclude legacy directories |
| Technical | Specific runtime version, specific provider, no new dependencies |
| Process | Dry-run required before apply, human approval required for gates |
| Communication | Language, verbosity level, audience |
| Risk | Maximum acceptable risk tier, required review gates |
| Environment | Local-only execution, no network access, container constraints |

### Step 5 — Check For Stale Context

Scan the current working context (chat history, memory files, embedding results) for items that contradict or are superseded by higher truth layers:

1. **Compare each claim** against the Source of Truth Hierarchy
2. **If a claim originates from Layer 4 (Memory/Chat)** but contradicts Layer 0–3 → mark as `STALE`
3. **If a claim originates from Layer 3 (Documentation)** but contradicts Layer 0–2 → mark as `STALE`
4. **If a constraint from a previous task** is carried over but no longer relevant → mark as `STALE`
5. **If a Source of Truth reference** points to a closed issue, merged PR, or superseded run report → mark as `STALE`
6. **Record all stale items** in the Context Manifest under `Stale Items`

**Staleness indicator**: Append `(STALE)` to any item that fails the check. Do not silently drop stale items — document them so the user can see what was discarded and why.

### Step 6 — Manage Context Size Dynamically

When the working context approaches size limits (token budget, memory threshold, window limits):

1. **Identify low-value context**: Completed sub-task details, verbose logs from earlier steps, resolved findings
2. **Compact** by dropping low-value context while preserving:
   - Context Manifest (current and valid)
   - Hard Constraints (full, uncompacted)
   - Open Findings (unresolved security/compliance items)
   - Current Source of Truth reference
   - Verification Contract (if active)
3. **After compaction**, re-run Step 4 (Re-Inject Hard Constraints) and Step 5 (Check For Stale Context)
4. **Update the Context Manifest** with a compaction note: `Context Compacted at <timestamp>: <reason>`
5. **Verify the transition**: If compaction drops from HOT to COLD, all HOT-level operations must cease until a new WARM→HOT transition is completed

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| Task Description | What needs to be done | Yes |
| Repository State | Git status, file system layout, runtime availability | Yes (via Reality Refresh) |
| Existing Context | Chat history, memory files, agent state from prior steps | Optional |
| Hard Constraints | Non-negotiable boundaries from user, policy, or previous gate | Yes |
| Source of Truth Reference | Issue URL, run report path, or "local only" | Yes |
| Previous Context Manifest | If continuing from a prior session or compacted context | Optional |

## Outputs

| Output | Description | Contains |
|--------|-------------|----------|
| Context Manifest | Structured summary of current context state | Context Level, Source of Truth, Reality Layer, Hard Constraints, Stale Items |
| Context Classification | Determined context level (COLD/WARM/HOT) with justification | Criteria met, allowed/forbidden operations |
| Staleness Report | List of stale items with reason for staleness | Claim, Origin Layer, Contradicted By, Action Taken |
| Compaction Note | Record of any context compaction that occurred | Timestamp, Reason, Items Dropped, Items Preserved |

## Security Boundaries

| Boundary | Rule |
|----------|------|
| **Memory/Chat Truth vs. Runtime Truth** | Never allow memory or chat context to override runtime or repository truth. If a chat claim contradicts the actual repo state, the chat claim is always discarded and flagged as `STALE`. |
| **Hallucinated Context** | Never hallucinate or fabricate missing context. If a fact is not available from any Source of Truth layer, mark it as `UNVERIFIED` in the manifest. Do not proceed with planning or implementation that depends on unverified context. |
| **Secrets Injection** | Never inject secrets, tokens, passwords, or PII into the Context Manifest or any context artifact. If a hard constraint involves a secret (e.g., API key limit), reference the constraint category and source policy, not the secret value. |
| **Source of Truth Fabrication** | Never claim a Source of Truth (Issue URL, run report path) without validating that it actually exists and is accessible. If GitHub access is unavailable, do not claim to have read an issue. Use "local only" instead. |
| **Approval Leakage** | Never carry over approvals from a previous context. When context is compacted or a new task begins, all approval states reset to `NOT_REQUESTED`. |
| **Cross-Context Contamination** | When switching between unrelated tasks, reset the full context. Do not carry constraints, findings, or manifest items from Task A into Task B. The only exception is global hard constraints (e.g., "never commit secrets"), which apply to all tasks. |

## Completion Criteria

- [ ] Context Level classified as COLD, WARM, or HOT with justification documented
- [ ] Context Manifest built with all required fields (Level, Source of Truth, Reality Layer, Hard Constraints, Stale Items)
- [ ] Source of Truth Hierarchy enforced — all claims cross-referenced, no lower-layer claim contradicts a higher layer
- [ ] Hard Constraints re-injected at all 10 mandatory injection points
- [ ] Stale items identified, documented, and marked with `(STALE)` in the manifest
- [ ] Context size managed dynamically if approaching limits — compaction performed with note and constraint re-injection
- [ ] Security boundaries respected — no memory-over-reality inversions, no hallucinations, no secrets, no approval leakage
- [ ] Manifest and staleness report available for handoff to subagents or next task step
