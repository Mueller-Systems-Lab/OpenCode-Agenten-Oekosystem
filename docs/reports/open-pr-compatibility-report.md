# Open PR Compatibility Report

Date: 2026-07-24
Closure branch: `feat/governance-v2-closure-20260724`

## PR #8 — Model Assurance Gates

Source reviewed: PR #8 body and commit `ee220b407f1a93bb29a575abdfdd6f53e611623c`.

- The PR adds model-assurance hard gates and fake-model contract tests.
- The URL-only verifier treats model-assurance files as source-repository evidence and does not copy or modify them.
- The V2 installer keeps provider calls opt-in and does not grant model-assurance output authorization.
- The legacy `GREEN_SAFE` references in PR #8 remain compatibility input; the new bootstrap contract reports `VERIFIED_IN_SCOPE` and does not claim model evaluation.
- No PR #8 file or branch was changed by this closure run.

Compatibility result: `COMPATIBLE_IN_SCOPE`.

## PR #11 — Governed Frontend Design Skills

Source reviewed: PR #11 body and commit `0b138567bc0e9bf9e84144b6c1f57efd4a211000`.

- The PR changes `opencode.jsonc`, agents, skills, `ecosystem.manifest.json`, and governance documentation.
- The closure installer does not overwrite target `opencode.jsonc`, `opencode.json`, `AGENTS.md`, or owner skill/agent content. It installs the resident Governance V2 runtime under `.agent-governance` and only creates an OpenCode hook when runtime signals justify it.
- Existing unknown generated hook files are preserved or classified for review; they are not silently replaced.
- The URL-only root link is additive and does not alter PR #11's agent or skill contract.
- No live frontend/provider validation is claimed by this report.
- No PR #11 file or branch was changed by this closure run.

Compatibility result: `COMPATIBLE_IN_SCOPE`.

## Boundaries

- This is a structural compatibility assessment, not a merge simulation or a review approval for either PR.
- Merge, auto-merge, deployment, and production/provider validation remain unauthorized and unexecuted.
