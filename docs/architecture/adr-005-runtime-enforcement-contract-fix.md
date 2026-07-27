# ADR-005: Fix Runtime Enforcement Contracts and Restore Evidence-Gated Enforcement Claims

**Status:** Proposed

**Date:** 2026-07-16

**Deciders:** Architecture Agent (delegated from issue-orchestrator)

**Supersedes:** None. Fixes contract violations in ADR-004 (URL Installer Runtime Enforcement) and ADR-003 (Runtime-Neutral Hard Gate Kernel) implementations.

> **HISTORICAL / SUPERSEDED PATHS:** This ADR records an earlier design and
> review state. Its plural `.opencode/plugins/` paths are not the active Issue
> #16 contract. The current verified bridge is
> `.opencode/plugin/governance-v2.ts`.

---

## Context

### What Problem Does This Solve?

ADR-004 defined the Two-Plane Architecture for runtime enforcement with `.agent-governance/`, the four-level enforcement taxonomy, tamper detection via `source-lock.json`, and the resident runtime installation model. The implementation on branch `agent/url-installer-runtime-enforcement` (PR #7) claims `HOOK_ENFORCED` for OpenCode and Hermes runtimes. However, a systematic contract audit reveals **8 verifiable contract violations** across the plugin, installer, evaluator, and hook components. These violations mean:

1. The OpenCode plugin does not conform to the official OpenCode plugin contract — it is **not loadable** by OpenCode.
2. The Hermes hook never calls the canonical evaluator — it operates as a standalone, inline duplicate.
3. The installed runtime imports break due to flat directory copying.
4. The source-lock.json schema is inconsistent between writer and readers.
5. A fail-open path exists that silently allows operations when runtime files are deleted.
6. Enforcement level claims are hardcoded without evidence.
7. The approval gate decision contract does not block on missing required approvals.

**The net effect:** The repository claims runtime enforcement but the enforcement artifacts are structurally broken — they would not work if deployed.

### The 8 Contract Violations

#### R-001: OpenCode Plugin Export Does Not Match Official Plugin Contract

**Files:**
- `.opencode/plugins/canonical-governance.mjs` (line 285)

**What the code does:**
```js
export const hooks = {
  'tool.execute.before': async function (input, output) {
    return handleToolExecution(input, output);
  },
};
```

This directly exports a `hooks` object with event handlers.

**What the official OpenCode plugin contract requires** (verified from https://opencode.ai/docs/plugins/, accessed 2026-07-16):

> A plugin is a JavaScript/TypeScript module that exports one or more plugin functions. Each function receives a context object and returns a hooks object.

```js
export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => { ... }
  }
}
```

The export must be a **named async factory function** receiving the context object `{ project, client, $, directory, worktree }` and returning the hooks. The current code exports a plain `hooks` object — this is a completely different module shape and will not be recognized as a plugin by OpenCode's plugin loader.

#### R-002: Resident Runtime Directory Structure Breaks Import Paths

**Files:**
- `scripts/install-governance.mjs` function `getRuntimeFileList()` (lines 134–151)
- `scripts/lib/gates/evaluate-all.mjs` (lines 36–40)

**What the code does:**
`getRuntimeFileList()` copies all 14 source files into a **single flat** `.agent-governance/runtime/` directory:

```js
{ source: "scripts/lib/gates/evaluate-all.mjs", dest: "evaluate-all.mjs" },
{ source: "scripts/lib/gates/kernel.mjs",       dest: "kernel.mjs" },
// ...
{ source: "scripts/lib/runtimes/contract.mjs",  dest: "contract.mjs" },
{ source: "scripts/lib/runtimes/generic.mjs",   dest: "generic.mjs" },
{ source: "scripts/lib/runtimes/opencode.mjs",  dest: "opencode.mjs" },
{ source: "scripts/lib/runtimes/hermes.mjs",    dest: "hermes.mjs" },
{ source: "scripts/lib/runtimes/odysseus.mjs",  dest: "odysseus.mjs" },
```

However, `evaluate-all.mjs` has 5 imports from `../runtimes/`:

```js
import { normalizeRuntime, ... } from '../runtimes/contract.mjs';  // line 36
import * as genericAdapter from '../runtimes/generic.mjs';          // line 37
import * as opencodeAdapter from '../runtimes/opencode.mjs';        // line 38
import * as hermesAdapter from '../runtimes/hermes.mjs';            // line 39
import * as odysseusAdapter from '../runtimes/odysseus.mjs';        // line 40
```

**Result in the target project after installation:**

```
.agent-governance/
└── runtime/
    ├── evaluate-all.mjs     ← imports '../runtimes/contract.mjs'
    ├── kernel.mjs
    ├── policy.mjs
    ├── decision.mjs
    ├── contract.mjs         ← exists HERE, not at '../runtimes/contract.mjs'
    ├── generic.mjs          ← exists HERE, not at '../runtimes/generic.mjs'
    ├── opencode.mjs         ← ...
    ├── hermes.mjs
    ├── odysseus.mjs
    └── ...
```

The path `../runtimes/contract.mjs` resolves to `.agent-governance/runtimes/contract.mjs` — a directory that does not exist. **All 5 runtimes imports fail.** The `evaluate-all.mjs` module will throw at load time.

This means the OpenCode hook (which calls `evaluateByGate()` → `loadEvaluateModule()`) will fail to load the module, triggering the fail-open path in R-004.

#### R-003: Source-Lock Schema Inconsistency Between Writer and Readers

**Files:**
- `scripts/install-governance.mjs` function `generateSourceLock()` (lines 399–437)
- `.opencode/plugins/canonical-governance.mjs` function `validateRuntimeIntegrity()` (lines 43–66)
- `integrations/hermes/gate_hook.py` function `pre_tool_call_handler()` (lines 68–90)

**What the installer writes** (line 430):
```json
{
  "source_repository": "...",
  "source_commit": "abc123...",
  "installed_at": "2026-07-16T...",
  "runtime_hashes": {
    "evaluate-all.mjs": "sha256:1a2b3c4d...",
    "kernel.mjs": "sha256:2b3c4d5e..."
  },
  "enforcement_version": "1.0.0"
}
```
Schema: `runtime_hashes` is a flat object with `{ "filename.mjs": "sha256:hex" }`.

**What the OpenCode plugin reads** (line 46, 50–51):
```js
if (!lock.files || !Array.isArray(lock.files)) {  // expects 'files' key, array
  return { valid: false, reason: '...missing files array' };
}
for (const entry of lock.files) {                   // iterates as array
  const filePath = join(GOVERNANCE_ROOT, entry.path); // expects entry.path
  const actualHash = sha256(content);
  if (actualHash !== entry.hash) { ... }             // expects entry.hash
}
```
Schema: `files` is an array of `[{ path, sha256, size }]` objects.

**What the Hermes hook reads** (lines 72–76):
```python
runtime_hashes = lock_data.get("runtime_hashes", {})  # uses 'runtime_hashes' object
for filename, expected_hash in runtime_hashes.items():
    file_path = runtime_dir / filename
    actual_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
    if actual_hash != expected_hash.split(":")[-1]:    # strips 'sha256:' prefix
```

The Hermes hook reads `runtime_hashes` (matching the installer's write schema), but the OpenCode plugin reads `files` (a completely different schema). Neither reader agrees with the other. The Hermes hook can technically read the installer's output (though key by key and stripping the prefix), but the OpenCode plugin cannot — it looks for `lock.files` which never exists in the installed file.

#### R-004: Fail-Open Gate Decision — NOOP Treated as Allow

**Files:**
- `.opencode/plugins/canonical-governance.mjs` function `evaluateByGate()` (line 154)
- `.opencode/plugins/canonical-governance.mjs` function `handleToolExecution()` (line 246)

**The fail-open path:**

1. If the runtime files are deleted from `.agent-governance/runtime/`, `loadEvaluateModule()` at line 68–77 tries to `import(EVALUATE_PATH)` — which fails (file not found).
2. It returns `null`.
3. `evaluateByGate()` at line 152 checks: `if (!mod || typeof mod.evaluateAllGates !== 'function')`.
4. It returns `{ decision: 'NOOP', reason: 'gate evaluator not available' }` — the evaluator silently gives up.
5. Back in `handleToolExecution()` at line 243–247:
```js
switch (decision) {
    case 'GREEN':
    case 'ALLOW':
    case 'NOOP':           // ← NOOP is treated as ALLOW
      return undefined;    // ← allows the tool call
```

**The failure mode:** If the runtime files are deleted, the plugin:
- Does **not** block the tool call
- Does **not** log a CRITICAL error or throw
- **Silently allows all operations** with no gate evaluation

This is directly contrary to ADR-004's fail-closed design principle (Section: "FAIL-CLOSED SAFETY"): *"If broker cannot load → BLOCK (fail-closed)"*.

#### R-005: Hermes Hook Never Calls Canonical Evaluator — Duplicates Kernel Logic

**Files:**
- `integrations/hermes/gate_hook.py` function `pre_tool_call_handler()` (lines 52–121)
- `integrations/hermes/runtime_client.py` function `evaluate()` (lines 87–162)

**What the hook does:**
`pre_tool_call_handler()` performs ONLY inline regex checks:
- Lines 97–108: Checks for `--force`, `-f` + `push`, `rm -rf`, `DROP TABLE`, `format`
- Lines 111–118: Checks write paths against governance root

**What the hook does NOT do:**
- Never imports `runtime_client`
- Never calls `runtime_client.evaluate()`
- Never invokes the canonical `evaluate-all.mjs` entry point
- Never evaluates the 19 kernel gates defined in ADR-003
- Never evaluates policy gates, project gates, or runtime adapter gates
- Never produces a machine-readable gate decision JSON
- Never writes evidence to `.agent-governance/evidence/`

**The duplication problem:** The inline regex checks in `gate_hook.py` (lines 97–108) duplicate logic from:
- `kernel.mjs` (NO_FORCE_PUSH, NO_SECRET_LEAK, NO_PATH_ESCAPE gates)
- `canonical-governance.mjs` `determineBashAction()` (lines 89–112)

This means any change to kernel gates requires synchronized updates in three separate places — the canonical kernel, the OpenCode plugin, and the Hermes hook. This violates the DRY principle established in ADR-004 (Option D: "DRY gate logic: The 19 kernel gates are implemented exactly once in the broker").

#### R-006: Hermes Runtime Client Searches for Non-Existent File

**Files:**
- `integrations/hermes/runtime_client.py` function `find_evaluator()` (lines 48–72)

**What the code does** (line 65):
```python
candidates.append(
    Path(governance_root)
    / ".agent-governance"
    / "runtime"
    / "evaluate-gates.mjs"    # ← THIS FILE DOES NOT EXIST
)
```

**What actually exists:**
- `scripts/lib/gates/evaluate-all.mjs` — The canonical evaluation entry point (453-line module)
- `.agent-governance/bin/evaluate.mjs` — The CLI wrapper installed by the installer (copied from repo source)

There is no file named `evaluate-gates.mjs` anywhere in the repository. Even if the Hermes hook were to call `runtime_client.evaluate()` (fixing R-005), the evaluator would not be found.

#### R-007: Enforcement Level Claim Is Hardcoded Without Evidence

**Files:**
- `integrations/hermes/gate_hook.py` function `governance_status()` (lines 131–140)
- `.opencode/plugins/canonical-governance.mjs` (line 285 — plugin registration)

**What `governance_status()` returns** (line 139):
```python
return {
    "message": f"Governance: INSTALLED at {gov_root}\nEnforcement Level: HOOK_ENFORCED (pre_tool_call active)\nRuntime: Hermes v0.18.2"
}
```

This is hardcoded. There is:
- No check that the `pre_tool_call` hook is actually registered with Hermes
- No test execution to verify the hook fires
- No attestation that the hook can block a tool call
- No validation that the evaluator module is loadable

Per ADR-004's enforcement level evidence requirements, `HOOK_ENFORCED` requires:
> "Hook registration evidence; test showing a blocked tool call; test showing an allowed tool call; test showing the hook fires on all tool types"

None of this evidence is collected or checked. The claim is aspirational, not evidence-backed.

Additionally, the OpenCode plugin itself violates the plugin contract (R-001), meaning it cannot even register a hook — the plugin is structurally incapable of enforcement.

#### R-008: `createGateDecision()` Does Not Set `allowed=false` When Required Approvals Are Missing

**Files:**
- `scripts/lib/gates/decision.mjs` function `createGateDecision()` (lines 43–170)
- `scripts/lib/gates/decision.mjs` function `determineRequiredApprovals()` (lines 175–220)

**What `determineRequiredApprovals()` does correctly** (lines 175–220):
Lists the approval types required for the action and risk tier:
- `HIGH_HUMAN_GATE` → `owner_approval`, `security_screening`, `compliance_screening`
- `MEDIUM_REVIEW` → `peer_review`
- `CRITICAL_BLOCK` → `blocker_resolution`
- Action-specific: `push_approval` for push, `apply_approval` for apply

**What `createGateDecision()` does at line 69:**
```js
const allowed = classification === CLASSIFICATIONS.GREEN_SAFE;
```

The `allowed` boolean is derived **solely** from the classification resolution of kernel, policy, project, and adapter results. It does **not** consider whether the required approvals have been satisfied by the consumed approvals.

**The gap:** If a HIGH_HUMAN_GATE risk tier action has all kernel gates passing (GREEN_SAFE classification), but zero valid approval receipts exist, the decision will have:
```json
{
  "classification": "GREEN_SAFE",
  "allowed": true,
  "requiredApprovals": [
    { "type": "owner_approval", "required": true, "gate": "human" },
    { "type": "security_screening", "required": true }
  ],
  "consumedApprovals": [],          // EMPTY — no approvals consumed
  "approvalIssues": []
}
```

A consuming hook that checks only `decision.allowed` will allow the operation despite missing required approvals. The approval gate is effectively advisory — it lists what is needed but does not block when absent.

### Forces at Play

| Force | Direction |
|-------|-----------|
| **Contract fidelity** | Every component must conform to its documented contract. The OpenCode plugin must match the official plugin API. The Hermes hook must call the canonical evaluator. The source-lock schema must be consistent. |
| **Fail-closed safety** | The default must be safety. A deleted runtime, a missing evaluator, or an unloadable module must block tool calls — never silently allow them. ADR-004 explicitly mandates fail-closed. |
| **Evidence-backed claims** | No enforcement level may be claimed without verifiable technical evidence. HOOK_ENFORCED requires proof that hooks fire, block, and cover all tool types. |
| **DRY gate logic** | The 19 kernel gates must be implemented once and invoked by all runtimes. Inline duplicates create drift and increase maintenance cost. |
| **Approval enforcement** | Required approvals must block operations when absent. Listing required approvals without checking them makes the approval gate a documentation artifact. |
| **Two-stage installation** | ADR-004 does not distinguish between "files are installed" and "hook is actively enforcing at runtime." The new taxonomy must account for the restart/management requirements of hook registration. |

---

## Decision

Implement comprehensive fixes for all 8 contract violations, introduce a two-stage installation model with expanded enforcement level taxonomy, and restore fail-closed safety across all execution paths.

### Decision 1: Fix OpenCode Plugin Export (R-001)

**Fix:** Replace the plain `hooks` object export with a named async factory function matching the official OpenCode plugin contract.

**From:**
```js
export const hooks = {
  'tool.execute.before': async function (input, output) {
    return handleToolExecution(input, output);
  },
};
```

**To:**
```js
export const CanonicalGovernancePlugin = async ({ project, client, $, directory, worktree }) => {
  const GOVERNANCE_ROOT = project ? `${project}/.agent-governance` : `${process.cwd()}/.agent-governance`;
  // ... initialization logic using context ...

  return {
    'tool.execute.before': async (input, output) => {
      return handleToolExecution(input, output);
    }
  };
};
```

**Rationale:** The official OpenCode plugin contract (verified from https://opencode.ai/docs/plugins/ on 2026-07-16) requires a named async function returning a hooks object. The function receives `{ project, client, $, directory, worktree }`. Any other export shape will not be recognized by OpenCode's plugin loader. This fix is a prerequisite for the plugin to even be loadable.

### Decision 2: Fix Runtime Directory Structure (R-002)

**Fix:** Preserve the `gates/` and `runtimes/` subdirectory structure when copying runtime files. The installed structure will be:

```
.agent-governance/
└── runtime/
    ├── gates/                    ← was flat; now subdirectory
    │   ├── evaluate-all.mjs
    │   ├── kernel.mjs
    │   ├── policy.mjs
    │   ├── decision.mjs
    │   ├── approval.mjs
    │   ├── evidence.mjs
    │   ├── classifications.mjs
    │   ├── errors.mjs
    │   └── context-fingerprint.mjs
    └── runtimes/                 ← was flat; now subdirectory
        ├── contract.mjs
        ├── generic.mjs
        ├── opencode.mjs
        ├── hermes.mjs
        └── odysseus.mjs
```

**Changes to `getRuntimeFileList()`:**
```js
function getRuntimeFileList() {
  return [
    { source: "scripts/lib/gates/evaluate-all.mjs",       dest: "gates/evaluate-all.mjs" },
    { source: "scripts/lib/gates/kernel.mjs",             dest: "gates/kernel.mjs" },
    { source: "scripts/lib/gates/policy.mjs",             dest: "gates/policy.mjs" },
    // ...
    { source: "scripts/lib/runtimes/contract.mjs",        dest: "runtimes/contract.mjs" },
    { source: "scripts/lib/runtimes/generic.mjs",         dest: "runtimes/generic.mjs" },
    // ...
  ];
}
```

**Changes to `copyRuntimeFiles()`:** The `dest` path must be joined to `runtime/` and the parent directory (`gates/` or `runtimes/`) must be created before copying.

**Changes to imports in plugin/hook:** Update references to the new paths. The OpenCode plugin's `EVALUATE_PATH` changes from `runtime/evaluate-all.mjs` to `runtime/gates/evaluate-all.mjs`.

**Rationale:** The `evaluate-all.mjs` module uses 5 relative imports from `../runtimes/`. These resolve correctly in the source repo (`scripts/lib/gates/` → `scripts/lib/runtimes/`). Preserving the subdirectory structure in the installed target preserves these import paths without requiring any changes to `evaluate-all.mjs` itself. This is the minimal-change fix.

### Decision 3: Unify Source-Lock Schema (R-003)

**Fix:** Adopt a single unified `source-lock.json` schema for both writer and all readers. The schema will use the `files` array format (consistent with the OpenCode plugin's existing reader code) because it is the more expressive format — it supports `path`, `sha256`, and `size` per file, and is easily extensible.

**Unified schema:**
```json
{
  "version": "1.0.0",
  "governance_version": "0.2.0",
  "installed_at": "2026-07-16T10:00:00.000Z",
  "installed_from": "https://github.com/...",
  "installed_commit": "abc123def456",
  "target_runtime": "opencode",
  "enforcement_level": "RESTART_REQUIRED",
  "files": [
    { "path": "runtime/gates/evaluate-all.mjs",  "sha256": "1a2b3c4d...", "size": 12345 },
    { "path": "runtime/gates/kernel.mjs",        "sha256": "2b3c4d5e...", "size": 23456 },
    { "path": "runtime/runtimes/contract.mjs",   "sha256": "3c4d5e6f...", "size": 34567 }
  ],
  "locked_by": "install-governance.mjs",
  "lock_timestamp": "2026-07-16T10:00:01.000Z"
}
```

**Changes required:**
1. `generateSourceLock()` — generate `files` array instead of `runtime_hashes` object
2. `validateRuntimeIntegrity()` (canonical-governance.mjs) — already reads `files` array; no change needed
3. `pre_tool_call_handler()` (gate_hook.py) — migrate from `runtime_hashes` dict iteration to `files` array iteration with `path` and `sha256` fields
4. Remove the `sha256:` prefix stripping in gate_hook.py (line 79) — store raw hex hashes

**Rationale:** The `files` array format is the more expressive and extensible schema. It matches the OpenCode plugin's existing reader, aligns with common lockfile conventions (npm's `package-lock.json`, Go's `go.sum`), and supports future addition of fields like `size`, `mtime`, or `permissions`.

### Decision 4: Fix Fail-Open `NOOP` Gate Decision (R-004)

**Fix:** Change `evaluateByGate()` to return `RED_BLOCK` (not `NOOP`) when the evaluator module cannot be loaded or does not export the expected function. Remove `NOOP` from the list of allowed decisions.

**Changes to `evaluateByGate()`** (line 151–162):
```js
async function evaluateByGate(descriptor) {
  const mod = await loadEvaluateModule();
  if (!mod || typeof mod.evaluateAllGates !== 'function') {
    // CRITICAL: Gate evaluator unavailable — FAIL CLOSED
    return {
      decision: 'RED_BLOCK',
      reason: 'CRITICAL: Gate evaluator module (evaluate-all.mjs) not found or does not export evaluateAllGates. Runtime enforcement is compromised. All operations blocked.',
      classification: 'RED_BLOCK',
      blockedBy: [{
        gateId: 'EVALUATOR_UNAVAILABLE',
        code: 'EVALUATOR_UNAVAILABLE',
        message: 'Canonical gate evaluator not loadable — runtime enforcement is non-functional.',
        layer: 'runtime'
      }]
    };
  }
  // ... rest of function unchanged
}
```

**Changes to `handleToolExecution()` switch statement** (line 243–247):
- Remove `case 'NOOP':` from allow switch
- Add `'NOOP'` to the unknown-decision default block (which already fails-closed for writes)

**Rationale:** ADR-004's fail-closed safety design explicitly states: "If broker cannot load → BLOCK (fail-closed)" and "If broker throws unhandled exception → BLOCK (fail-closed)." A missing evaluator module is the most severe form of broker failure — the enforcement runtime is fundamentally non-functional. `NOOP` as an allow decision is the opposite of fail-closed; it is fail-open. This violates the core safety invariant of the Two-Plane Architecture.

### Decision 5: Connect Hermes Hook to Canonical Evaluator (R-005)

**Fix:** Refactor `pre_tool_call_handler()` to delegate to `runtime_client.evaluate()` instead of performing inline regex checks. The Hermes hook becomes a thin adapter that:
1. Maps the Hermes tool name to a neutral operation descriptor
2. Calls `runtime_client.evaluate(descriptor)`
3. Acts on the returned gate decision

**From (inline checks):**
```python
# 3. For write and external tools, enforce gate evaluation
if tool_name in WRITE_TOOLS or tool_name in EXTERNAL_TOOLS:
    descriptor = _map_hermes_tool(tool_name, args)
    # ... inline regex checks (97-118) ...
```

**To (delegation to canonical evaluator):**
```python
from .runtime_client import evaluate

def pre_tool_call_handler(tool_name, args, session_id=None):
    gov_root = _find_governance_root()
    if gov_root is None:
        # No governance — block writes, allow reads (structural default)
        if tool_name in WRITE_TOOLS or tool_name in EXTERNAL_TOOLS:
            return {"action": "block", "message": "Governance not installed..."}
        return None

    descriptor = _map_hermes_tool(tool_name, args)
    decision = evaluate(descriptor, governance_root=str(gov_root))

    if decision.get("classification") == "TOOL_GAP":
        # Evaluator unavailable — fail-closed
        if tool_name in WRITE_TOOLS or tool_name in EXTERNAL_TOOLS:
            return {"action": "block", "message": block_message(decision)}
        return None

    if not decision.get("allowed", False):
        return {"action": "block", "message": block_message(decision)}

    return None  # allow
```

**Remove:** All inline regex checks (lines 97–118) — these are now handled by the canonical evaluator's kernel gates.

**Rationale:** ADR-004 (Option D) explicitly chose the "Hook + Shared Broker" architecture: "all runtime hooks are thin adapters that delegate to the broker." The Hermes hook's inline checks violate this design — they duplicate kernel gate logic and bypass the canonical evaluation pipeline. The hook MUST delegate to the canonical evaluator to ensure:
- The same 19 kernel gates are evaluated for both OpenCode and Hermes
- Policy gates and project gates are evaluated (currently skipped by Hermes)
- Gate decisions are logged to `.agent-governance/evidence/` (currently not done by Hermes)
- Drift between runtime implementations is prevented

### Decision 6: Fix Hermes Evaluator Path (R-006)

**Fix:** Update `find_evaluator()` to search for the correct file path. Since the runtime is being restructured (R-002), the canonical path becomes:

```python
def find_evaluator(governance_root=None):
    candidates = []
    if governance_root:
        # Primary: installed project-local runtime (subdirectory structure from R-002)
        candidates.append(
            Path(governance_root)
            / ".agent-governance"
            / "runtime"
            / "gates"
            / "evaluate-all.mjs"
        )
        # Fallback: CLI wrapper (if available)
        candidates.append(
            Path(governance_root)
            / ".agent-governance"
            / "bin"
            / "evaluate.mjs"
        )
    # Fallback: plugin checkout itself
    candidates.append(_plugin_repo_root() / "scripts" / "lib" / "gates" / "evaluate-all.mjs")

    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    return None
```

**Rationale:** `evaluate-gates.mjs` does not exist. The canonical entry point is `evaluate-all.mjs` (per ADR-003 and ADR-004). The CLI wrapper at `bin/evaluate.mjs` is a secondary fallback.

### Decision 7: Implement Evidence-Gated Enforcement Level Taxonomy (R-007)

**Fix:** Replace the hardcoded `HOOK_ENFORCED` claim with a new, expanded enforcement level taxonomy that requires verifiable evidence for each level. Implement two-stage installation to distinguish structural installation from active enforcement.

**New Enforcement Level Taxonomy:**

| Level | Name | What It Means | Evidence Required | Auto-Assigned? |
|-------|------|--------------|-------------------|----------------|
| **0** | `DOCUMENT_ONLY` | Policy files present but not connected to any runtime hook. | Static file presence check only. | Yes (installer default for unknown runtimes) |
| **1** | `POLICY_CONFIGURED` | Policy files present AND connected to a runtime configuration mechanism (deny lists, disabled_tools). Blocking by tool name only. | Config file showing deny rules; evidence runtime reads them. | Yes (installer detection) |
| **2** | `STRUCTURAL_HOOK_INSTALLED` | Hook files are installed in the correct runtime location (`.opencode/plugins/`, `.hermes/plugins/`). The runtime CAN load them. Their code is structurally correct (conforms to plugin API). | File presence check; static analysis of export shape (named async function); lint/syntax check. | Yes (installer Stage A) |
| **3** | `RESTART_REQUIRED` | Hooks are installed (Level 2 satisfied) but the runtime has NOT been restarted. The hook files will take effect after the next runtime restart/reload. | Level 2 evidence + detection that the runtime process predates the installation timestamp. | Yes (installer Stage A completion, runtime running during install) |
| **4** | `MANAGED_HOOK_ENFORCED` | Hook is actively registered and enforcing. Verified by: (a) runtime attestation that the hook is loaded, (b) allow-test (a safe tool call passes through), (c) block-test (a test-destructive tool call is blocked). | Level 3 evidence + hook-loaded attestation from runtime + allow-test output + block-test output. | No — requires new MANAGED session after restart |
| **5** | `BROKER_ENFORCED` | Same as MANAGED_HOOK_ENFORCED, but the enforcement logic runs in a SEPARATE process. Fail-closed if broker process terminates. | All Level 4 evidence + broker process verification + IPC channel verification + fail-closed test (kill broker, verify tool calls blocked). | No — requires explicit broker deployment |
| **6** | `TOOL_GAP` | A required tool/runtime/dependency is missing. Enforcement cannot proceed. | Tool discovery output; runtime state; classification rationale. | Yes (installer preflight) |
| **7** | `FAILED` | Enforcement was attempted but failed. Hook registered but threw errors. Evaluator crashed. Tamper detection triggered. | Error logs; crash stack traces; tamper evidence. | Yes (runtime error) |

**Two-Stage Installation Model:**

```
STAGE A (Installer — structural):
  ├── Copies all runtime files to .agent-governance/
  ├── Copies hook files to runtime plugin directories
  ├── Generates source-lock.json
  ├── Produces manifest.json with enforcement_level: "RESTART_REQUIRED"
  └── Produces installation receipt

  [Runtime must be RESTARTED to load hooks]

STAGE B (Runtime — managed session):
  ├── Runtime starts → loads hooks (plugin registration)
  ├── Hook performs attestation:
  │   ├── 1. Verify source-lock.json integrity (tamper check)
  │   ├── 2. Load evaluator module (verify it imports successfully)
  │   ├── 3. Execute allow-test: safe tool call → expect pass-through
  │   └── 4. Execute block-test: destr. tool call → expect block
  ├── Attestation passes → upgrade to MANAGED_HOOK_ENFORCED
  ├── Attestation fails → downgrade to FAILED (with reason)
  └── enforcement_level updated in runtime state (not manifest.json)
```

**Changes to `governance_status()`:**
- Read enforcement level from `.agent-governance/manifest.json` (structural level)
- Read live enforcement level from `.agent-governance/state/session-state.json` (managed level)
- Return BOTH levels with evidence references:
```python
def governance_status(args, session_id=None):
    gov_root = _find_governance_root()
    if gov_root is None:
        return {"message": "Governance: NOT_INSTALLED"}
    manifest = json.loads((gov_root / ".agent-governance/manifest.json").read_text())
    structural_level = manifest.get("enforcement_level", "UNKNOWN")
    # Check live state
    state_file = gov_root / ".agent-governance" / "state" / "session-state.json"
    live_level = "NOT_ACTIVE"
    if state_file.exists():
        state = json.loads(state_file.read_text())
        live_level = state.get("enforcement_level", "NOT_ACTIVE")
    return {
        "message": (
            f"Governance: INSTALLED at {gov_root}\n"
            f"Structural Level: {structural_level}\n"
            f"Live Enforcement Level: {live_level}"
        )
    }
```

**Rationale:**
1. The original four-level taxonomy (ADR-004) did not distinguish between "files are installed" and "hook is actively enforcing." A hook file sitting on disk but not loaded by the runtime should not claim HOOK_ENFORCED.
2. `RESTART_REQUIRED` is an honest intermediate state. Most installations will require a runtime restart to load the plugin — the taxonomy must reflect this reality.
3. `STRUCTURAL_HOOK_INSTALLED` captures the case where the file is present and structurally correct (conforms to plugin API) but we don't know if it's loaded.
4. `MANAGED_HOOK_ENFORCED` is only claimable after a new managed session that performs attestation tests. This replaces the original HOOK_ENFORCED with an evidence-gated variant.
5. `FAILED` captures the case where enforcement was attempted but failed — distinct from TOOL_GAP (not attempted because dependencies missing).

### Decision 8: Fix Approval Gate Enforcement in Gate Decision (R-008)

**Fix:** In `createGateDecision()`, after resolving classification from kernel/policy/project/adapter results, add an approval satisfaction check. If required approvals are not satisfied by consumed approvals, downgrade the classification and set `allowed=false`.

**New logic** inserted after line 69 (`const allowed = classification === CLASSIFICATIONS.GREEN_SAFE;`):

```js
// Phase: Approval satisfaction check
// If required approvals exist but are not consumed, the operation is not allowed
const requiredTypes = requiredApprovals
  .filter(r => r.required)
  .map(r => r.type);

const consumedTypes = consumedApprovals.map(a => a.action || a.type);

const missingApprovals = requiredTypes.filter(t => !consumedTypes.some(ct =>
  ct === t || ct.includes(t) || t.includes(ct)
));

if (missingApprovals.length > 0) {
  // Downgrade: even if all gates pass, missing approvals block the operation
  if (classification === CLASSIFICATIONS.GREEN_SAFE) {
    // eslint-disable-next-line no-param-reassign
  }
  // Add missing approvals as blocked-by entries
  for (const mt of missingApprovals) {
    blockedBy.push({
      gateId: `APPROVAL_REQUIRED_${mt.toUpperCase()}`,
      code: `APPROVAL_MISSING_${mt.toUpperCase()}`,
      message: `Required approval "${mt}" is missing or not consumed.`,
      layer: 'approval'
    });
  }

  // Re-resolve classification with approval blocks
  const approvalBlocked = {
    classification: CLASSIFICATIONS.AMBER_REVIEW,
    verificationLevel: VERIFICATION_LEVELS.STRUCTURAL_PASS
  };
  const allWithApproval = [...allResults, approvalBlocked];
  const { classification: newClassification } = resolveClassification(allWithApproval);

  decision.classification = newClassification;
  decision.allowed = newClassification === CLASSIFICATIONS.GREEN_SAFE;
  decision.missingApprovals = Object.freeze(missingApprovals);
}
```

**Rationale:** The approval gate in ADR-003 and ADR-004 was designed as a hard gate — operations requiring owner approval must not proceed without it. The current implementation lists required approvals but does not check whether they are satisfied. This renders the approval gate advisory rather than enforcing. The fix makes approval satisfaction a first-class condition in the gate decision.

---

## Alternatives Considered

### R-001: OpenCode Plugin Export

#### Option A: Named Async Factory Function (CHOSEN)
- **Pros:** Matches official OpenCode plugin contract exactly. Receives project context (project, client, $, directory, worktree) enabling future context-aware initialization. Testable as a standalone function.
- **Cons:** Requires restructuring the existing flat module.
- **Why chosen:** This is the only approach that conforms to the official contract. Any other export shape will not be recognized by OpenCode's plugin loader.

#### Option B: Keep `export const hooks` and document the deviation
- **Pros:** No code changes needed.
- **Cons:** Plugin is not loadable by OpenCode. The `hooks` export is a completely different module shape than what the plugin loader expects. OpenCode's plugin system searches for named function exports, not plain objects.
- **Why rejected:** The plugin would remain non-functional. This is not a stylistic preference — it is a structural incompatibility.

### R-002: Runtime Directory Structure

#### Option A: Preserve Subdirectories (CHOSEN)
- **Pros:** No changes to `evaluate-all.mjs` imports. Matches the source repository structure. Future-proof — if more subdirectories are added, they inherit the same structure.
- **Cons:** Requires changes to `getRuntimeFileList()` and `copyRuntimeFiles()`.
- **Why chosen:** Minimal-change fix. Only the installer changes; the evaluator module and its imports are untouched.

#### Option B: Fix Imports in `evaluate-all.mjs` to Flat Structure
- **Pros:** Single flat directory is simpler.
- **Cons:** Requires changing 5 import paths in `evaluate-all.mjs`. Any future module with relative imports would need similar fixes. The source and target would diverge — source has subdirectories, target is flat. Maintenance risk.
- **Why rejected:** Changes the evaluator module (the canonical source of truth) to accommodate the installer. The installer should accommodate the canonical code, not the reverse.

#### Option C: Bundle Everything Into a Single File
- **Pros:** No import resolution issues. Single file to manage.
- **Cons:** ~1500+ lines in one file. Loss of module boundaries. Harder to audit, test, and reason about. Violates ADR-003's clean module separation.
- **Why rejected:** Anti-modular. The gates, runtimes, and evaluator are intentionally separate modules with clear boundaries.

### R-003: Source-Lock Schema

#### Option A: `files` Array (CHOSEN)
- **Pros:** More expressive (supports path, sha256, size per file). Extensible. Matches common lockfile conventions. OpenCode plugin's reader already uses this format.
- **Cons:** Hermes hook reader must be migrated from `runtime_hashes` dict.
- **Why chosen:** The more expressive format wins. The `runtime_hashes` object is a subset of what `files` can express.

#### Option B: `runtime_hashes` Object
- **Pros:** Hermes hook reader already uses this format.
- **Cons:** Less expressive (filename as key limits metadata per file). OpenCode plugin reader must be migrated. Harder to extend (no per-file `size`, `mtime`, etc.).
- **Why rejected:** Less future-proof. The `files` array is the richer format.

#### Option C: Both — Write Both Formats
- **Pros:** Backward compatible with both readers.
- **Cons:** Data duplication in the lockfile. Source of truth problem — which format is authoritative when they disagree? Increases lockfile size.
- **Why rejected:** Two formats for the same data is a synchronization risk.

### R-004: NOOP Fail-Open

#### Option A: Return RED_BLOCK on Evaluator Unavailable (CHOSEN)
- **Pros:** Fail-closed. Matches ADR-004's explicit design principle. Deleted runtime files → all operations blocked (safe default).
- **Cons:** If the evaluator module has a bug (can't parse), all operations are blocked. This is intentional — a non-functional enforcement system must not silently allow.
- **Why chosen:** Safety. The design imperative is fail-closed.

#### Option B: Keep NOOP but Block Writes (Partial Fail-Safe)
- **Pros:** Reads still work. Only write operations are blocked when evaluator is unavailable.
- **Cons:** "Allow reads, block writes" is inconsistent. The evaluator may be unavailable because it was tampered with — in which case, read operations could be used to exfiltrate data. The correct behavior is to block all operations.
- **Why rejected:** Partial safety is not safety. If the enforcement runtime is compromised, no operation can be trusted.

#### Option C: Status Quo (NOOP = Allow)
- **Pros:** No change.
- **Cons:** Fail-open. Deleted runtime files → silently allows all operations. Directly contradicts ADR-004's FAIL-CLOSED SAFETY section.
- **Why rejected:** This is the bug being fixed. No justification for keeping it.

### R-005: Hermes Hook Delegation

#### Option A: Delegate to Canonical Evaluator (CHOSEN)
- **Pros:** DRY — 19 kernel gates evaluated once. Policy and project gates evaluated for Hermes (currently skipped). Evidence logged (currently not done). Drift prevented.
- **Cons:** Adds subprocess overhead (spawn Node.js from Python). Requires Node.js on the Hermes host.
- **Why chosen:** The architectural intent (ADR-004, Option D "Two-Plane Architecture with Shared Broker") requires all hooks to delegate to a shared evaluator. Duplicate gate logic is explicitly rejected.

#### Option B: Port Kernel Gates to Python (Keep Inline)
- **Pros:** No subprocess overhead. Native Python execution.
- **Cons:** Two implementations of the 19 kernel gates (JavaScript + Python). Drift is inevitable. Testing burden doubles (every gate tested × 2 languages). Policy and project gates must also be ported. Violates DRY principle and the shared broker architecture.
- **Why rejected:** Duplication of the canonical gate logic is architecturally unsound. The 19 kernel gates are the single source of truth for enforcement — implementing them twice creates a synchronization risk.

#### Option C: Status Quo (Inline Regex Only)
- **Pros:** No change. Works without Node.js.
- **Cons:** Only 3 of 19 kernel gates are checked. No policy gates. No project gates. No evidence collection. Drift from OpenCode enforcement. Enforcement claim is dishonest.
- **Why rejected:** This is the broken state being fixed.

### R-006: Evaluator Path

#### Option A: Fix to `evaluate-all.mjs` Path (CHOSEN)
- **Pros:** Points to the canonical entry point. Matches the file that actually exists.
- **Cons:** Requires the R-002 subdirectory fix to be in place first.
- **Why chosen:** The only correct path.

#### Option B: Create `evaluate-gates.mjs` as a Symlink/Wrapper
- **Pros:** No change to `find_evaluator()`.
- **Cons:** Adds an unnecessary file. The canonical entry point is `evaluate-all.mjs` — creating aliases creates confusion about which is authoritative.
- **Why rejected:** Unnecessary indirection. Fix the reader to point to the actual file.

### R-007: Enforcement Level Taxonomy

#### Option A: Two-Stage, 8-Level Taxonomy (CHOSEN)
- **Pros:** Honest distinction between structural installation and active enforcement. Evidence-gated claims at each level. RESTART_REQUIRED acknowledges the reality that runtime restart is needed. FAILED distinguishes failed enforcement from missing tools.
- **Cons:** More levels to understand. Two-stage installation adds complexity.
- **Why chosen:** The original 4-level taxonomy (ADR-004) cannot distinguish "files installed" from "hook actively enforcing." This is a critical gap — claiming HOOK_ENFORCED when the runtime hasn't restarted is dishonest.

#### Option B: Keep ADR-004's 4-Level Taxonomy + Add SUFFIX
- **Pros:** Minimal change. Adds `RESTART_REQUIRED` as metadata, not a new level.
- **Cons:** Doesn't fix the fundamental issue — HOOK_ENFORCED is claimed for structurally valid code, not for actively enforcing code. The suffix approach is a patch that doesn't address the root cause.
- **Why rejected:** The taxonomy needs the intermediate levels to be honest. A suffix on HOOK_ENFORCED is confusing ("HOOK_ENFORCED (RESTART_REQUIRED)" is contradictory).

#### Option C: Status Quo (Hardcoded HOOK_ENFORCED)
- **Pros:** No change.
- **Cons:** No evidence. No validation. Claim is aspirational, not factual. Violates ADR-004's honesty principle.
- **Why rejected:** This is the violation being fixed.

### R-008: Approval Gate Enforcement

#### Option A: Downgrade Classification on Missing Approvals (CHOSEN)
- **Pros:** Approval gates become enforcing, not advisory. The gate decision accurately reflects that required approvals are unsatisfied. `allowed=false` is the correct signal for downstream consumers.
- **Cons:** Requires re-resolving classification, which has edge cases (e.g., if the approval block is the only block but already RED_BLOCK from kernel).
- **Why chosen:** Required approvals that don't block make the approval gate meaningless. The architecture requires approvals to be enforced.

#### Option B: Add `approvalsSatisfied` Boolean (Don't Change allowed)
- **Pros:** Consumers can choose whether to enforce approvals. Backward compatible.
- **Cons:** Pushes enforcement responsibility to hook implementations. Each hook must independently check `approvalsSatisfied`. Inconsistent — some hooks will check, others won't. The gate decision contract should be self-contained.
- **Why rejected:** The gate decision is the canonical output. It should be complete — a consumer checking `allowed` should get the correct answer without needing to also check `approvalsSatisfied`.

#### Option C: Status Quo (Approvals Are Advisory)
- **Pros:** No change.
- **Cons:** Approval gates are documentation, not enforcement. A HIGH_HUMAN_GATE operation with no owner approval will be GREEN_SAFE and allowed.
- **Why rejected:** This is the violation being fixed. Approval gates must enforce, not advise.

---

## Consequences

### Positive

1. **Plugin becomes loadable:** After R-001, the OpenCode plugin exports the correct shape. OpenCode can discover and load the `CanonicalGovernancePlugin` factory function. The plugin's `tool.execute.before` hook can now actually fire.

2. **Runtime imports work:** After R-002, `evaluate-all.mjs` resolves all 5 `../runtimes/` imports correctly in the installed target. The module loads without error.

3. **Source-lock is consistent:** After R-003, all components read `source-lock.json` using the same schema. Tamper detection works across both OpenCode and Hermes.

4. **Fail-closed safety is restored:** After R-004, a deleted runtime directory blocks all operations — not silently allows them. The enforcement plane honors ADR-004's fail-closed design invariant.

5. **Hermes uses the canonical evaluator:** After R-005+R-006, Hermes delegates to the same `evaluate-all.mjs` as OpenCode. All 19 kernel gates, policy gates, and project gates are evaluated. Gate decisions are logged to evidence. Drift is eliminated.

6. **Enforcement claims are honest:** After R-007, no level above STRUCTURAL_HOOK_INSTALLED is claimed without evidence. RESTART_REQUIRED honestly communicates the intermediate state. MANAGED_HOOK_ENFORCED requires attestation tests.

7. **Approval gates enforce:** After R-008, missing required approvals block operations. The gate decision's `allowed` field correctly reflects all gates — including approval gates.

8. **Two-stage installation provides clarity:** Stage A (structural) and Stage B (managed session) separate concerns. The installer claims RESTART_REQUIRED honestly. The runtime upgrades to MANAGED_HOOK_ENFORCED only after attestation.

### Negative

1. **Node.js dependency for Hermes:** After R-005, Hermes enforcement requires Node.js to run the canonical evaluator. For Hermes-only deployments that don't use Node.js, this is a new runtime dependency. Mitigation: Document the Node.js requirement explicitly. Future: Port the evaluator to Python or compile to a standalone binary.

2. **Subprocess overhead per tool call (Hermes):** After R-005, every Hermes tool call spawns a `node` subprocess. This adds ~100-300ms latency per invocation. Mitigation: Implement a long-lived evaluator daemon (pre-spawned process on startup) for Level 5 (BROKER_ENFORCED) to eliminate cold-start cost.

3. **Migration task for existing installations:** After R-002 and R-003, the directory structure and source-lock schema change. Existing `.agent-governance/` installations must be re-installed. Mitigation: The installer's preflight check detects old-format installations and recommends re-installation.

4. **Increased taxonomy complexity:** 8 enforcement levels (vs. ADR-004's 4) require more documentation and training. Mitigation: Only 3 levels (RESTART_REQUIRED, MANAGED_HOOK_ENFORCED, TOOL_GAP) are commonly seen. The full taxonomy is a reference, not a daily concern.

5. **Approval gate re-classification edge cases:** After R-008, re-resolving classification with approval blocks could produce unexpected results in edge cases (e.g., if `resolveClassification` has a bug with mixed results). Mitigation: Add unit tests for all approval-missing combinations with different baseline classifications.

### Neutral

1. **Directory structure mirrors source:** After R-002, `.agent-governance/runtime/` mirrors `scripts/lib/` in the source repository. This is marginally more complex than a flat directory but significantly more maintainable.

2. **The OpenCode plugin context object is received but may not be fully utilized initially:** The R-001 fix adds the `{ project, client, $, directory, worktree }` context parameter. Initial implementation may only use `project`. Future enhancements can leverage `client`, `$`, and `directory`.

3. **Enforcement level in manifest.json is the structural level:** After R-007, `manifest.json`'s `enforcement_level` reflects the structural installation state (RESTART_REQUIRED). The live enforcement level is in `state/session-state.json`. Two sources of truth, but intentionally separated — one is static (committed), one is dynamic (runtime).

### Threat Model Boundaries

The enforcement runtime operates within these explicit threat boundaries:

| Threat | Boundary | Mitigation |
|--------|----------|------------|
| Agent deletes `.agent-governance/runtime/` | Plugin's fail-closed (R-004) — deleting the evaluator blocks all operations | Kernel gate NO_UNRELATED_WORKTREE_WRITE (Gate 5) prevents unauthorized writes to `.agent-governance/`; but if the agent already bypassed the gate, fail-closed stops further damage |
| Agent modifies `source-lock.json` | Tamper detection runs before every tool call (ADR-004, Step 1). Modified lockfile → hash mismatch → RED_BLOCK. Also: `source-lock.json` is committed to git, providing a secondary integrity check | Git's SHA-1 tree hashes + installer's SHA-256 file hashes |
| **Local admin (human) deletes `.agent-governance/`** | **OUTSIDE THREAT MODEL** — no in-process enforcement can prevent a local administrator from deleting files on their own machine. The governance system operates at the agent-process level, not the OS level | Documentation: The README states that deleting `.agent-governance/` removes governance. This is by design — a human admin can always remove governance. The threat model is agent autonomy, not host compromise. |
| Agent registers a different plugin that supplants governance | OpenCode plugin load order: project-local plugins load last (can override). A malicious project-local plugin named `CanonicalGovernancePlugin` could intercept the name. | Mitigation: source-lock.json includes the plugin file hash. The canonical plugin verifies its own hash at startup. A replacement plugin would have a different hash. |
| Hermes `/yolo` mode bypasses `pre_tool_call` | Hermes `/yolo` explicitly disables all hooks. This is a Hermes design decision, not a governance failure | Documented as a known bypass: "Hermes `/yolo` disables governance hooks. Use `/yolo` only when you intend to bypass all enforcement." The enforcement level for `/yolo` sessions is documented as `FAILED (yolo bypass)`. |

---

## Changed Files

| File | Change | Reason |
|------|--------|--------|
| `.opencode/plugins/canonical-governance.mjs` | Replace `export const hooks` with `export const CanonicalGovernancePlugin = async ({ project, client, $, directory, worktree }) => { return { ... } }` | R-001: Match official OpenCode plugin contract |
| `.opencode/plugins/canonical-governance.mjs` | Change `evaluateByGate()` to return `RED_BLOCK` instead of `NOOP` when evaluator unavailable | R-004: Fail-closed safety |
| `.opencode/plugins/canonical-governance.mjs` | Remove `case 'NOOP':` from allow switch in `handleToolExecution()` | R-004: Fail-closed safety |
| `.opencode/plugins/canonical-governance.mjs` | Update `EVALUATE_PATH` to `runtime/gates/evaluate-all.mjs` | R-002: New subdirectory structure |
| `scripts/install-governance.mjs` `getRuntimeFileList()` | Change `dest` paths from flat to `gates/` and `runtimes/` subdirectories | R-002: Preserve import paths |
| `scripts/install-governance.mjs` `copyRuntimeFiles()` | Create `gates/` and `runtimes/` subdirectories before copying | R-002: Create target directories |
| `scripts/install-governance.mjs` `generateSourceLock()` | Change `runtime_hashes` object to `files` array with `path`, `sha256`, `size` | R-003: Unified schema |
| `scripts/install-governance.mjs` `validatePostApply()` | Update expected file paths for new subdirectory structure | R-002: Validation consistency |
| `scripts/install-governance.mjs` `determineEnforcementLevel()` | Return `RESTART_REQUIRED` instead of `HOOK_ENFORCED`; never claim above STRUCTURAL_HOOK_INSTALLED from installer | R-007: Honest claims |
| `integrations/hermes/gate_hook.py` `pre_tool_call_handler()` | Remove inline regex checks; delegate to `runtime_client.evaluate()` | R-005: Canonical evaluator delegation |
| `integrations/hermes/gate_hook.py` `pre_tool_call_handler()` | Migrate tamper detection from `runtime_hashes` dict to `files` array iteration | R-003: Unified schema |
| `integrations/hermes/gate_hook.py` `governance_status()` | Read enforcement level from manifest + session state; report both structural and live levels | R-007: Honest claims |
| `integrations/hermes/runtime_client.py` `find_evaluator()` | Fix path from `evaluate-gates.mjs` to `runtime/gates/evaluate-all.mjs` | R-006: Correct file path |
| `scripts/lib/gates/decision.mjs` `createGateDecision()` | Add approval satisfaction check; downgrade classification and set `allowed=false` when required approvals are missing | R-008: Approval enforcement |
| `docs/architecture/adr-005-runtime-enforcement-contract-fix.md` | This document | ADR documentation |

## New Tests Required

### Unit Tests
- **T-001:** `CanonicalGovernancePlugin({ project, client, $, directory, worktree })` returns object with `tool.execute.before` hook (R-001)
- **T-002:** `CanonicalGovernancePlugin` import is recognized as a named async function export (R-001)
- **T-003:** `evaluate-all.mjs` resolves all `../runtimes/` imports in installed directory structure (R-002)
- **T-004:** `getRuntimeFileList()` produces correct `gates/` and `runtimes/` prefixed destinations (R-002)
- **T-005:** `generateSourceLock()` produces `files` array, not `runtime_hashes` object (R-003)
- **T-006:** `validateRuntimeIntegrity()` correctly reads and validates `files` array format (R-003)
- **T-007:** `evaluateByGate()` returns `RED_BLOCK` (not `NOOP`) when evaluator module is unloadable (R-004)
- **T-008:** `handleToolExecution()` throws on `RED_BLOCK` decision (R-004)
- **T-009:** `pre_tool_call_handler()` calls `runtime_client.evaluate()` for write/external tools (R-005)
- **T-010:** `find_evaluator()` returns correct `evaluate-all.mjs` path (R-006)
- **T-011:** `determineEnforcementLevel()` returns `RESTART_REQUIRED` for installed OpenCode/Hermes (R-007)
- **T-012:** `createGateDecision()` sets `allowed=false` when HIGH_HUMAN_GATE risk tier has no consumed owner_approval (R-008)

### Integration Tests
- **T-013:** Full install → verify `.agent-governance/runtime/gates/evaluate-all.mjs` imports successfully (R-002 + R-006)
- **T-014:** Install → delete `runtime/gates/evaluate-all.mjs` → verify next tool call is blocked (R-004)
- **T-015:** Install with OpenCode → restart → verify `CanonicalGovernancePlugin` is loaded by OpenCode plugin system (R-001 + R-007)
- **T-016:** Install → modify `evaluate-all.mjs` → verify tamper detection triggers RED_BLOCK (R-003 + R-004)

## Breaking Changes

**None.** The current implementation is already broken — none of the contract violations represent working functionality that would be broken by the fix. Specifically:

- R-001: The plugin cannot be loaded by OpenCode. No current users are affected.
- R-002: The installed runtime cannot import. No current users are affected.
- R-003: The source-lock schema is inconsistent. Tamper detection doesn't work for OpenCode.
- R-004: The fail-open path silently allows operations. This is a security vulnerability, not a feature.
- R-005: Hermes hook doesn't call the evaluator. No kernel gates are enforced for Hermes.
- R-006: The client searches for a non-existent file. The evaluator cannot be found.
- R-007: Hardcoded claims are false. Fixing them is correction, not regression.
- R-008: Approval gates are advisory. Making them enforcing is the intended behavior per ADR-004.

No migration path is needed from a working state because the working state does not exist.

## References

- [ADR-003: Runtime-Neutral Hard Gate Kernel](adr-004-url-installer-runtime-enforcement.md) (the ADR-003 reference is within ADR-004 — see ADR-004 lines 17, 54–68)
- [ADR-004: URL Installer Runtime Enforcement](adr-004-url-installer-runtime-enforcement.md) — The architectural foundation this ADR fixes
- [OpenCode Plugin Documentation](https://opencode.ai/docs/plugins/) — Official plugin contract (verified 2026-07-16)
- [Evidence Gates Policy](../../.opencode/policies/evidence-gates.json) — Gate definitions for claim types
- [MCP Trust Tiers Policy](../../.opencode/policies/mcp-trust-tiers.json) — Tool capability classification
- [Write Protection Policy](../../.opencode/policies/write-protection.json) — Operations requiring human gate
- [ADR Template](../../.opencode/templates/adr-template.md) — Standard ADR format
- PR #7: `agent/url-installer-runtime-enforcement` branch
