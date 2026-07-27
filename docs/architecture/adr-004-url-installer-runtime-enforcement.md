# ADR-004: URL Installer Runtime Enforcement

**Status:** Proposed

**Date:** 2026-07-16

**Deciders:** Architecture Agent (delegated from issue-orchestrator)

**Supersedes:** None. Extends ADR-003 (Runtime-Neutral Hard Gate Kernel) with the installation and runtime enforcement plane.

> **HISTORICAL / SUPERSEDED PATHS:** This ADR records an earlier design. Its
> plural `.opencode/plugins/` paths are not the active Issue #16 contract. The
> current verified bridge is `.opencode/plugin/governance-v2.ts`.

---

## Context

### What Problem Does This Solve?

ADR-003 established the 19-kernel-gate invariant system and the runtime-neutral evaluation architecture. However, ADR-003 addresses **what** must be enforced, not **how** enforcement is deployed, installed, and guaranteed to be active at runtime. The repository is being upgraded from a documentation/prompt collection to a **universal governance installer** with real runtime enforcement. The core gap closing now is:

> **Policies alone do not block tool calls.** Without a resident enforcement hook in the target runtime, the 19 kernel gates, policy gates, and project gates are documentation — not execution barriers.

The user task asks:

1. How does a developer install governance into a target project using **only the repository URL**?
2. How is enforcement guaranteed to be **active at runtime** rather than merely documented?
3. What enforcement level can each runtime actually support, backed by verifiable technical evidence — not aspirational claims?
4. How is the installed enforcement runtime protected from **tampering** after installation?
5. How does the governance system degrade gracefully when a runtime cannot support active enforcement?

### The Runtime Enforcement Gap (Before This ADR)

| Runtime | Policy Files Present? | Enforces at Runtime? | Gap |
|---------|----------------------|----------------------|-----|
| OpenCode | Yes (static JSON) | No — policies are read as guidance, not gate code | No `tool.execute.before` hook registered |
| Hermes | Yes (static YAML) | No — policies are read as guidance, not gate code | No `pre_tool_call` hook registered |
| Odysseus | No | No — no integration exists | No `disabled_tools` configuration |
| Generic | No | No | No runtime detection |

**The core observation:** Writing policy files into a project directory is not enforcement. Enforcement requires a resident runtime component — a plugin, a hook, a middleware — that the target runtime loads and executes **before every tool call**.

### Forces at Play

| Force | Direction |
|-------|-----------|
| **Zero-configuration installation** | A developer must be able to install governance with only the repository URL — no project-specific insider knowledge, no manual file copying, no multi-step configuration. |
| **Resident enforcement** | Enforcement must be structurally guaranteed to run before every tool call. "Inline instruction in the system prompt" or "README telling the agent what not to do" are not enforcement. |
| **Honest capability claims** | The system must never claim HOOK_ENFORCED for a runtime that cannot actually enforce hooks. Each enforcement level must be backed by reproducible technical evidence. |
| **Tamper detection** | Once installed, the enforcement runtime must detect if its files have been modified, deleted, or replaced. A tampered enforcement runtime that silently operates is worse than no enforcement — it provides a false sense of security. |
| **Graceful degradation** | When a runtime cannot support active enforcement (e.g., Odysseus, generic), the system must fall back to the best available mechanism — deny-list configuration, policy documentation, or explicit TOOL_GAP classification. |
| **Two-plane separation** | The installation-and-configuration lifecycle (control plane) must be architecturally separate from the per-tool-call enforcement path (enforcement plane). Decisions about what to install happen once; enforcement happens continuously. |
| **URL as sole entry point** | The repository URL alone must suffice as the distribution artifact. No npm registry, no PyPI package, no manual download — `git clone` / `hermes plugins install <url>` / `opencode plugin install <url>` are the distribution channels. |

### What ADR-003 Already Provides

ADR-003 defines:
- 19 kernel gates (Layer 1 — immutable safety invariants)
- Policy gates (Layer 2 — configurable tightening)
- Project gates (Layer 3 — additive project-local constraints)
- Runtime adapter contract (8-method interface, additive-only)
- Gate decision contract (machine-readable JSON with classification, blocked_by, required_approvals, etc.)
- `evaluate-all.mjs` — canonical gate evaluation entry point

**What ADR-003 does NOT cover:**
- How the kernel gates are **installed** into a target project
- How the kernel gates are **connected** to the runtime's execution hook
- What **directory structure** the installed governance occupies
- How the installation is **verified** as intact before runtime enforcement begins
- What **enforcement levels** each runtime can honestly claim
- How the **URL alone** serves as the distribution artifact

---

## Decision

Implement a **Two-Plane Architecture** for universal governance installation and runtime enforcement, with four enforcement levels backed by verifiable evidence, a resident `.agent-governance/` target structure, URL-only entry point, and tamper detection via `source-lock.json`.

### Decision 1: Two-Plane Architecture

The URL Installer Runtime Enforcement system is divided into two architecturally separate planes:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        CONTROL PLANE                                      │
│                     (Runs once, at install time)                          │
│                                                                           │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────┐ │
│  │ Discovery │   │ Policy   │   │ Approval │   │ Evidence │   │Version │ │
│  │ (runtime  │   │ Selection│   │ Receipt  │   │ Collection│   │ Lock   │ │
│  │  detection│   │ (policies│   │ Generation│   │ (run      │   │(source-│ │
│  │  signals) │   │  .json)  │   │ (scope-   │   │  reports) │   │ lock.  │ │
│  └─────┬─────┘   └─────┬─────┘   │  bound)   │   └─────┬─────┘   │ json)  │ │
│        │               │          └─────┬─────┘         │          └───┬────┘ │
│        │               │                │               │              │      │
│        ▼               ▼                ▼               ▼              ▼      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     INSTALLER (URL → .agent-governance/)              │  │
│  │                                                                       │  │
│  │  1. Clone/access governance from URL                                  │  │
│  │  2. Detect target runtime(s) (OpenCode? Hermes? Odysseus?)            │  │
│  │  3. Select policies based on detected runtime + project signals       │  │
│  │  4. Write resident enforcement artifacts to .agent-governance/        │  │
│  │  5. Generate source-lock.json with SHA-256 hashes                     │  │
│  │  6. Record installation manifest (timestamp, runtime, version)        │  │
│  │  7. Produce installation receipt (for audit trail)                    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌──────────┐   ┌────────────────────────────────────────────────────┐   │
│  │ Backup   │   │ Rollback (restore from .agent-governance/backups/)  │   │
│  │ (pre-    │   │                                                     │   │
│  │  install │   │   • Restore overwritten files                        │   │
│  │  snapshot│   │   • Validate restored manifest against source-lock   │   │
│  └──────────┘   │   • Produce rollback receipt                         │   │
│                 └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Installs enforcement artifacts
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      ENFORCEMENT PLANE                                    │
│                  (Runs continuously, at runtime)                          │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              RUNTIME HOOK (Pre-Execution Gate)                     │   │
│  │                                                                     │   │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌───────────────┐  │   │
│  │  │ tool.execute     │    │ pre_tool_call   │    │ disabled_tools│  │   │
│  │  │ .before          │    │ (Hermes hook)   │    │ deny-list     │  │   │
│  │  │ (OpenCode plugin)│    │                 │    │ (Odysseus)    │  │   │
│  │  └────────┬────────┘    └────────┬────────┘    └───────┬───────┘  │   │
│  │           │                      │                      │          │   │
│  │           └──────────────────────┼──────────────────────┘          │   │
│  │                                  ▼                                 │   │
│  │  ┌──────────────────────────────────────────────────────────────┐ │   │
│  │  │                    BROKER (Gate Kernel)                        │ │   │
│  │  │                                                               │ │   │
│  │  │  1. Load source-lock.json — verify integrity                  │ │   │
│  │  │  2. Load .agent-governance/policies/ — current policy state   │ │   │
│  │  │  3. Map runtime tool → neutral operation descriptor           │ │   │
│  │  │  4. Evaluate: Kernel Gates → Policy Gates → Project Gates     │ │   │
│  │  │  5. Produce Gate Decision (allowed/blocked)                   │ │   │
│  │  │  6. Log decision to .agent-governance/evidence/               │ │   │
│  │  │  7. If blocked → throw/return block directive to runtime      │ │   │
│  │  │  8. If allowed → return control to runtime hook               │ │   │
│  │  └──────────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              FAIL-CLOSED SAFETY                                    │   │
│  │                                                                     │   │
│  │  • If broker cannot load → BLOCK (fail-closed)                     │   │
│  │  • If source-lock.json missing → BLOCK (tamper evidence)           │   │
│  │  • If hash mismatch on any runtime file → RED_BLOCK                │   │
│  │  • If hook cannot reach broker → BLOCK (fail-closed)               │   │
│  │  • If broker throws unhandled exception → BLOCK (fail-closed)      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Control Plane Responsibilities

| Component | Responsibility | Artifacts Produced |
|-----------|---------------|-------------------|
| **Discovery** | Detect target runtime(s) via file signals (OpenCode: `opencode.jsonc`; Hermes: `.hermes.md`; Odysseus: multiple directory signals; Generic: none) | Runtime detection report |
| **Policy Selection** | Map detected runtime + project domain signals to appropriate policy set | `.agent-governance/policies/*.json` |
| **Installation** | Write enforcement artifacts to target project; create backup; generate manifest | `.agent-governance/` tree, installation receipt |
| **Version Lock** | Hash all installed governance files; produce `source-lock.json` | `source-lock.json` with SHA-256 per file |
| **Backup** | Snapshot overwritten files before installation | `.agent-governance/backups/<timestamp>/` |
| **Rollback** | Restore from backup manifest; validate restored state against source-lock | Rollback receipt |

#### Enforcement Plane Responsibilities

| Component | Responsibility | Failure Mode |
|-----------|---------------|-------------|
| **Pre-Execution Hook** | Intercept every tool call before the runtime executes it | Hook missing → TOOL_GAP (no enforcement possible) |
| **Gate Broker** | Load kernel gates, evaluate against operation descriptor, produce gate decision | Broker unreachable → fail-closed (block) |
| **Tool Mapping** | Translate runtime-specific tool name + args into neutral operation descriptor | Unknown tool → conservative classification (assume write-capable) |
| **Tamper Detection** | Verify source-lock.json hashes against installed files; RED_BLOCK on mismatch | Hash mismatch → fail-closed (block) |
| **Fail-Closed** | If any enforcement component fails, default to blocking the tool call | Component failure → RED_BLOCK |

### Decision 2: Canonical Evaluation Order

The gate evaluation path defined in ADR-003 (`evaluate-all.mjs`) is the **single canonical path** for all runtime enforcement. Every hook, plugin, and adapter must invoke the same evaluation sequence:

```
Operation Request (tool name + args)
        │
        ▼
┌──────────────────┐
│ 1. TAMPER CHECK  │ ◄── NEW (this ADR)
│  (source-lock)   │     Verify SHA-256 hashes of all governance files.
│                  │     Mismatch on any file → RED_BLOCK, no further
│                  │     evaluation. This runs FIRST, before kernel gates.
└────────┬─────────┘
         │ Hashes match
         ▼
┌──────────────────┐
│ 2. KERNEL GATES  │     ADR-003 Layer 1: 19 immutable safety invariants.
│  (kernel.mjs)    │     ALL must pass. Any failure → RED_BLOCK.
│                  │     Kernel gates run BEFORE policy gates — a
│                  │     blocked kernel gate cannot be overridden.
└────────┬─────────┘
         │ All kernel gates pass
         ▼
┌──────────────────┐
│ 3. POLICY GATES  │     ADR-003 Layer 2: Configurable tightening.
│  (policy.mjs)    │     May add blockers. May NOT remove kernel blockers.
│                  │     Risk-tier routing, evidence requirements,
│                  │     security/compliance screening.
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 4. PROJECT GATES │     ADR-003 Layer 3: Project-local, additive.
│  (project.mjs)   │     May only TIGHTEN. local-only, no-cloud-llm,
│                  │     no-remote-ci, protected files, etc.
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 5. RUNTIME       │     ADR-003: Adapter-specific gates.
│    ADAPTER       │     May add blockers, evidence requirements,
│  (adapter-*.mjs) │     tool gaps. NEVER removes blocks from earlier
│                  │     layers. NEVER weakens classification.
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 6. FINAL         │     Allowed / RED_BLOCK / AMBER_REVIEW / TOOL_GAP
│    DECISION      │     Decision JSON returned to runtime hook.
│                  │     Hook acts: allow execution OR throw/block.
└──────────────────┘
```

**Design invariant:** The tamper check (step 1) is the NEW addition in this ADR, placed BEFORE kernel gates because a tampered enforcement runtime cannot be trusted to evaluate kernel gates correctly. If the broker file has been modified, the kernel gates themselves may be compromised.

### Decision 3: Enforcement Levels

Every runtime receives exactly one enforcement level classification. The classification is backed by verifiable technical evidence. No false claims are permitted.

| Level | Name | What It Means | Evidence Required |
|-------|------|--------------|-------------------|
| **0** | `DOCUMENT_ONLY` | Policy files are present in `.agent-governance/policies/` but NOT connected to any runtime hook. The runtime reads them as documentation/guidance only. No tool calls are intercepted. | Static policy file presence check; confirmation that no hook/plugin is registered |
| **1** | `POLICY_CONFIGURED` | Policy files are present AND connected to a runtime configuration mechanism that can block by category/pattern (e.g., OpenCode `permission.deny`, Hermes `deny` blocklist, Odysseus `disabled_tools`). Blocking is by tool name or pattern, NOT per-invocation with argument inspection. | Configuration file check showing deny rules; evidence that the runtime reads and applies these rules |
| **2** | `HOOK_ENFORCED` | A pre-execution hook is registered in the runtime that intercepts EVERY tool call before execution, inspects tool arguments, evaluates against the gate kernel, and can block individual invocations. | Hook registration evidence; test showing a blocked tool call; test showing an allowed tool call; test showing the hook fires on all tool types |
| **3** | `BROKER_ENFORCED` | Same as HOOK_ENFORCED, but the enforcement logic runs in a SEPARATE process (broker) that is out-of-process from the agent runtime. The hook communicates with the broker via IPC/localhost. If the broker process is killed, the hook fails-closed. | All HOOK_ENFORCED evidence PLUS: broker process verification; IPC channel verification; fail-closed test (kill broker, verify tool calls are blocked) |

#### Enforcement Matrix Per Runtime (Research-Backed)

| Runtime | Maximum Honest Level | Mechanism | Limitations | Research Basis |
|---------|---------------------|-----------|-------------|---------------|
| **OpenCode** | `HOOK_ENFORCED` (Level 2) | `.opencode/plugins/runtime-enforce.js` with `tool.execute.before` hook. Plugin auto-loads from project directory. | Agent context not in hook input (workaround via SDK `client.session.get()`). No process isolation for broker. | `url-installer-runtime-enforcement-research.md` sections 1–4: `tool.execute.before` confirmed, blocking via throw confirmed, project-local plugin auto-load confirmed |
| **Hermes** | `HOOK_ENFORCED` (Level 2) | `pre_tool_call` hook via either: (a) Python plugin at `~/.hermes/plugins/` (installed via `hermes plugins install <git-url>`), OR (b) Shell hook in `config.yaml` with `cwd` awareness. | Python `pre_tool_call` callback does NOT receive `cwd` — requires `os.getcwd()` or project-local plugin context. Shell hooks receive `cwd` but require consent (`--accept-hooks`). Project-local plugins require `HERMES_ENABLE_PROJECT_PLUGINS=1`. | `url-installer-runtime-enforcement-research.md` sections 5–10: `pre_tool_call` confirmed, blocking via `return {"action": "block"}` confirmed, Git install confirmed, cwd gap documented |
| **Odysseus** | `POLICY_CONFIGURED` (Level 1) | `disabled_tools` deny-list configured via database settings. Can block by tool name only. No per-invocation argument inspection. No pre-execution hook exists. | Bash and Python are NOT sandboxed — bypass via subprocess. Deny-list is binary (tool name present/absent), not content-aware. No hook API for per-call interception. No process isolation beyond cwd. Prompt-based restrictions are advisory only, not enforcement. | `odysseus-enforcement-research.md`: No `pre_tool_call` hook found; `disabled_tools` is the only enforcement mechanism; bash runs via `create_subprocess_shell` without sandboxing; `ToolPolicy` is data structure, not hook; `guide_only` mode is binary (all or nothing) |
| **Generic** | `DOCUMENT_ONLY` (Level 0) or `TOOL_GAP` | Policy files written to project. No hook registration mechanism available. Runtime capabilities unknown. | Can't claim any enforcement level without knowing the runtime. Default: `AMBER_REVIEW` with recommendation to manually configure. | By definition: unknown runtime = unknown capabilities. |

### Decision 4: Resident Runtime Installation (`.agent-governance/` Target Structure)

The URL installer deploys a self-contained governance runtime into the target project at `.agent-governance/`. This directory is the **single source of truth** for the enforcement plane within the project.

```
<target-project>/
├── .agent-governance/
│   │
│   ├── manifest.json              # Installation metadata (version, timestamp, runtime, URL)
│   ├── source-lock.json           # SHA-256 hashes of all governance files (tamper detection)
│   │
│   ├── runtime/                   # Resident enforcement code
│   │   ├── broker.mjs             # Gate kernel evaluation engine (imports from kernel.mjs)
│   │   ├── tool-mapping.mjs       # Maps runtime tool names → neutral operation descriptors
│   │   ├── tamper-check.mjs       # Verifies source-lock.json hashes before each evaluation
│   │   └── fail-closed.mjs        # Fail-closed safety wrapper
│   │
│   ├── policies/                  # Policy files (ADR-003 Layers 2+3)
│   │   ├── kernel-invariants.json # Read-only reference copy of 19 kernel gate definitions
│   │   ├── policy-tiers.json      # Risk-tier policy gate configuration
│   │   ├── project-gates.json     # Project-local constraints (additive only)
│   │   └── enforcement-level.json # Declared enforcement level + evidence references
│   │
│   ├── approvals/                 # Approval receipt storage
│   │   ├── receipts/              # Active/pending/consumed/expired approval receipts
│   │   └── consumed-nonces.json   # Ledger of consumed nonces (replay protection)
│   │
│   ├── evidence/                  # Gate decision evidence artifacts
│   │   ├── decisions/             # Gate decision JSONs (timestamped, machine-readable)
│   │   └── audit/                 # Audit log (sequential, append-only)
│   │
│   ├── state/                     # Runtime state (volatile, not checked into git)
│   │   ├── session-state.json     # Current session enforcement state
│   │   └── adapter-cache.json     # Cached adapter detection results
│   │
│   ├── bin/                       # CLI entry points for manual operations
│   │   ├── evaluate.mjs           # Standalone gate evaluation (for testing)
│   │   ├── verify.mjs             # Tamper verification (check source-lock.json)
│   │   └── rollback.mjs           # Rollback to previous backup
│   │
│   ├── backends/                  # Runtime-specific hook backends
│   │   ├── opencode/              # OpenCode plugin (tool.execute.before)
│   │   │   └── plugin.js          # Auto-loaded from .opencode/plugins/ symlink/copy
│   │   ├── hermes/                # Hermes plugin (pre_tool_call)
│   │   │   ├── plugin.yaml        # Manifest for hermes plugins install
│   │   │   └── __init__.py        # Python enforcement hook
│   │   └── odysseus/              # Odysseus integration (disabled_tools config)
│   │       └── disabled-tools.json # Tool deny-list for Odysseus database import
│   │
│   └── backups/                   # Installation backups (for rollback)
│       └── <timestamp>/
│           ├── backup-manifest.json
│           └── <overwritten files>
│
├── .opencode/
│   └── plugins/
│       └── runtime-enforce.js     # Symlink/copy → ../../.agent-governance/backends/opencode/plugin.js
│
└── .hermes/
    └── plugins/
        └── governance/            # Symlink/copy → ../../.agent-governance/backends/hermes/
            ├── plugin.yaml
            └── __init__.py
```

**Key design properties of `.agent-governance/`:**

1. **Self-contained:** All enforcement logic, policies, evidence, and state lives under `.agent-governance/`. No files are scattered across the project. Deleting `.agent-governance/` removes governance entirely (with backup).

2. **Runtime-agnostic core, runtime-specific backends:** The broker (`runtime/broker.mjs`), policies, approvals, and evidence are runtime-agnostic. Only the `backends/` directory contains runtime-specific hook code. Adding a new runtime means adding a new `backends/<runtime>/` directory — the core is unchanged.

3. **Gitignored state:** `.agent-governance/state/` and `.agent-governance/evidence/` are `.gitignore`'d. The `.agent-governance/runtime/`, `.agent-governance/policies/`, `.agent-governance/backends/`, `.agent-governance/bin/`, `manifest.json`, and `source-lock.json` ARE committed to version control (they are the governance contract).

4. **Symlink-safe connection:** Runtime-specific backends are connected to the runtime's expected plugin location via symlink (or copy for runtimes that don't follow symlinks). The canonical source lives in `.agent-governance/backends/`; the runtime-expected location points to it.

### Decision 5: URL as Primary Entry Point

The repository URL alone must suffice to install governance into a target project. No project-specific insider knowledge is required. The installer discovers everything it needs from the target project and the governance repository.

#### Installation Commands Per Runtime

```bash
# OpenCode — installs project-local plugin
opencode plugin install https://github.com/owner/OpenCode-Agenten-Oekosystem.git \
  --target /path/to/project \
  --apply

# Hermes — installs user-level plugin from Git
hermes plugins install https://github.com/owner/OpenCode-Agenten-Oekosystem.git \
  --enable

# Generic / direct — Node.js bootstrap (works for any project)
node scripts/install-governance.mjs \
  --target /path/to/project \
  --from https://github.com/owner/OpenCode-Agenten-Oekosystem.git \
  --apply
```

#### What the URL Installer Discovers (No Project Knowledge Needed)

| Discovery Signal | Source | What the Installer Learns |
|-----------------|--------|--------------------------|
| `opencode.jsonc` present | Target project scan | OpenCode is the primary runtime; install OpenCode plugin backend |
| `.hermes.md` present | Target project scan | Hermes is available; install Hermes plugin backend |
| `companion/` directory present | Target project scan | Odysseus is detected; configure `disabled_tools` deny-list |
| `package.json` present | Target project scan | Node.js project; broker can run via `node` |
| `pyproject.toml` present | Target project scan | Python project; broker needs Node.js or Python fallback |
| Git remote configured | Target project scan | GitHub URL; remote CI gate applicable |
| PII/civic-tech signals | Target project scan | Domain-specific policies applicable (data retention, tierheim) |
| No known runtime signals | Target project scan | Generic fallback; DOCUMENT_ONLY enforcement |

#### Dry-Run Default, Apply Explicit

Following the bootstrap safety model (ADR-001):
- **Default:** Dry-run. The installer analyzes the target project, produces an installation plan, and prints what would be installed. No files are modified.
- **Explicit:** `--apply` required to write files.
- **Explicit:** `--include-remote-ci` required for remote CI workflow proposals.

### Decision 6: Tamper Detection via `source-lock.json`

The installed governance runtime must detect tampering before performing any enforcement action. If the enforcement code itself has been modified, it cannot be trusted to enforce correctly.

#### `source-lock.json` Schema

```json
{
  "version": "1.0.0",
  "governance_version": "0.2.0",
  "installed_at": "2026-07-16T10:00:00.000Z",
  "installed_from": "https://github.com/owner/OpenCode-Agenten-Oekosystem.git",
  "installed_commit": "abc123def456",
  "target_runtime": "opencode",
  "enforcement_level": "HOOK_ENFORCED",
  "files": {
    ".agent-governance/runtime/broker.mjs": "sha256:1a2b3c4d5e6f...",
    ".agent-governance/runtime/tool-mapping.mjs": "sha256:2b3c4d5e6f7a...",
    ".agent-governance/runtime/tamper-check.mjs": "sha256:3c4d5e6f7a8b...",
    ".agent-governance/runtime/fail-closed.mjs": "sha256:4d5e6f7a8b9c...",
    ".agent-governance/policies/kernel-invariants.json": "sha256:5e6f7a8b9c0d...",
    ".agent-governance/policies/policy-tiers.json": "sha256:6f7a8b9c0d1e...",
    ".agent-governance/policies/project-gates.json": "sha256:7a8b9c0d1e2f...",
    ".agent-governance/backends/opencode/plugin.js": "sha256:8b9c0d1e2f3a...",
    ".opencode/plugins/runtime-enforce.js": "sha256:9c0d1e2f3a4b..."
  },
  "locked_by": "install-governance.mjs",
  "lock_timestamp": "2026-07-16T10:00:01.000Z",
  "lock_signature_fingerprint": "sha256:..." 
}
```

#### When Tamper Detection Runs

| Trigger | Action on Mismatch |
|---------|-------------------|
| **Every tool call** (pre-execution hook fires) | Broker verifies its own hash AND the hash of `tool-mapping.mjs` before evaluating any gates. Mismatch on either → `RED_BLOCK`. |
| **Startup** (runtime loads the plugin) | Plugin verifies its own hash against `source-lock.json` before registering hooks. Mismatch → plugin refuses to load, logs CRITICAL error. |
| **Manual check** (`./bin/verify.mjs`) | Full verification of ALL files in `source-lock.json`. Prints report of mismatches. |
| **Before apply/rollback** | CLI verifies broker integrity before performing installation or rollback operations. |

#### What Happens on Tamper Detection

1. **RED_BLOCK classification** — all tool calls are blocked.
2. **Audit log entry** written to `.agent-governance/evidence/audit/tamper-<timestamp>.json` with:
   - Which file(s) failed the hash check
   - Expected hash vs. actual hash
   - File modification timestamp (if available)
   - Runtime and session context
3. **Agent notification** — the blocking message tells the agent: "Governance enforcement is compromised. All tool calls blocked. Run `.agent-governance/bin/verify.mjs` to identify modified files."
4. **No automatic recovery** — tampered files are not automatically restored. A human must run rollback or re-install. Automatic recovery could mask an ongoing attack.

#### Integrity of `source-lock.json` Itself

The lockfile must be protected from tampering. Strategies (layered):

1. **Commit to git:** `source-lock.json` is committed to the project's git repository. Git's own SHA-1 tree hashes provide a secondary integrity check. If the file is modified but git shows it as "modified" (unstaged), the tamper is detectable.
2. **Kernel gate enforcement:** The kernel gate `NO_UNRELATED_WORKTREE_WRITE` (ADR-003 Gate 5) prevents writes to `.agent-governance/` unless explicitly scoped. A properly enforced kernel prevents tampering of `source-lock.json` by the agent itself.
3. **Human-gated updates:** When `--apply` is run to update governance, the installer produces a new `source-lock.json` with new hashes. The diff must be reviewed by a human before committing.

---

## Alternatives Considered

### Option A: Documentation-Only (No Runtime Enforcement)

- **Description:** Continue with the current architecture — policy files (`.opencode/policies/*.json`, `.hermes/config.yaml`) read by bootstrap scripts and agent instructions. No runtime hooks, no broker, no tamper detection. The 19 kernel gates exist only as documentation.
- **Pros:**
  - No new code. No installation complexity.
  - Works with any runtime (nothing to integrate).
  - No performance overhead.
- **Cons:**
  - Policies are documentation, not enforcement. An agent can read a policy file and choose to ignore it.
  - No structural guarantee that any gate is actually checked before a tool executes.
  - Hermes `/yolo` bypass, Odysseus unrestricted bash, and misconfigured OpenCode permissions are all unmitigated.
  - The repository upgrade goal ("universal governance installer with real runtime enforcement") is not met.
  - Evidence gates for claims (severity, compliance, etc.) cannot be enforced — they rely entirely on agent cooperation.
- **Why rejected:** This is the status quo the task explicitly aims to upgrade from. The architecture task is titled "URL Installer Runtime Enforcement" — documentation-only does not provide runtime enforcement.

### Option B: Policy-Only (Configuration Without Hooks)

- **Description:** Write policy files to the target project that the runtime's native configuration system enforces. For OpenCode: `opencode.jsonc` with `permission.deny` rules. For Hermes: `config.yaml` with `deny` patterns. For Odysseus: `disabled_tools` in the database. No custom hooks or broker process.
- **Pros:**
  - Uses the runtime's native enforcement mechanisms — no custom code in the runtime's process space.
  - Simpler than hook-based enforcement — configuration files only.
  - Achieves `POLICY_CONFIGURED` (Level 1) enforcement for all supported runtimes.
- **Cons:**
  - Can only block by tool name or command pattern — no per-invocation argument inspection.
  - For OpenCode: `permission.deny "rm *"` blocks all `rm` commands but cannot distinguish a safe `rm` from a destructive one based on target path.
  - For Hermes: `deny` patterns match command strings but cannot inspect file paths, environment, or session context.
  - For Odysseus: `disabled_tools` can block `bash` entirely, but cannot block specific bash commands while allowing others. Bash is all-or-nothing.
  - Cannot achieve `HOOK_ENFORCED` (Level 2) — no argument inspection, no context-aware decisions, no evidence collection per invocation.
  - The `NO_FAKE_EXECUTION` kernel gate (ADR-003 Gate 9) requires per-invocation evidence validation — impossible without a hook.
- **Why rejected:** Policy-only enforcement is an important fallback (Level 1), but it cannot achieve the architectural goal of "real runtime enforcement" defined as per-invocation gate evaluation with argument inspection. The 19 kernel gates include gates that require arg inspection (NO_PATH_ESCAPE, NO_SECRET_LEAK, NO_UNRELATED_WORKTREE_WRITE). Policy-only cannot enforce these.

### Option C: Hook-Only (Per-Runtime Hooks, No Broker)

- **Description:** Implement a pre-execution hook for each runtime (OpenCode `tool.execute.before`, Hermes `pre_tool_call`) that contains inline gate logic. Each hook is a standalone file with embedded gate checks. No separate broker process. No shared gate kernel between runtimes.
- **Pros:**
  - Achieves `HOOK_ENFORCED` (Level 2) — per-invocation interception with argument inspection.
  - No IPC overhead — gate logic runs in-process with the runtime.
  - Simpler deployment — one file per runtime, no broker to manage.
- **Cons:**
  - Gate logic duplicated per runtime — same 19 kernel gates implemented independently in JavaScript (OpenCode hook) and Python (Hermes hook).
  - Drift between implementations is inevitable — a gate fix in the OpenCode hook may not propagate to the Hermes hook.
  - Testing requires testing every gate × every runtime combination.
  - No fail-closed if the hook is disabled — if the runtime skips the hook (e.g., Hermes `/yolo`), there is no enforcement at all. A separate broker process can detect that the hook didn't call it.
  - Cannot achieve `BROKER_ENFORCED` (Level 3) — no process isolation means a compromised runtime can disable the hook.
  - Tamper detection is harder — each hook must independently verify its own integrity and the integrity of policy files.
- **Why rejected:** Hook-only is the foundation of HOOK_ENFORCED, but without a shared broker, the DRY principle is violated, drift is inevitable, and fail-closed safety is weaker. The chosen approach (hook + broker) uses hooks as thin adapters that delegate to a shared broker. This preserves the DRY principle and enables BROKER_ENFORCED as a future upgrade.

### Option D: Two-Plane Architecture with Shared Broker (CHOSEN)

- **Pros:**
  - **DRY gate logic:** The 19 kernel gates, policy gates, and project gates are implemented exactly once in the broker (`runtime/broker.mjs`). All runtime hooks are thin adapters that delegate to the broker.
  - **Honest capability claims:** The enforcement level matrix (Level 0–3) is backed by research-verified evidence. No runtime is claimed to support a level it cannot actually achieve.
  - **Fail-closed safety:** If the broker is unreachable, if source-lock.json hashes don't match, if the hook itself fails — the tool call is blocked. The default is safety.
  - **Tamper detection:** `source-lock.json` + pre-evaluation hash verification ensures the enforcement runtime has not been modified. This is run BEFORE kernel gates — a tampered broker cannot evaluate gates correctly.
  - **URL-only installation:** The repository URL is the sole distribution artifact. The installer auto-detects the target runtime and selects the appropriate backend. No project-specific knowledge needed.
  - **Graceful degradation:** Runtimes that can't support hooks (Odysseus → POLICY_CONFIGURED, Generic → DOCUMENT_ONLY) are honestly classified. The system never claims enforcement it cannot deliver.
  - **Single source of truth:** `.agent-governance/` is the canonical location for all governance artifacts. No scattered policy files across `.opencode/`, `.hermes/`, and project root.
  - **Version-locked integrity:** `source-lock.json` provides a cryptographic chain of trust from installation to every tool call.
  - **Extensible:** Adding a new runtime means adding a new thin adapter hook in `backends/<runtime>/`. The broker, policies, and evidence system are unchanged.
- **Cons:**
  - **Architectural complexity:** Two planes, four enforcement levels, runtime-specific backends, broker process, tamper detection — this is a significant addition to the codebase.
  - **Node.js dependency for broker:** The broker (`runtime/broker.mjs`) requires Node.js. For pure Python projects, this means an additional runtime dependency. Mitigation: The broker can be ported to Python in the future; the architecture does not hard-depend on Node.js — only the current implementation does.
  - **Performance overhead:** Every tool call passes through the hook → tool mapping → tamper check → broker → gate evaluation → decision → back to hook. For high-frequency tool calls (e.g., `read` in a loop), this adds measurable latency. Mitigation: Decision caching for identical operation descriptors within the same session + tool name. Tamper check can be cached per file until the file's mtime changes.
  - **Startup complexity:** The hook, broker, and tamper detection must all be operational before the first tool call. If any component fails to initialize, the runtime enters fail-closed mode. This requires robust error handling during initialization.
  - **Cross-platform broker launch:** Launching the broker as a subprocess from a Python hook (Hermes) or a JavaScript hook (OpenCode) requires platform-specific process management. Mitigation: The broker can also run as a long-lived daemon started separately; the hook communicates via a local Unix socket or TCP port.

### Option E: Status Quo — No URL Installer, No `.agent-governance/`

- **Description:** Continue with the current architecture: policy files in `.opencode/policies/`, bootstrap scripts that copy files to target projects, handoff manifests for Hermes. No `.agent-governance/` directory, no URL-based installation, no runtime enforcement hooks.
- **Pros:**
  - No new code.
  - No migration cost.
  - Existing workflows continue unchanged.
- **Cons:**
  - The repository upgrade goal is not met — the repository remains a documentation/prompt collection, not a governance installer.
  - No URL-based installation — installation requires running `bootstrap-project.mjs` with knowledge of the repository's internal structure.
  - No runtime enforcement — the 19 kernel gates from ADR-003 have no runtime connection. They exist as code in `scripts/lib/gates/` and are never invoked at tool-execution time.
  - No tamper detection.
  - No honest enforcement levels — there is no way to know whether policies are actually being enforced at runtime.
- **Why rejected:** This is the starting point the task aims to evolve from. Without these decisions, ADR-003's kernel gates remain a compile-time artifact with no runtime presence.

---

## Consequences

### Positive

1. **Runtime enforcement becomes real:** The 19 kernel gates from ADR-003 transition from "documented invariants" to "executed before every tool call." A `git push --force` is not merely discouraged — it is structurally blocked.

2. **Honest capability claims:** The enforcement level matrix provides a truthful assessment of what each runtime can actually enforce. Odysseus is classified as `POLICY_CONFIGURED` (Level 1), not falsely claimed as `HOOK_ENFORCED`. This builds trust with users who need to know their actual security posture.

3. **URL-only installation lowers adoption friction:** A developer or CI pipeline can install governance with a single command referencing only the repository URL. No manual file copying, no configuration editing, no project-specific knowledge.

4. **Tamper detection builds trust:** The `source-lock.json` mechanism ensures that the enforcement runtime cannot be silently modified. If a malicious agent or compromised dependency modifies `broker.mjs`, the next tool call is blocked with a clear audit trail.

5. **Graceful degradation is architecturally honest:** Runtimes that cannot support hooks are not abandoned — they receive the best available enforcement level (POLICY_CONFIGURED or DOCUMENT_ONLY). The system is transparent about the gap.

6. **Single source of truth:** `.agent-governance/` consolidates all governance artifacts. There is no ambiguity about which policy files are active, which enforcement level is in effect, or where evidence is stored.

7. **Extensibility:** Adding a new runtime (e.g., a future "Agent-X") requires only: (a) a new thin adapter in `backends/agent-x/`, (b) a tool-mapping entry, (c) an enforcement level declaration. The broker, policies, and evidence system require no changes.

8. **Auditability:** Every gate decision is logged to `.agent-governance/evidence/decisions/` with full context (operation, tool, args, gates evaluated, classification, timestamp). This supports post-incident investigation and compliance auditing.

### Negative

1. **Node.js dependency:** The broker is implemented in Node.js (`broker.mjs`). For Python-only projects (e.g., a Hermes-centric project that doesn't otherwise use Node.js), this introduces a runtime dependency. The broker could be ported to Python in the future.

2. **Performance overhead on every tool call:** The full evaluation pipeline (tamper check → kernel gates → policy gates → project gates → adapter → decision) runs on every tool call. For an agent that makes 50+ tool calls in a session, this is 50+ evaluations. Mitigation: decision caching for repeated operations within the same scope.

3. **Increased architectural complexity:** Two planes, four enforcement levels, four runtime backends, tamper detection, IPC for BROKER_ENFORCED — this is a non-trivial system. Contributors must understand the architecture before making changes.

4. **Startup dependency chain:** The enforcement hook, broker, and tamper detection form a dependency chain at startup. If any link fails, the runtime enters fail-closed mode. This requires robust error handling and clear error messages.

5. **Cross-platform broker management:** Launching and managing the broker process from different runtimes (OpenCode JS hook, Hermes Python hook) requires platform-specific process management code. Windows vs. Unix process spawning, signal handling, and IPC differ.

6. **Git repository bloat:** `.agent-governance/` adds several files to the project repository. The `state/` and `evidence/` directories are gitignored, but the runtime, policies, and backends are committed. For a project that values minimal repository footprint, this is a tradeoff.

### Neutral

1. **The enforcement level is declared, not automatically upgraded:** When a runtime adds new hook capabilities (e.g., Odysseus ships a `pre_tool_call` hook in a future version), the enforcement level in `enforcement-level.json` does not automatically update. A human must re-run the installer or manually update the declaration. This is conservative by design — automatic capability re-evaluation could enable enforcement unexpectedly, which is a security risk.

2. **The broker is independent of the governance repository version:** `source-lock.json` pins the installed version to a specific commit. Updating the governance repository does not automatically update installed projects. Each project must explicitly re-run the installer to upgrade. This is the same model as dependency pinning.

3. **The `.agent-governance/` directory is opinionated:** Some projects may prefer a different directory name or location. The architecture could support a configurable directory name in the future, but the initial implementation uses `.agent-governance/` as the convention.

---

## Compliance with 19 Kernel Gates (ADR-003)

This ADR's runtime enforcement architecture is designed to **execute** the 19 kernel gates, not to modify them. The kernel gates remain immutable. The following table maps each kernel gate to its enforcement mechanism in the Two-Plane Architecture:

| Gate # | Gate Name | Enforcement Plane Role |
|--------|-----------|----------------------|
| 1 | NO_FORCE_PUSH | Broker checks command string in `tool.execute.before` / `pre_tool_call` args; matches `git push --force*` pattern → RED_BLOCK |
| 2 | NO_SECRET_LEAK | Broker scans file paths (`*.env*`, `*secret*`, `*credential*`, `*token*`) and content patterns before `write`/`edit` execution |
| 3 | NO_PATH_ESCAPE | Broker resolves all write/read paths against project root; `assertSafePath()` validation before any file I/O |
| 4 | NO_SYMLINK_ESCAPE | Broker walks path segments with `lstat()`; rejects symlink targets outside project boundary |
| 5 | NO_UNRELATED_WORKTREE_WRITE | Broker checks write paths against scope in active approval receipt; non-touch areas are protected |
| 6 | NO_PRODUCTION_WRITE_WITHOUT_APPROVAL | Broker checks paths/commands for `*production*` pattern; requires non-expired, scope-matched approval receipt |
| 7 | NO_REMOTE_ACTION_WITHOUT_SCOPED_APPROVAL | Broker classifies command as remote-mutating; validates approval receipt with matching action type, scope, and expiry |
| 8 | NO_FALSE_GREEN | Broker validates evidence completeness before classification; auto-downgrades GREEN_SAFE → AMBER_REVIEW if evidence missing |
| 9 | NO_FAKE_EXECUTION | Broker validates tool execution has actual output (exit code, stdout, stderr, timestamp); fabricated claims produce RED_BLOCK |
| 10 | NO_REVIEWER_WRITE | Broker checks agent role; `review-agent` has write capability permanently denied at kernel level |
| 11 | NO_APPLY_WITHOUT_BACKUP | Control plane: installer creates backup before first write. Enforcement plane: broker checks backup exists before allowing apply-mode writes |
| 12 | NO_ROLLBACK_WITHOUT_VALIDATED_MANIFEST | Control plane: rollback validates backup manifest hash against recorded hash from install run |
| 13 | NO_APPROVAL_REUSE | Broker checks consumed-nonce ledger; replay detection via nonce collision → RED_BLOCK |
| 14 | NO_CROSS_ACTION_APPROVAL | Broker compares approval receipt action type against requested action; mismatch → RED_BLOCK |
| 15 | NO_CROSS_SCOPE_APPROVAL | Broker checks write paths against approval receipt scope paths (glob matching); out-of-scope → RED_BLOCK |
| 16 | NO_EXPIRED_APPROVAL | Broker checks `Date.now() > approval.expires_at`; expired → RED_BLOCK |
| 17 | NO_RUNTIME_ADAPTER_OVERRIDE | Enforcement plane structural guarantee: kernel produces immutable base decision; adapter output is diffed; weakening → RED_BLOCK |
| 18 | NO_GLOBAL_RUNTIME_CONFIG_WRITE | Broker checks write paths against global config directories (`~/.opencode/`, `~/.hermes/`, `~/.config/opencode/`) |
| 19 | NO_AGPL_INCORPORATION | Broker checks for AGPL-licensed file reads within ecosystem source tree; arm's-length handoff only for Odysseus |

### Tamper Detection as Meta-Gate

The tamper detection check (step 1 in the canonical evaluation order) is effectively a **meta-gate** that protects all 19 kernel gates. If `broker.mjs` is tampered with, none of the 19 gates can be trusted to execute correctly. The tamper check runs BEFORE kernel gates to ensure the gate evaluator itself has integrity.

This is not a 20th kernel gate — it is a prerequisite for all 19 to be meaningful.

---

## Enforcement Matrix Per Runtime (Detailed)

### OpenCode — HOOK_ENFORCED (Level 2)

| Aspect | Detail |
|--------|--------|
| **Hook mechanism** | `tool.execute.before` in `.opencode/plugins/runtime-enforce.js` |
| **Auto-load** | `.opencode/plugins/` is auto-loaded at OpenCode startup |
| **Blocking** | `throw new Error("...")` in hook blocks tool execution |
| **Arg visibility** | Full: `input.tool` (tool name) + `output.args` (all arguments) |
| **Tool mapping** | Straightforward: `output.args.filePath` for file tools, `output.args.command` for bash, `output.args.url` for webfetch |
| **Broker integration** | Hook loads `../../.agent-governance/runtime/broker.mjs` via `import()`, calls `evaluate()` with operation descriptor, throws on RED_BLOCK |
| **Tamper detection** | Hook verifies its own hash + broker hash against `source-lock.json` on load |
| **Fail-closed** | If broker cannot be loaded → throw (block all tool calls) |
| **Limitations** | Agent context not in hook input (workaround: `client.session.get()` via SDK); no process isolation for broker |
| **Evidence** | Research report `url-installer-runtime-enforcement-research.md` sections 1–4 confirm all capabilities |

### Hermes — HOOK_ENFORCED (Level 2)

| Aspect | Detail |
|--------|--------|
| **Hook mechanism** | `pre_tool_call` hook via Python plugin at `~/.hermes/plugins/governance/` (installed via `hermes plugins install <git-url>`) |
| **Alternative** | Shell hook in `config.yaml` with `cwd` awareness for gateway mode |
| **Blocking** | `return {"action": "block", "message": "..."}` in Python hook OR stdout JSON from shell hook |
| **Arg visibility** | Full: `tool_name: str` + `args: dict` |
| **Tool mapping** | Straightforward: `args` dict contains tool-specific keys (`command` for terminal, `file_path` for write_file/read_file) |
| **Broker integration** | Hook spawns broker as Node.js subprocess with operation descriptor on stdin; reads gate decision JSON from stdout |
| **Tamper detection** | Python hook verifies broker hash against `source-lock.json` before spawning broker subprocess |
| **Fail-closed** | If broker subprocess crashes or returns non-zero → return `{"action": "block", "message": "..."}` |
| **Limitations** | Python `pre_tool_call` callback does NOT receive `cwd` (must use `os.getcwd()` or `__file__`-based project root detection); project-local plugins require `HERMES_ENABLE_PROJECT_PLUGINS=1`; shell hooks require `--accept-hooks` consent |
| **Evidence** | Research report `url-installer-runtime-enforcement-research.md` sections 5–10 confirm all capabilities |

### Odysseus — POLICY_CONFIGURED (Level 1)

| Aspect | Detail |
|--------|--------|
| **Mechanism** | `disabled_tools` deny-list configured via database settings; `ToolPolicy` per-turn composition |
| **Blocking** | Binary: tool name present in `disabled_tools` → BLOCKED error response |
| **Arg visibility** | None — block/allow decision is based on tool name only, no per-invocation argument inspection |
| **Tool mapping** | N/A — no per-invocation gate evaluation |
| **Broker integration** | N/A — no hook exists to connect to broker |
| **Tamper detection** | Manual: `disabled-tools.json` in `.agent-governance/backends/odysseus/` can be compared against `source-lock.json` manually |
| **Fail-closed** | N/A — deny-list is the only mechanism; if list is empty, no tools are blocked |
| **Limitations** | Bash and Python are NOT sandboxed — bypass via subprocess. No pre-tool-execution hook. Deny-list is content-unaware. Prompt-based restrictions are advisory, not enforcement. Background jobs (`#!bg`) detach from tool lifecycle and are not restricted by `disabled_tools`. |
| **Classification rationale** | `POLICY_CONFIGURED` (not `DOCUMENT_ONLY`) because the `disabled_tools` mechanism is a runtime-enforced deny-list, not mere documentation. However, it does not meet `HOOK_ENFORCED` criteria because there is no per-invocation hook, no argument inspection, no gate evaluation, and no fail-closed safety. |
| **Evidence** | Research report `odysseus-enforcement-research.md` confirms: no `pre_tool_call` hook, `disabled_tools` is binary, bash/Python not sandboxed |

### Generic — DOCUMENT_ONLY (Level 0) or TOOL_GAP

| Aspect | Detail |
|--------|--------|
| **Mechanism** | Policy files written to `.agent-governance/policies/`. No hook connection possible. |
| **Blocking** | None — policies are documentation only |
| **Arg visibility** | N/A |
| **Broker integration** | N/A |
| **Tamper detection** | Manual: `verify.mjs` can be run manually to check file hashes |
| **Classification rationale** | The runtime's capabilities are unknown. Without knowing whether any hook mechanism exists, the honest classification is `DOCUMENT_ONLY` (if policy files are present) or `TOOL_GAP` (if no integration is possible at all). |

---

## References

### Architecture Decisions
- [ADR-001: Universal Project Bootstrap](universal-bootstrap.md) — Project-local bootstrap architecture, dry-run default, apply explicit
- [ADR-003: Runtime-Neutral Hard Gate Kernel](runtime-neutral-gate-kernel.md) — 19 kernel gate invariants, three-layer gate architecture, approval receipt model, adapter contract

### Research Reports
- `docs/reports/url-installer-runtime-enforcement-research.md` — OpenCode plugin/hook API (sections 1–4) and Hermes plugin/hook API (sections 5–10) with enforcement capability verification
- `docs/reports/odysseus-enforcement-research.md` — Odysseus tool dispatch architecture, absence of pre-tool hooks, `disabled_tools` mechanism, bash/python bypass vectors
- `docs/reports/gate-kernel-security-review.md` — 27 identified design vulnerabilities in ADR-003, including capability self-declaration trust and deep-freeze protection
- `docs/reports/gate-kernel-compliance-review.md` — AGPL boundary and DSGVO compliance assessment of ADR-003, path redaction and PII minimization requirements

### Implementation Artifacts
- `scripts/lib/gates/evaluate-all.mjs` — Canonical gate evaluation entry point (created before this ADR)
- `scripts/lib/gates/kernel.mjs` — 19 kernel gate implementations
- `scripts/lib/runtimes/` — Runtime adapter implementations (OpenCode, Hermes, Odysseus, Generic)

### External Documentation
- OpenCode Plugin API: https://opencode.ai/docs/plugins/
- OpenCode Permissions: https://opencode.ai/docs/permissions/
- Hermes Event Hooks: https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/
- Hermes Plugin System: https://hermes-agent.nousresearch.com/docs/developer-guide/plugins/

---

*End of ADR-004.*
