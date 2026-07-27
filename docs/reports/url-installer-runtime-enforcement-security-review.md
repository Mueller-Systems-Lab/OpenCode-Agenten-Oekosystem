# URL Installer Runtime Enforcement — Security Review (F1–F7 Deep Dive)

**Date:** 2026-07-16
**Commit SHA:** `0a3761963d859c9af8c11dd0cd9dc3ff5dcfe797`
**Branch:** `agent/url-installer-runtime-enforcement`
**Review Type:** Read-only structural security review — no PoC execution
**Overall Verdict:** **7 FINDINGS CONFIRMED (1 MEDIUM, 4 LOW, 2 INFORMATIONAL)**

> **HISTORICAL SECURITY REVIEW:** This review covers an earlier plural
> `.opencode/plugins/` installation path and is superseded for the Issue #16
> runtime contract. The current verified bridge is
> `.opencode/plugin/governance-v2.ts`.

---

## Threat Model Boundary Statement

**What the governance plugin CAN protect against:**
- An AI agent that is running with the governance plugin loaded attempting unauthorized write, external, or destructive operations — blocked by kernel gates, policy gates, and approval receipts.
- Cross-scope/cross-action receipt replay — blocked by nonce ledger, scope fingerprint, and action-matching kernel gates.
- Path traversal within the agent's tool execution — blocked by `NO_PATH_ESCAPE` and `NO_SYMLINK_ESCAPE` kernel gates.

**What the governance plugin CANNOT protect against:**
- A **local user with filesystem access** who can delete, rename, or move the plugin file (`.opencode/plugins/canonical-governance.mjs`). If OpenCode cannot find the plugin, it silently proceeds without enforcement.
- A **local user** who starts OpenCode with `--no-plugins` or does not load this plugin in their `opencode.jsonc` configuration.
- A **local admin** who can modify the OpenCode binary/launcher to skip plugin loading.
- A **concurrent attacker** with sub-millisecond timing precision between `readFileSync` and `import()` — accepted TOCTOU risk.

These are **fundamental constraints of a project-local enforcement model**, not implementation bugs. The governance system is a defense-in-depth layer within a broader security architecture that includes filesystem permissions, container isolation, MCP trust tiers, and human approval gates.

---

## Finding Summary

| # | Severity | Finding | File | Status |
|---|----------|---------|------|--------|
| **F1** | **MEDIUM** (4.4) | Plugin Deactivatable — No session attestation, no managed launcher | `.opencode/plugins/canonical-governance.mjs` | DESIGN_LIMITATION |
| **F2** | **LOW** (3.1) | Installer Apply proceeds without gate evaluation | `scripts/install-governance.mjs` | CHANGES_REQUIRED |
| **F3** | **LOW** (3.8) | TOCTOU between `validateRuntimeIntegrity()` and `loadEvaluateModule()` | `.opencode/plugins/canonical-governance.mjs` | CHANGES_REQUIRED |
| **F4** | **LOW** (3.1) | Delegate (`task`/`skill`) fail-open on gate evaluation crash | `.opencode/plugins/canonical-governance.mjs` | CHANGES_REQUIRED |
| **F5** | **LOW** (3.8) | Hermes write-path uses `.startswith()` for containment; `/tmp/` unconditional | `integrations/hermes/gate_hook.py` | CHANGES_REQUIRED |
| **F6** | **LOW** (3.1) | Nonce ledger cross-process race between memory check and ledger write | `scripts/lib/gates/approval.mjs` | CHANGES_REQUIRED |
| **F7** | **INFO** | Symlink check: `realpathSync` TOCTOU; `lstat` per-segment in `assertSafePath` only | `scripts/lib/gates/kernel.mjs` L161-195, `scripts/lib/paths.mjs` L62-93 | DESIGN_CONSISTENCY |

---

## F1: Plugin Deactivatable — No Session Attestation

### File
`.opencode/plugins/canonical-governance.mjs` — full file reviewed (289 lines)

### Current State

The governance hook is implemented as an OpenCode plugin exporting `hooks['tool.execute.before']` (lines 285-288). The hook is the **sole entry point** for runtime enforcement within OpenCode — there is no secondary enforcement mechanism, no daemon, no systemd unit, and no launcher-managed process.

**Deactivation vectors:**
1. **File deletion/move:** A local user can `rm .opencode/plugins/canonical-governance.mjs`. OpenCode silently proceeds without the hook.
2. **Plugin config removal:** The plugin is not referenced in `opencode.jsonc`'s plugin section. It loads via filesystem presence at `.opencode/plugins/`. Removing the file removes enforcement.
3. **`--no-plugins` flag:** OpenCode accepts a `--no-plugins` startup flag (OpenCode 1.15.x behavior) that skips all plugins.
4. **Plugin load failure:** If `import()` of the plugin fails, OpenCode may silently continue (implementation-dependent).

**The `governanceIsInstalled()` check (lines 22-26):** This function checks for `.agent-governance/manifest.json` — NOT for the plugin's own loaded state. If governance was installed (manifest.json exists) but the plugin was deleted, the check never even runs because the plugin isn't loaded. There is no cross-channel verification.

**Evidence of false self-detection claim:** The plugin's `MAP_TOOL_TO_DESCRIPTOR()` function (line 114) produces descriptors like `{ runtime: 'opencode', tool, action, ... }`. But nowhere does the plugin code emit a "governance is active" attestation token or session nonce that could be independently verified. The `writeEvidence()` function (line 164) writes evidence files to `.agent-governance/evidence/` but this only proves the hook ran — and obviously, if the hook didn't run, nothing is written.

### CVSS 3.1 Assessment

`CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L/E:P/RL:T/RC:C`

| Metric | Value | Justification |
|--------|-------|--------------|
| AV | Local (L) | Requires local filesystem access to delete the plugin |
| AC | Low (L) | Simple file deletion — no race, no exploit, no timing |
| PR | Low (L) | Any user with write access to `.opencode/plugins/` |
| UI | None (N) | No user interaction needed after deletion |
| S | Unchanged (U) | Scope is local project; no escalation beyond the process |
| C | None (N) | Read operations unaffected |
| I | Low (L) | Unauthorized writes possible without gate evaluation |
| A | Low (L) | Destructive operations possible (though bash-level patterns still caught by kernel if they evaluate) |
| E | Proof-of-Concept (P) | Trivially demonstrable |
| RL | Official Fix (T) | Not fully addressable within OpenCode plugin architecture |
| RC | Confirmed (C) | Code review confirms the vulnerability |

**Adjusted severity: MEDIUM (4.4)** — Local access required, minimal integrity/availability impact.

### What CAN Be Fixed

1. **Session nonce attestation (feasible):** Emit a session nonce to `.agent-governance/state/session-{uuid}.json` on plugin activation. Any tool execution writes an entry referencing this nonce. An external monitor script (cron/scheduled) can detect missing nonce updates and raise alerts.

2. **Hermes as primary enforcement (architectural):** Document that Hermes `pre_tool_call` with its Python-side gate hook is the primary enforcement path — the OpenCode plugin is a convenience layer, not the security boundary.

3. **Config-level guard (feasible):** Add a `required_plugins` field to `opencode.jsonc` that OpenCode validates at startup. If the plugin is required and missing, OpenCode refuses to start. (This requires OpenCode upstream support.)

### What CANNOT Be Fixed

- A **local user with root** can always disable any project-local enforcement. This is a fundamental constraint of operating within a user's own filesystem.
- A **user who compiled OpenCode from source** with plugin loading disabled cannot be prevented.
- The **OpenCode plugin architecture itself** — as of v1.15.13 — has no plugin integrity verification or attestation framework. This is an upstream OpenCode limitation.

### Recommendation

1. Document in `SECURITY.md` that the OpenCode plugin is an **advisory enforcement layer** — security-critical enforcement must use Hermes `pre_tool_call` or the CLI evaluator.
2. Implement session nonce attestation as described above.
3. Do NOT claim the plugin cannot be deactivated — the claim should be "the plugin enforces governance when loaded; detection of non-loaded state requires external monitoring."

---

## F2: Governance Installer Proceeds Without Gate Evaluation During Apply

### File
`scripts/install-governance.mjs` — specifically `runApplyPhase()` (lines 700-870) and `runDryRunPhase()` (lines 891-1062)

### Current State

The installer has two distinct code paths:

**Dry-Run (lines 891-1062):**
- Detects runtimes (line 954)
- Assesses risk tier (line 955)
- Determines enforcement level (line 956)
- Builds file plan and finds conflicts (lines 959-961)
- Classifies using `classify()` function (line 961) which returns RED_BLOCK, AMBER_REVIEW, or GREEN_SAFE
- Outputs classification and exits with appropriate exit code

**Apply Phase (lines 700-870):**
1. **Phase 0 (lines 701-721):** Re-runs source validation (source files exist) and target checks (exists, writable). These are hard BLOCK checks.
2. **Phase 1 (lines 724-730):** Validates approval receipt if `--approval-file` is provided.
3. **Phases 2–12 (lines 733-815):** Locks source commit, checks existing installation, detects runtimes, creates backup, copies runtime files, copies policies, generates source-lock.json, generates manifest.json, copies bin/evaluate.mjs, installs OpenCode hook, installs Hermes plugin.
4. **Phase 13 (lines 818):** Post-apply validation — checks file existence, directory counts, source-lock validity.
5. **Phase 14 (lines 821-866):** Generates install report, logs classification.

**The critical gap:** There is **NO call to `evaluateAllGates()`** anywhere in `runApplyPhase()`. The installer copies runtime files, generates manifests, and installs hooks regardless of the enforcement level. The only blocker is:
- Missing source files → RED_BLOCK → exit
- Non-existent target → RED_BLOCK → exit
- Non-writable target → RED_BLOCK → exit
- Invalid approval receipt → RED_BLOCK → exit

If the target directory has no detectable runtimes (confidence < 50), the enforcement level is set to `'ADVISORY_ONLY'` (line 227), but installation still proceeds. The post-apply validation (line 818) only checks file existence — it does not gate on the enforcement level.

**Contrast with the old bootstrap review:** The existing report's F2 referred to `scripts/bootstrap-project.mjs` bypassing AMBER_REVIEW. This is a different file. The `install-governance.mjs` simply never calls the gate evaluator during apply.

### CVSS 3.1 Assessment

`CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:N/I:L/A:N`

| Metric | Value | Justification |
|--------|-------|--------------|
| AV | Local (L) | Only applies to local project installation |
| AC | High (H) | Requires intentional install into non-OpenCode/Hermes project |
| PR | Low (L) | Any user who can run `node scripts/install-governance.mjs --apply` |
| UI | None (N) | No interaction required |
| S | Unchanged (U) | Scope is local project only |
| C | None (N) | No confidentiality impact |
| I | Low (L) | Enforcement files are copied but not enforced — false enforcement claim |
| A | None (N) | No availability impact |

**Adjusted severity: LOW (3.1)** — This is a false enforcement claim, not a security bypass. If there's no runtime to enforce against, the governance files are inert.

### Recommendation

Add a gate evaluation step between Phase 1 and Phase 2:

```javascript
// Phase 1b: Evaluate gates before continuing with install
const gateResult = await evaluateAllGates({
  targetRoot,
  runtime: 'auto',
  action: 'install',
  riskTier: 'MEDIUM_REVIEW',
  dryRun: false,
  hasBackup: false  // backup hasn't been created yet at this point
});

if (gateResult.classification === CLASSIFICATIONS.RED_BLOCK) {
  console.error('RED_BLOCK: Gate evaluation blocked installation.');
  process.exit(2);
}

if (gateResult.classification === CLASSIFICATIONS.AMBER_REVIEW) {
  console.warn('AMBER_REVIEW: Proceeding with installation but enforcement level may be degraded.');
}
```

Alternatively, add a `--force` flag to explicitly skip the gate check for environments where the user acknowledges degraded enforcement.

### What CANNOT Be Fixed

- The `NO_APPLY_WITHOUT_BACKUP` kernel gate (line 351-362) fires when `action === 'apply' && !hasBackup`. Since the backup hasn't been created yet at the proposed check point, we'd need to either: (a) create the backup first, evaluate, then continue; or (b) use a different action name.

---

## F3: TOCTOU Between Hash Verification and Module Import

### File
`.opencode/plugins/canonical-governance.mjs` — `validateRuntimeIntegrity()` (lines 43-66) and `loadEvaluateModule()` (lines 68-78)

### Current State

The execution flow in `handleToolExecution()` (lines 174-283):

```
Line 190: const integrity = validateRuntimeIntegrity()
          ↓  reads files with readFileSync, hashes, compares against source-lock.json
          ↓  
Line 191: if (!integrity.valid) → throw (block)
          ↓  integrity passes
Line 209: gateResult = await evaluateByGate(descriptor)
          ↓  → loadEvaluateModule() at line 68
Line 72:  evaluateModule = await import(EVALUATE_PATH)
          ↑  This reads the file AGAIN from disk and executes it
```

The `validateRuntimeIntegrity()` function (line 43):
- Reads each file in the lock's `files` array using `readFileSync()` (line 56)
- Hashes with SHA-256 (line 57)
- Compares against stored hash (line 58)
- Returns `{ valid: true }` if all match

The `loadEvaluateModule()` function (line 68):
- Uses `import(EVALUATE_PATH)` (line 72) — a dynamic import that does a fresh file read
- Node.js caches modules by fully-resolved path once loaded, but the **first** `import()` reads from disk
- If this is a cold cache, Node.js reads `evaluate-all.mjs` from disk and executes its top-level code immediately

**The TOCTOU window:**
1. **T0:** `readFileSync('runtime/evaluate-all.mjs')` → content = CORRECT, hash matches lock
2. **T1:** Attacker replaces `runtime/evaluate-all.mjs` with malicious version on disk
3. **T2:** `import('../runtime/evaluate-all.mjs')` → Node.js reads the compromised file and executes it

Between T0 and T2 there is exactly one synchronous code block: lines 191-208 (integrity check, evidence writing, error throwing). In practice this window is **sub-millisecond**. However, the file could also be replaced **between tool invocations** — the `validateRuntimeIntegrity()` call happens on every tool execution, but the `import()` result is cached in `evaluateModule` (line 69), so the TOCTOU is only relevant on the **first** invocation when the module cache is cold.

**Node.js module caching behavior:**
- `import()` results are cached per fully-resolved URL
- Once cached, subsequent calls return the cached module — no disk access
- So the window only exists once per Node.js process lifetime

**Additional concern — key file not in lock scope:** The `validateRuntimeIntegrity` function checks files listed in `source-lock.json`'s `files` array. But `loadEvaluateModule` imports `EVALUATE_PATH` which is `./runtime/evaluate-all.mjs`. If `evaluate-all.mjs` is in the lock, its hash is verified. But `evaluate-all.mjs` itself imports from `./kernel.mjs`, `./decision.mjs`, `./evidence.mjs`, `./approval.mjs`, etc. None of these transitive imports are individually verified against the lock — only the files listed in the lock are checked. The source-lock.json is generated by `install-governance.mjs` (line 399-426) from `getRuntimeFileList()` which lists all 14 runtime files (line 134-151). So ALL runtime files ARE in the lock. Good — this means all transitive imports are individually verified.

### CVSS 3.1 Assessment

`CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:L/I:L/A:L`

| Metric | Value | Justification |
|--------|-------|--------------|
| AV | Local (L) | Requires local filesystem write during runtime |
| AC | High (H) | Sub-millisecond window; only relevant on cold module cache |
| PR | Low (L) | User with write access to `.agent-governance/runtime/` |
| UI | None (N) | No user interaction after file replacement |
| S | Unchanged (U) | Scope is contained |
| C | Low (L) | Read access to controlled code execution within Node.js process |
| I | Low (L) | Integrity of gate evaluation decisions compromised |
| A | Low (L) | Could crash the gate evaluation module |

**Adjusted severity: LOW (3.8)** — Extremely narrow window, requires local filesystem write access during active runtime.

### Recommendation

Combine hash verification and module loading into a single atomic read:

```javascript
async function validateAndLoadRuntime() {
  const lock = loadSourceLock();
  if (!lock) return null;

  // Read ALL runtime files atomically
  const fileContents = {};
  for (const entry of lock.files) {
    const filePath = join(GOVERNANCE_ROOT, entry.path);
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf-8');
    const actualHash = sha256(content);
    if (actualHash !== entry.hash) return null;
    fileContents[entry.path] = content;
  }

  // Use vm.Module or eval with pre-verified buffer
  // For simplicity: trust that all files passed hash check
  return await import(EVALUATE_PATH);  // cold cache, but files were just verified
}
```

Note: This only narrows the window, it does not eliminate it. A truly atomic approach would use `vm.Module` with the already-read buffer, but this changes the module loading semantics significantly.

### What CANNOT Be Fixed

- **Complete TOCTOU elimination** requires OS-level file locking (e.g., `flock` on the runtime directory) or in-kernel integrity enforcement (IMA/EVM on Linux). These are outside the scope of a project-local Node.js module.

---

## F4: Delegate Tools Fail-Open on Gate Evaluation Crash

### File
`.opencode/plugins/canonical-governance.mjs` — error handler at lines 208-228

### Current State

The tool risk classification (lines 80-87):
```javascript
const WRITE_TOOLS = new Set(['bash', 'write', 'edit', 'apply_patch', 'todowrite']);
const EXTERNAL_TOOLS = new Set(['webfetch', 'websearch']);
const DELEGATE_TOOLS = new Set(['task', 'skill']);   // ← classified as DELEGATE
const READ_TOOLS = new Set(['read', 'grep', 'glob', 'lsp']);
const SAFE_TOOLS = new Set(['question', 'todowrite']);
```

The gate evaluation crash handler (lines 208-228):
```javascript
try {
    gateResult = await evaluateByGate(descriptor);
} catch (err) {
    // ... write RED_BLOCK evidence entry
    if (risk === 'WRITE' || risk === 'EXTERNAL') {
        throw new Error(  // ← FAIL-CLOSED for write/external
            `[canonical-governance] BLOCKED: gate evaluation crashed for tool "${tool}" (${risk}). ` +
            `Fail-closed enforcement triggered. Details: ${err.message}`
        );
    }
    return undefined;  // ← FAIL-OPEN for READ, DELEGATE, NON_BLOCKING
}
```

**The DELEGATE risk is not in the fail-closed path.** When gate evaluation crashes:
- `bash`, `write`, `edit`, `apply_patch` → BLOCKED ✓
- `webfetch`, `websearch` → BLOCKED ✓
- `task`, `skill` → ALLOWED ✗ (delegation proceeds without gate evaluation)
- `read`, `grep`, `glob`, `lsp` → ALLOWED (acceptable — read-only)
- `question`, `todowrite` → ALLOWED (acceptable — safe tools)

**Why this matters:** The `task` tool spawns a sub-agent (like `build`, `review-agent`, etc.) with its own context and tools. If the parent session's gate evaluation crashed, a delegated sub-agent could perform write operations without the parent's governance being aware. The sub-agent would need its own governance instance — but if the delegation itself is allowed without gates, the sub-agent receives an un-gated context.

### CVSS 3.1 Assessment

`CVSS:3.1/AV:L/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:N`

| Metric | Value | Justification |
|--------|-------|--------------|
| AV | Local (L) | Requires gate evaluation to crash (unlikely scenario) |
| AC | High (H) | Requires a crash in the gate evaluator — edge case |
| PR | None (N) | Triggered by any tool invocation when gate evaluator is broken |
| UI | None (N) | No interaction needed |
| S | Unchanged (U) | Scope is contained |
| C | None (N) | No confidentiality impact |
| I | Low (L) | Delegation could lead to writes in sub-agent |
| A | None (N) | No direct availability impact |

**Adjusted severity: LOW (3.1)** — Requires a gate evaluation crash, which is itself a degraded state.

### Recommendation

Add `DELEGATE` to the fail-closed set:

```javascript
if (risk === 'WRITE' || risk === 'EXTERNAL' || risk === 'DELEGATE') {
    throw new Error(...);
}
```

Alternatively, for a more nuanced approach: for DELEGATE tools, refuse to spawn the sub-agent but return a "governance degraded, delegation blocked" response rather than throwing — this lets the calling agent know why delegation was refused.

---

## F5: Hermes Write-Path Containment Using `.startswith()`

### File
`integrations/hermes/gate_hook.py` — `pre_tool_call_handler()` lines 110-118

### Current State

The Hermes `pre_tool_call` hook implements its own write-path containment check:

```python
# Lines 110-118:
for wp in descriptor.get("writePaths", []):
    wp_abs = str(Path(wp).resolve())
    gov_root_str = str(gov_root.resolve())
    if not wp_abs.startswith(gov_root_str) and not wp_abs.startswith("/tmp/"):
        return {
            "action": "block",
            "message": f"KERNEL GATE: NO_PATH_ESCAPE — Write path {wp} is outside governance root.",
        }
```

**Issue 1: `.startswith()` is not path containment**

`str.startswith()` is a string prefix check, not a filesystem containment check. Consider:
- `gov_root_str` = `/workspace/projects`
- `wp_abs` = `/workspace/projects-other/secret.txt`
- `"/workspace/projects-other/secret.txt".startswith("/workspace/projects")` → **True** (bypass!)
- Correct check: `os.path.commonpath([gov_root_str, wp_abs]) == gov_root_str`

**Issue 2: Governance root ≠ project root**

`_find_governance_root()` (lines 16-23) walks UP from CWD to find `.agent-governance/manifest.json`. If governance is installed at a parent directory (e.g., `~/projects/`), writes to sibling projects pass the check:
- `gov_root_str` = `/workspace/projects`
- `wp_abs` = `/workspace/projects-other/secret.txt`
- `"/workspace/projects-other/secret.txt".startswith("/workspace/projects")` → **True** (bypass!)
...
- `gov_root_str` = `/workspace/projects`
- `wp_abs` = `/workspace/projects/app-a/src/main.py` ✓ (passes, correct)
- `wp_abs` = `/workspace/projects/app-b/secrets.env` ✓ (passes, WRONG — this is a different project)

The check should use the **project root** (the directory where `.agent-governance/` is located, typically CWD), not the parent that triggered the governance root walk.

**Issue 3: Unconditional `/tmp/` write allowance**

Any write to `/tmp/` passes without any further checks. While `/tmp/` is a conventional scratch space, this means:
- A malicious Hermes tool invocation could write a script to `/tmp/payload.sh`
- A subsequent ungated bash invocation could execute it
- No sandboxing, no cgroup isolation, no namespace separation

Compare this with the Node.js kernel gate `NO_PATH_ESCAPE` in `kernel.mjs` (lines 120-158), which uses `relative()` + `..` check — the correct approach.

**Note:** The Hermes hook does NOT delegate to the kernel gate for path checks. It implements its own, weaker check. This violates the design invariant that kernel gates are the floor.

### CVSS 3.1 Assessment

`CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L`

| Metric | Value | Justification |
|--------|-------|--------------|
| AV | Local (L) | Requires local Hermes session |
| AC | Low (L) | Simple path bypass via naming collision |
| PR | Low (L) | Any Hermes user |
| UI | None (N) | No interaction needed |
| S | Unchanged (U) | Scope is local filesystem |
| C | None (N) | No data exfiltration |
| I | Low (L) | Writes to sibling directories possible |
| A | Low (L) | File corruption in sibling projects |

**Adjusted severity: LOW (3.8)** — Real bypass via `.startswith()`, but only affects Hermes runtime (not OpenCode).

### Recommendation

1. **Replace `.startswith()` with proper path containment:**
```python
import os

def is_path_contained(child_path, parent_path):
    """True if child_path is within parent_path (proper filesystem containment)."""
    child = os.path.normpath(os.path.realpath(child_path))
    parent = os.path.normpath(os.path.realpath(parent_path))
    # Ensure child doesn't escape via .. after normalization
    rel = os.path.relpath(child, parent)
    return not rel.startswith("..") and not os.path.isabs(rel)
```

2. **Use project root (CWD), not governance root:**
```python
project_root = os.getcwd()
# ... use project_root instead of gov_root_str
```

3. **Restrict `/tmp/` exception:**
```python
# Only allow writes to a project-specific temp directory
tmp_boundary = os.path.join("/tmp", f"hermes-{project_hash}")
if wp_abs.startswith(tmp_boundary):
    pass  # allowed
```

4. **Delegate to the Node.js kernel gate CLI:** Instead of re-implementing path checks, call `node scripts/evaluate-gates.mjs --write-path <path>` which runs the correct kernel gate logic.

---

## F6: Nonce Ledger Cross-Process Race Condition

### File
`scripts/lib/gates/approval.mjs` — `consumeReceipt()` (lines 185-297), `markNonceConsumed()` (line 371), `isNonceConsumed()` (line 375), `writeReceiptToLedger()` (line 387)

### Current State

The nonce consumption has a dual-layer design:

**Layer 1 — In-Memory Set** (process-local):
```javascript
// Line 369:
const consumedNonces = new Set();

// Lines 371-373:
export function markNonceConsumed(nonce) {
  consumedNonces.add(nonce);
}

// Lines 375-377:
export function isNonceConsumed(nonce) {
  return consumedNonces.has(nonce);
}
```

**Layer 2 — Filesystem Ledger** (cross-process, best-effort):
```javascript
// Lines 387-393:
export function writeReceiptToLedger(receipt, baseDir = process.cwd()) {
  const ledgerDir = getLedgerPath(baseDir);
  mkdirSync(ledgerDir, { recursive: true });
  const filePath = resolve(ledgerDir, `${receipt.nonce}.json`);
  writeFileSync(filePath, JSON.stringify(receipt, null, 2), 'utf-8');
  return filePath;
}
```

**The consumption race in `consumeReceipt()` (lines 185-297):**

```
Process A                              Process B
───────────                            ───────────
1. isNonceConsumed(nonce) → false      1. isNonceConsumed(nonce) → false
2. readReceiptFromLedger(nonce) → null 2. readReceiptFromLedger(nonce) → null
3. Check status APPROVED ✓            3. Check status APPROVED ✓
4. Check expiry valid ✓               4. Check expiry valid ✓
5. Check action match ✓               5. Check action match ✓
6. Check scope match ✓                6. Check scope match ✓
7. markNonceConsumed(nonce)           7. markNonceConsumed(nonce)
8. writeReceiptToLedger(consumed)      8. writeReceiptToLedger(consumed)
   ↑ Both processes succeed!             ↑ Both processes succeed!
```

Both processes pass because:
- Each has its own **independent** in-memory `Set`
- The filesystem `readReceiptFromLedger` at step 2 reads the ORIGINAL receipt from the approval file, not the ledger
- The ledger file is written at step 8 — after all checks pass

Neither process sees the other's consumption because:
- The in-memory Sets are process-local (no IPC)
- The ledger file from Process A doesn't exist when Process B checks at step 2

**The ledger read at line 191:**
```javascript
const ledgerEntry = readReceiptFromLedger(receipt.nonce, currentContext.baseDir);
```
This reads from `.opencode/approvals/{nonce}.json`. But the receipt being consumed is loaded from the approval file (`--approval-file` or `approvals` directory), not from the ledger. The ledger check only catches the case where a receipt was previously consumed in ANOTHER run of the same process.

### CVSS 3.1 Assessment

`CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:N/I:L/A:N`

| Metric | Value | Justification |
|--------|-------|--------------|
| AV | Local (L) | Both processes must run on the same machine |
| AC | High (H) | Requires concurrent consumption — two agents acting simultaneously with the same valid receipt |
| PR | Low (L) | Any user running multiple agent processes |
| UI | None (N) | No interaction needed |
| S | Unchanged (U) | Scope is local project |
| C | None (N) | No data exfiltration |
| I | Low (L) | Could allow double-consumption of approval |
| A | None (N) | No availability impact |

**Adjusted severity: LOW (3.1)** — Requires concurrent consumption and valid reusable receipts (which are already limited by scope and fingerprint).

### Recommendation

Use **atomic exclusive-create** for the ledger file:

```javascript
import { openSync, writeFileSync, constants } from 'node:fs';

export function writeReceiptToLedger(receipt, baseDir = process.cwd()) {
  const ledgerDir = getLedgerPath(baseDir);
  mkdirSync(ledgerDir, { recursive: true });
  const filePath = resolve(ledgerDir, `${receipt.nonce}.json`);

  try {
    // O_EXCL | O_CREAT: fails if file already exists → atomic cross-process check
    const fd = openSync(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    writeFileSync(fd, JSON.stringify(receipt, null, 2), 'utf-8');
    closeSync(fd);
    return filePath;
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new ApprovalReuseViolation({
        evidence: { nonce: receipt.nonce, action: receipt.action, consumedAt: 'cross-process detection' }
      });
    }
    throw err;
  }
}
```

This makes the filesystem the atomic arbiter: the first process to create `{nonce}.json` succeeds, the second gets `EEXIST` and fails.

**Alternative:** Use an advisory lock file pattern:
```javascript
import { flockSync } from 'node:fs';  // or a lockfile library
```

### What CANNOT Be Fixed

- **Distributed environments:** If agent processes run on different machines with different filesystems, neither in-memory nor filesystem locking helps. This would require a central database or distributed consensus. This is outside the project's current scope.

---

## F7: Symlink Check — `realpathSync` TOCTOU and Missing Per-Segment `lstat`

### Files
- `scripts/lib/gates/kernel.mjs` — `NO_SYMLINK_ESCAPE` gate (lines 160-195)
- `scripts/lib/paths.mjs` — `assertSafePath()` (lines 62-93)

### Current State

**Kernel gate `NO_SYMLINK_ESCAPE` (kernel.mjs lines 161-195):**

```javascript
const realPath = realpathSync(normalized);  // L174: resolves ALL symlinks
const resolved = resolve(normalized);
if (realPath !== resolved) {               // L176: is it a symlink?
    const rel = relative(worktreeRoot, realPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
        // ESCAPE DETECTED → block
    }
}
```

This approach:
- ✅ Correctly detects escapes to outside the worktree
- ✅ Resolves full symlink chains to final target
- ❌ Has a TOCTOU window between `existsSync(normalized)` (L172) and `realpathSync(normalized)` (L174) — a new symlink can be created in this gap
- ❌ Does NOT catch intermediate symlinks that stay within the worktree but redirect through unexpected paths

**`assertSafePath()` in paths.mjs (lines 62-93):**

```javascript
let current = rootPath;
for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await lstatIfExists(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
        throw new Error(`${label} traverses a symlink and is not allowed: ${current}`);
    }
}
```

This approach:
- ✅ Walks EVERY path segment with `lstat` (does not follow symlinks)
- ✅ Catches symlinks at intermediate directories, not just the final path
- ✅ More granular: detects `worktree/a/b → worktree/c/d` even if both are within worktree
- ✅ Used by `install-governance.mjs` (lines 379, 394, 434, 465, 482, 510, 589) for safe file operations

**The gap:** The kernel gate uses `realpathSync` (resolves the chain), while `assertSafePath` uses per-segment `lstat` (catches any symlink in the chain). These are complementary checks but with different purposes:
- `NO_SYMLINK_ESCAPE` → detects whether the file ultimately lives outside the worktree
- `assertSafePath` → detects whether ANY path component is a symlink (defense-in-depth, prevents TOCTOU setup)

The kernel gate does not use `lstat` per-segment, which means a crafted symlink chain (`worktree/a → worktree/b → /etc/passwd`) would still be caught by `realpathSync` → escape detected. But a symlink that stays within the worktree (`worktree/a → worktree/b`) is NOT caught by the kernel gate but IS caught by `assertSafePath`.

### Assessment

This is more of a **design consistency issue** than a vulnerability:
- The kernel gate's primary job is escape detection → `realpathSync` is the right tool for that
- The `assertSafePath` function's primary job is safe file operations → per-segment `lstat` is the right tool for that
- The kernel gate could benefit from ALSO doing per-segment checking, but the escape detection is not broken

**TOCTOU concern:** The `existsSync` → `realpathSync` window (lines 172-174) is a real TOCTOU, but the attacker needs to:
1. Create a symlink at the exact path between the `existsSync` check and `realpathSync` call
2. Have this happen within a single synchronous code block — window is microseconds

### CVSS Assessment

**Not CVSS-scoreable as a standalone vulnerability.** The escape detection works correctly via `realpathSync`. The per-segment checking is a defense-in-depth improvement, not a bug fix. The TOCTOU window is too narrow to be practically exploitable without kernel-level race-condition tooling.

Classification: **INFORMATIONAL** — Design consistency improvement.

### Recommendation

1. **Document the design choice:** Add a comment to `NO_SYMLINK_ESCAPE` explaining why `realpathSync` is sufficient for escape detection and that per-segment checking is handled by `assertSafePath` for file operations.
2. **Add lstat pre-check (optional):** Before `realpathSync`, do a quick `lstatSync` on the normalized path. If it's a symlink, the gate has already detected the situation — no TOCTOU. If it's NOT a symlink (regular file/directory), it can't become one between `lstatSync` and `realpathSync` because the path is a regular file.

```javascript
// Minor hardening:
try {
    const stat = lstatSync(normalized);  // does NOT follow symlinks
    if (!stat.isSymbolicLink()) {
        return { allowed: true };  // not a symlink, no escape possible
    }
    // It IS a symlink → now resolve it safely
    const realPath = realpathSync(normalized);
    // ... existing check
} catch {
    // path doesn't exist → pass
}
```

---

## Cross-Cutting Observations

### Defense-in-Depth Layering

The governance system has multiple enforcement layers, each with different strengths:

| Layer | Strength | Weakness |
|-------|----------|----------|
| OpenCode Plugin (`canonical-governance.mjs`) | In-process, no IPC overhead | Can be deleted/disabled by local user |
| Hermes Hook (`gate_hook.py`) | Python-side, harder to disable | Has its own path-check implementation (F5) |
| CLI Evaluator (`evaluate-gates.mjs`) | External process, can be called from any runtime | Only called on-demand, not automatic |
| Kernel Gates (`kernel.mjs`) | 19 immutable gates, deeply integrated | Bypassed if evaluator is not called |

**The F1 finding is critical to this picture:** If the OpenCode plugin is deleted, the ONLY remaining enforcement for OpenCode is:
- OpenCode's built-in permission system (`opencode.jsonc` `permission` section)
- External monitoring (cron job checking evidence directory)
- Filesystem permissions

### Honest Enforcement Level Claims

The `determineEnforcementLevel()` function in `install-governance.mjs` (lines 214-228) is honest:

```javascript
if (opencode || hermes) {
    const hasHookSupport = opencode && opencode.confidence >= 80;
    return hasHookSupport ? "HOOK_ENFORCED" : "STRUCTURAL_ONLY";
}
return "ADVISORY_ONLY";
```

✅ OpenCode detection confidence ≥ 80 → HOOK_ENFORCED
✅ OpenCode detection confidence 50-79 → STRUCTURAL_ONLY
✅ No runtime detected → ADVISORY_ONLY

This is the correct, honest tier system. F2 (installer bypass) would install files even in ADVISORY_ONLY mode, but the manifest would correctly label the enforcement level.

### Regex-Based Command Classification

Both the OpenCode plugin (`determineBashAction`, lines 89-112) and Hermes hook (gate_hook.py lines 96-108) use regex-based command classification. This is inherently bypassable via shell encoding (base64, eval, printf). This is a known limitation of any string-matching approach and should be documented as such in `SECURITY.md`.

---

## Remediation Priority

| Priority | Finding | Action | Effort |
|----------|---------|--------|--------|
| **P0** | F1: Plugin deactivatable | Document as advisory layer; add session nonce attestation | Medium |
| **P1** | F5: Hermes `.startswith()` path check | Replace with proper path containment; restrict `/tmp/` | Small |
| **P2** | F3: TOCTOU hash→import | Combine read+verify+import into atomic operation | Small |
| **P3** | F6: Nonce ledger race | Use `O_EXCL` atomic create for ledger files | Small |
| **P4** | F4: Delegate fail-open | Add `DELEGATE` to fail-closed risk set | Trivial |
| **P5** | F2: Installer gate bypass | Add `evaluateAllGates()` call in apply phase | Medium |
| **P6** | F7: Symlink lstat | Add comment documenting design choice; optional lstat pre-check | Trivial |

---

## Review Signature

- **Reviewer:** Security Agent (DeepSeek v4 Pro)
- **Commit Reviewed:** `0a3761963d859c9af8c11dd0cd9dc3ff5dcfe797`
- **Branch:** `agent/url-installer-runtime-enforcement`
- **Scope:** 8 files examined (see analysis above)
- **Methodology:** Read-only structural analysis + code-flow tracing + design review
- **Limitations:** No live runtime testing; no PoC execution; no cross-process race simulation
- **Evidence Level:** `STRUCTURAL_PASS` — structural validation through code review only

---

## Files Examined

| File | Lines | Review Focus |
|------|-------|-------------|
| `.opencode/plugins/canonical-governance.mjs` | 289 | F1, F3, F4 |
| `scripts/install-governance.mjs` | 1094 | F2 |
| `scripts/lib/gates/evaluate-all.mjs` | 453 | F2 context, delegate flow |
| `scripts/lib/gates/kernel.mjs` | 694 | F7, F5 comparison |
| `scripts/lib/gates/approval.mjs` | 474 | F6 |
| `scripts/lib/gates/decision.mjs` | 259 | F2 context |
| `scripts/lib/gates/errors.mjs` | 304 | F4 context |
| `scripts/lib/paths.mjs` | 136 | F7, symlink hardening |
| `integrations/hermes/gate_hook.py` | 163 | F5 |
| `integrations/hermes/runtime_client.py` | 174 | F5 context |
| `integrations/hermes/tool_mapping.py` | 94 | F5 context |

**Total:** ~3,640 lines examined across 11 files.
