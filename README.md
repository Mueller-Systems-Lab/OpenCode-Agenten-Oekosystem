# OpenCode Agent Ecosystem

This repository is a universal bootstrap kit for project-local OpenCode and Hermes Agent setup.

It also serves as the **canonical workflow contract + policy source** — see [`WORKING-METHOD.md`](WORKING-METHOD.md) for the evidence-driven, risk-tiered execution model, and `.hermes/skill-bundles/canonical-working-method.yaml` for the Hermes-native YAML skill bundle.

The intended workflow is:

1. hand an AI the repository URL
2. point it at a target project path
3. let it run a dry-run first
4. review the generated discovery and plan
5. apply only with explicit `--apply`
6. rollback from the printed backup manifest if needed

Start with [`BOOTSTRAP.md`](BOOTSTRAP.md) for the bootstrap flow, or [`WORKING-METHOD.md`](WORKING-METHOD.md) for the canonical execution contract.

## What it does

- analyzes the target project
- selects minimal agents, skills, and MCP candidates
- preserves existing provider and model settings
- keeps MCPs disabled by default
- prepares project-local OpenCode configuration
- prepares project-local Hermes handoff assets
- records evidence, conflicts, and rollback data
- avoids copying remote CI unless `--include-remote-ci` is passed

## Safe Defaults

- dry-run is the default
- project files are merged, not blindly replaced
- existing OpenCode and Hermes artifacts are preserved
- no global OpenCode or Hermes config is rewritten automatically
- no secrets are read or written to reports
- no local MCP is auto-activated

## Core Commands

Dry-run:

```bash
node scripts/bootstrap-project.mjs \
  --target /path/to/target-project
```

Apply:

```bash
node scripts/bootstrap-project.mjs \
  --target /path/to/target-project \
  --apply
```

Apply with remote CI proposals:

```bash
node scripts/bootstrap-project.mjs \
  --target /path/to/target-project \
  --apply \
  --include-remote-ci
```

Rollback:

```bash
node scripts/bootstrap-project.mjs \
  --target /path/to/target-project \
  --rollback /path/to/backup-dir
```

Validate this repository:

```bash
node scripts/validate-ecosystem.mjs
```

## Generated Artifacts

Typical outputs in the target project include:

- `opencode.jsonc`
- `AGENTS.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `.opencode/reports/bootstrap/`
- `.hermes.md`
- `.hermes/README.md`
- `.hermes/skills/README.md`
- `.hermes/bundles/project-bootstrap.json`
- `.hermes/mcp/opencode-gateway.md`
- `docs/reports/universal-bootstrap-run-report.md`

## OpenCode

OpenCode remains the primary coding executor.

The bootstrap:

- keeps project-local config project-local
- preserves existing provider and model choices
- keeps project MCPs disabled unless explicitly reviewed
- merges instructions and permissions conservatively

## Hermes

Hermes acts as the gateway, orchestrator, and skill runtime.

The bootstrap writes portable handoff assets only. It does not rewrite `~/.hermes` automatically.

Hermes is treated as an opt-in runtime:

```bash
hermes --skills project-bootstrap,project-reality-refresh,run-card,mcp-selection,hermes-handoff,worktree-safety,checkpoint-and-rollback,living-truth-mirror,remote-ci-approval-gate,provider-neutral-config
```

If you explicitly want the gateway mode, review the generated handoff note first and enable it manually.

## Run Classification

Every run is classified as one of:

- `GREEN_SAFE`
- `AMBER_REVIEW`
- `RED_BLOCK`
- `TOOL_GAP`

Use the classification as the final gate before any apply step.

## Repository Self-Check

This repository ships with its own validator, manifests, docs, and fixtures. When changing bootstrap behavior, keep the following layers aligned:

- machine-readable truth: manifest and validator output
- technical truth: architecture, ADR, plan, and reports
- user truth: README, BOOTSTRAP, troubleshooting, and examples

## Canonical Working Method Layer

This repository defines a **canonical working method** — a formal 22-step execution order with risk tiers, evidence gates, and verification contracts. See:

- [`WORKING-METHOD.md`](WORKING-METHOD.md) — Full text of the canonical workflow
- `.hermes/skill-bundles/canonical-working-method.yaml` — Hermes-native YAML skill bundle of the same method
- [`.opencode/policies/evidence-gates.json`](.opencode/policies/evidence-gates.json) — Gate definitions for each claim type
- [`.opencode/policies/write-protection.json`](.opencode/policies/write-protection.json) — Write protection rules

Use the working method for any non-trivial implementation, architecture decision, or integration task.

## Notes

- Remote CI is proposal-only unless `--include-remote-ci` is present.
- Domain-specific rules such as tierheim/CiviPet policies are conditional, not automatic.
- Existing files are never silently overwritten.
