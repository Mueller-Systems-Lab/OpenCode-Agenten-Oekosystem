# OCAE CLI v1 Documentation and Landing Page Specification

Status: Completed — superseded by the stable v1.0.5 publication

## Goal

Reconcile active user-facing documentation with the released `ocae-cli` v1.0.5
product and provide a dependency-free, publishable GitHub Pages landing page.
The runtime and installer implementation are out of scope.

## Scope

- README product overview and primary CLI quick start
- CLI reference and current requirements/troubleshooting
- AI/bootstrap documents clearly separated into human and automation paths
- `docs/index.html` static landing page with local CSS and JavaScript only
- generated release data derived from the manifest and installable agent files
- repository description, topics, homepage, and Pages configuration
- documentation, link, version, agent-count, security, and browser checks

Historical evidence and reports remain unchanged unless they are active
navigation surfaces or contain a current product claim that users would rely on.

## Product truths

- Version: `1.0.5` / tag `v1.0.5`
- Primary runtime: OpenCode
- Installable inventory: 13 agents, one primary and 12 subagents
- Primary agent: `issue-orchestrator`
- Canonical installer: `scripts/install-governance.mjs`
- CLI installation: `uv tool install ...@v1.0.5`
- Hermes: optional and non-blocking

## Acceptance criteria

1. The first README screen removes the archive notice and presents the v1.0.5
   CLI install path, three-step quick start, and 13-agent product scope.
2. `docs/index.html` contains a semantic, responsive product landing page with
   hero, copyable install command, quick start, agent inventory, governance,
   architecture, CLI, safety, provenance, documentation, and GitHub sections.
3. The landing page has no external scripts, fonts, tracking, cookies, or
   untrusted HTML injection; keyboard focus and reduced-motion behavior are
   covered in the markup/styles/scripts.
4. `docs/release-data.json` is generated from `ecosystem.manifest.json` and
   `.opencode/agents/*.md`; tests fail on version or inventory drift.
5. Active docs use `VERIFIED_IN_SCOPE`, `TOOL_GAP`, `NEEDS_REVIEW`, and
   `RED_BLOCK`; legacy compatibility paths are labeled as such.
6. Active navigation contains no archive banner, stale 9-agent/10-skill claim,
   current CT108 gate, or TTS product claim.
7. The focused docs/site checks, canonical validator, and proportionate
   regression checks pass. Browser QA covers 375, 768, 1280, and 1440 px.
8. The branch is published as a PR to `master`; Pages and repository metadata
   are verified after merge when GitHub permissions permit.

## Verification contract

| Area | Evidence | Pass condition |
|---|---|---|
| Truth | manifest, CLI version, agent directory | all resolve to v1.0.5 and 13 installable agents |
| Docs | `scripts/validate-docs.mjs` | stale claims absent; commands and links valid |
| HTML | local static checks | balanced required elements and safe external links |
| Security | source inspection | no remote scripts, `eval`, secrets, or unsafe link targets |
| Browser | Playwright or equivalent screenshots/DOM checks | no horizontal overflow; CTA and copy action work at all target widths |
| Runtime regression | `node scripts/validate-ecosystem.mjs` and focused tests | existing validator/contracts remain green |
| Deployment | GitHub Pages/API and HTTP fetch | Pages source is `master:/docs`, site responds successfully |

## Explicit uncertainties

- Pages configuration may require repository-admin access even when GitHub CLI
  authentication is available.
- Browser automation availability is checked locally; if unavailable, static
  checks remain evidence but visual QA is reported as a tool gap.
