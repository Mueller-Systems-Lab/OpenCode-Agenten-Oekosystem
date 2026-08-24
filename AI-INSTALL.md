# AI-INSTALL.md — Automation Install Contract

This document is the automation-specific installation path. For a human
install, use the versioned [OCAE CLI quick start](README.md#quick-install).

## Handoff boundary

`DEFAULT_INTENT = INSTALL_IN_CALLER_WORKSPACE` for the bare canonical OCAE URL.
`TARGET_CAPTURE_BEFORE_CLONE`, `TARGET_IMMUTABLE`, `SOURCE_IS_NOT_TARGET`, and
`SOURCE_MUTATION_FORBIDDEN` are mandatory. Resolve and save the absolute caller
`TARGET_ROOT` before any fetch, clone, checkout, CWD change, or source read; all
commands below receive that saved path explicitly. `DEVELOPMENT_REQUIRES_EXPLICIT_INTENT`:
only an explicit OCAE development request authorizes source changes. See the
[machine-readable handoff contract](ocae.handoff.json) and the complete
[AI bootstrap protocol](AI-BOOTSTRAP.md).

## Product boundary

OCAE CLI v1.0.4 installs the complete project-local OpenCode ecosystem:

- 13 installable agents and 13 capability profiles
- skills, policies, and the OpenCode Governance Plugin
- MCP preflight, source-lock integrity, provenance, backup, and rollback

The Python CLI owns package validation, provenance, and subprocess orchestration.
[`scripts/install-governance.mjs`](scripts/install-governance.mjs) remains the
only canonical governance/installation implementation and is executed from a
hash-verified payload.

## Preferred automation entry point

Automation should pin the published release and use the same CLI commands as a
human operator:

```bash
uv tool install ocae-cli --from git+https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem.git@v1.0.4
ocae doctor "<TARGET_ROOT>"
ocae install "<TARGET_ROOT>" --dry-run
ocae install "<TARGET_ROOT>"
ocae verify "<TARGET_ROOT>"
ocae integrate opencode
```

The dry-run must be reviewed before an apply. The target path is project-local;
never read target secrets, credential files, or `.env` contents.

## Direct Node compatibility path

A URL-only automation caller that cannot use `uv` may invoke the canonical Node
installer from an exact checkout. This is a compatibility path, not the primary
human workflow:

```bash
node scripts/install-governance.mjs --target "<TARGET_ROOT>"       # dry-run
node scripts/install-governance.mjs --target "<TARGET_ROOT>" --apply
node scripts/install-governance.mjs --target "<TARGET_ROOT>" --rollback <backup-dir>
```

The source repository, ref, and commit must be recorded from the same checkout.
`AI-BOOTSTRAP.md` defines the full URL-only protocol, including target-boundary
and provenance rules.

## Safety contract

- dry-run is required before apply
- existing project configuration, providers, models, MCPs, user agents, and
  third-party plugins are preserved
- backups are created before mutation
- name conflicts and source-lock tampering fail closed
- `ocae integrate opencode` is an explicit one-time global opt-in: it writes
  only the OCAE-owned adapter/manifest, does not rewrite OpenCode config or
  third-party plugins, and is removable with `--remove`
- no MCP is enabled automatically
- no secrets are read or written to reports

## Installed structure

The managed target contains the selected `.opencode/agents/`, skills, policies,
capability bindings, `.opencode/ecosystem-installation.json`, and governance
runtime assets under `.agent-governance/`. Provenance records the source
repository, source ref, commit, managed files, and installed agents.

## Modes and classifications

Automation must distinguish:

- `VERIFIED_IN_SCOPE` — preflight, apply, and verification passed
- `NOOP_IDEMPOTENT` — the requested state already matches
- `NEEDS_REVIEW` — a conflict or owner decision remains
- `TOOL_GAP` — required runtime verification tooling is unavailable
- `RED_BLOCK` — a safety or integrity check blocked the operation

Do not turn a tool gap or review state into a success claim.

## Requirements

- Python >= 3.11 and `uv` for the CLI path
- Node.js for the canonical installer
- OpenCode for runtime discovery and governed agent execution
- write access to the target project; no root or sudo

## Rollback

Use the backup path emitted by the installer:

```bash
ocae rollback <target> --backup <backup-dir>
```

Rollback restores managed changes, detects later edits, and preserves owner
content. Do not invent a backup path.
