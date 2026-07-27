# Security and Privacy Review — Canonical User Action Handoff

**Date:** 2026-07-27
**Scope:** Issue #18 implementation
**Order:** Security assessment completed before privacy/compliance assessment.

## Data Flow

```text
producer input
  → canonical action normalization
  → capability-first semantic validation
  → secret and portable-local-path redaction
  → deterministic Markdown and/or machine completion output
```

The renderer performs no network operation. The standalone validator reads only
explicit `.json` and `.md` regular files, refuses `.env` names and symlinks, and
emits redacted diagnostics. Bootstrap writes the canonical schema and reports
only inside the validated project target. GitHub mutation is neither performed
nor simulated by this feature's runtime.

## Security Checks

| ID | Threat | Control | Evidence | Result |
| --- | --- | --- | --- | --- |
| SEC-01 | fabricated capability gap | complete evidence fields plus alternative-tool and suitable-agent rejection | positive/negative contract suite | PASS |
| SEC-02 | unauthorized effect disguised as user task | `ACTION_CAPABILITY_AVAILABLE`, executed-effect conflict, and controlled reason combinations | focused contract suite | PASS |
| SEC-03 | CLI-only or falsely manual GitHub guidance | inferred GitHub target, mandatory `github_web`, visible-control and sequence validator | focused contract suite | PASS |
| SEC-04 | secret or private path disclosure | central redactor plus portable local-path redaction for Linux, macOS, Windows, WSL, media and root prefixes | security suite and renderer test | PASS |
| SEC-05 | secret-file or symlink read | standalone validator refuses `.env` names and symlink inputs before reading | validator contract test | PASS |
| SEC-06 | schema/prompt/runtime drift | generated Governance IR check and ecosystem cross-surface validator | generator and ecosystem validator | PASS |
| SEC-07 | real external mutation during tests | fixtures and local temporary directories only | test inspection and command scope | PASS |

The final targeted security run executed 105 tests with 105 passes, zero failures, zero
skips, and zero cancellations. The changed-file scan found no credential-shaped
values, private repository/worktree paths, prohibited databases, `.env`
artifacts, or `.github/workflows` changes. `git diff --check` passed.

No security severity claim is made because no reproducible vulnerability was
found.

## Privacy and Compliance Assessment

The contract may receive report prose supplied by producers, but it does not
require personal data and creates no new remote transfer, telemetry, retention
store, consent flow, or production data mutation. It minimizes output to a
reason, target, and concrete instructions; secrets and portable local paths are
redacted before Markdown emission. Local bootstrap reports retain the existing
project-local lifecycle and permissions.

DSGVO/GDPR compliance is not claimed for downstream projects. Their independent
data flows and retention policies remain outside this feature. Within this
scope, no new personal-data processing purpose or retention obligation was
introduced.

## Residual Security Limits

- GitHub labels can vary with repository settings and UI rollout. The
  `label_source` field and mandatory abort condition prevent a live-check claim
  when no authenticated browser verification occurred.
- A consumer can ignore validation. Repository-managed producers and the
  ecosystem validator are enforced here; arbitrary external consumers remain
  outside this repository's control.
