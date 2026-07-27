# PR #7 Scope Correction Proposal

## Current State

**PR Title:** `feat(spec-kit): integrate verified OpenCode assurance gates`

**Current PR Body:** References only the Spec-Kit integration (Commit 9), with outdated test counts (425) and incomplete evidence references.

**Classification:** `PR_DESCRIPTION_NEEDS_UPDATE` and `PR_TITLE_TOO_NARROW` (from PR7-AUDIT-005)

> **HISTORICAL REPORT:** This proposal records the earlier PR #7 scope and
> plugin-path model. It is not an active Issue #16 installation instruction.
> The current verified bridge is `.opencode/plugin/governance-v2.ts`.

## Historical Scope Analysis

PR #7 contains **two major historical theme lines** spanning 9 commits:

### Theme 1: URL Installer & Runtime Enforcement (Commits 1–8)

| Commit | SHA | Description |
|--------|-----|-------------|
| 1 | `0a37619` | fix: enforce governance after URL bootstrap |
| 2 | `778b3fd` | fix: close runtime enforcement contract and security gaps |
| 3 | `129f3a9` | fix: complete managed runtime enforcement validation |
| 4 | `daac7b7` | fix(runtime): complete managed enforcement verification |
| 5 | `e12f692` | chore: fix evidence run-card (obsolete history) |
| 6 | `7b68237` | fix(runtime): prevent global Hermes detection false positives |
| 7 | `8be7933` | fix(hermes): register governance pre-tool hook |
| 8 | `a0d9e7a` | fix(installer): flush dry-run stdout before exit |

**Files affected:** ~90 files across:
- `scripts/install-governance.mjs` (new, 1119 lines)
- `scripts/lib/gates/*.mjs` (kernel, policy, approval, evidence, etc.)
- `scripts/lib/runtimes/*.mjs` (opencode, hermes, odysseus adapters)
- `scripts/lib/security/redaction.mjs` (new, 141 lines)
- `scripts/evaluate-gates.mjs`, `scripts/evaluate-operation.mjs`
- `integrations/hermes/*` (gate_hook.py, runtime_client.py, installer.py)
- `docs/architecture/adr-004-*.md`, `adr-005-*.md`
- `test/install/*.test.mjs`
- `.opencode/plugins/canonical-governance.mjs`

### Theme 2: Spec-Kit Integration (Commit 9)

| Commit | SHA | Description |
|--------|-----|-------------|
| 9 | `bb1af2e` | feat(spec-kit): add verified OpenCode assurance integration |

**Files affected:** ~30 files across:
- `integrations/spec-kit/*` (bundle, catalog, extension, preset, workflow files)
- `scripts/evaluate-operation.mjs` (bridge)
- `docs/guides/spec-kit-*.md`
- `docs/reports/spec-kit-integration-final-report.md`

## Known Issue Requiring Scope Documentation

The PR7-AUDIT also discovered a **runtime regression** (PR7-AUDIT-001) where the installer fails to copy `redaction.mjs` to the installed resident runtime, causing `ERR_MODULE_NOT_FOUND`. This defect was introduced in Theme 1 (the `redaction.mjs` file was created but not added to `getRuntimeFileList()` in Commit 1, and subsequent commits including the Spec-Kit integration did not catch this gap).

## Proposed Corrections

### Option A: Expanded Title + Body (Recommended - Non-Destructive)

**Proposed Title:**
```
feat: URL installer, runtime enforcement, and Spec-Kit assurance integration
```

**Proposed Body Outline:**
```
## Overview
This PR delivers two integrated capabilities:

### 1. Governance URL Installer & Runtime Enforcement
- Universal URL-based installer for agent governance
- Canonical gate evaluation kernel (19 kernel gates)
- Managed runtime enforcement for OpenCode and Hermes
- Fail-closed runtime with approval receipts and credential containment
- Security redaction adapter for secrets/PII

### 2. Spec-Kit Assurance Integration
- Verified OpenCode assurance extension with 7 slash commands
- Bridge from Spec-Kit workflows to canonical gate kernel
- Bundle, catalog, preset, and workflow for Safe Delivery

### PR7-Remediation Fixes (applied in remediation branch)
- Fix: redaction.mjs added to resident runtime file list
- Fix: resident runtime test enforces real import success
- Fix: documentation test counts updated to actual (388/388)
```

### Option B: Split into Two PRs (Destructive - Requires Branch History Change)

- **PR #7a:** URL Installer + Runtime Enforcement (Commits 1–8 + remediation fix)
- **PR #7b:** Spec-Kit Integration (Commit 9 + rebase on #7a)

**Risk:** Force-push/rebase required. Complex history rewrite. NOT recommended without Owner approval.

## Recommendation

**Option A** is recommended:
1. Update PR title and body to reflect both theme lines
2. Include the remediation fix (redaction.mjs, test fix) as part of the PR
3. Fix all documentation claims to match actual test counts
4. No destructive branch history changes needed

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Large PR scope (184 files with remediation) | MEDIUM | Clear separation in PR body; separate review passes per theme |
| Historical commit messages don't match expanded title | LOW | Commit messages remain accurate for their individual changes; PR title describes overall intent |
| Owner might prefer split | LOW | Option B documented; no action without Owner approval |
| Branch history rewrite (Option B) | HIGH | NOT recommended without explicit Owner approval; may lose audit trail |

## Files Not Touched

This document is a proposal only. No GitHub changes have been made to PR #7. The PR remains DRAFT. No title, body, branch history, or reviewer status has been modified.
