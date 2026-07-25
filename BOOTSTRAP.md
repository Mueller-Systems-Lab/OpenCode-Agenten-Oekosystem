# OpenCode Agent Ecosystem Bootstrap

This repository is the source of truth for a safe, project-local bootstrap of OpenCode and Hermes Agent.

It also serves as the **canonical workflow contract + policy source** — see [`WORKING-METHOD.md`](WORKING-METHOD.md) for the evidence-driven, risk-tiered execution model, and `.hermes/skill-bundles/canonical-working-method.yaml` for the Hermes-native YAML skill bundle.

Start here if you only know the repository URL:

1. Read this file first.
2. Read the repository instructions and safety files.
3. Run a dry-run against the target project.
4. Review the generated discovery and plan.
5. Apply only if you explicitly want files to change.

## Safety Model

- Dry-run is the default.
- `--apply` is required before any file changes.
- Existing project files are merged, not blindly replaced.
- Existing providers, models, and custom MCPs are preserved unless you explicitly choose otherwise.
- Remote CI is opt-in only.
- MCP servers remain disabled unless explicitly enabled.
- Backups are created before writes.
- Rollback is always available from the backup manifest.

## Basic Usage

Dry-run:

```bash
node scripts/bootstrap-project.mjs \
  --target /pfad/zum/zielprojekt
```

Apply:

```bash
node scripts/bootstrap-project.mjs \
  --target /pfad/zum/zielprojekt \
  --apply
```

Apply with remote CI proposals:

```bash
node scripts/bootstrap-project.mjs \
  --target /pfad/zum/zielprojekt \
  --apply \
  --include-remote-ci
```

Rollback from a backup directory:

```bash
node scripts/bootstrap-project.mjs \
  --target /pfad/zum/zielprojekt \
  --rollback /pfad/zum/backup-verzeichnis
```

## What the Bootstrap Does

The bootstrap analyzes the target project and prepares:

- a project discovery report
- a bootstrap plan
- a project-local OpenCode configuration
- a project-local Hermes bundle
- minimal MCP recommendations
- backup and rollback metadata
- evidence and validation reports

The exact file set is driven by the discovered project type. The bootstrap does not assume JavaScript, Python, Docker, or a fixed shell.

## Generated Files

Typical outputs include:

- `opencode.jsonc`
- `.opencode/agents/`
- `.opencode/skills/`
- `.opencode/policies/`
- `.opencode/reports/bootstrap/`
- `.hermes.md`
- `.hermes/README.md`
- `.hermes/skills/`
- `.hermes/bundles/`
- `.hermes/mcp/`
- `docs/reports/universal-bootstrap-run-report.md`

If the target project already has any of these files, the bootstrap merges them conservatively and records conflicts as `AMBER_REVIEW`.

## Review The Plan

Always inspect the dry-run output before applying changes.

The bootstrap prints:

- project discovery signals
- selected agents and skills
- selected MCP candidates and trust tiers
- files that would be created or modified
- planned backup location
- rollback command

## OpenCode Usage

After applying the bootstrap:

```bash
cd /pfad/zum/zielprojekt
opencode
```

OpenCode remains the primary coding executor. The generated config keeps MCPs disabled by default and preserves existing project rules.

## Hermes Usage

The bootstrap generates project-local Hermes assets that can be loaded as a portable bundle.

**Important:** Hermes is a Python-based agent (repository: `NousResearch/hermes-agent`), not embedded in OpenCode. The commands below reflect the documented Hermes interface; actual runtime behavior may differ depending on the installed version. If Hermes is not installed in the target environment, the live test is classified as `TOOL_GAP_HERMES_RUNTIME`.

### Flat Skills List (Legacy)

```bash
cd /pfad/zum/zielprojekt
hermes --skills project-bootstrap,project-reality-refresh,run-card,mcp-selection,hermes-handoff,worktree-safety,checkpoint-and-rollback,living-truth-mirror,remote-ci-approval-gate,provider-neutral-config
```

### YAML Skill Bundle (Recommended)

Load the canonical working method from the native YAML bundle:

```bash
cd /pfad/zum/zielprojekt
hermes bundle load .hermes/skill-bundles/canonical-working-method.yaml
```

Or configure Hermes to load the bundle automatically (see `.hermes/config.example.yaml`):

```yaml
# In your Hermes config
skills:
  bundles:
    - ${WORKING_METHOD_REPO}/.hermes/skill-bundles/canonical-working-method.yaml
```

### MCP Gateway Mode

If you want Hermes to act as an MCP server gateway, use the generated handoff notes and start it explicitly:

```bash
hermes mcp serve
```

Do not enable the gateway automatically. Treat it as an opt-in bridge after review.

## Rollback

Every apply run writes a backup manifest. Use the rollback command printed by the bootstrap, or point `--rollback` at the recorded backup directory.

Rollback restores the previous file contents and leaves the discovery history in place.

## Run Classification

The bootstrap classifies each run as one of:

- `GREEN_SAFE`
- `AMBER_REVIEW`
- `RED_BLOCK`
- `TOOL_GAP`

Classification is based on:

- repository readiness
- target project signals
- merge conflicts
- missing tooling
- unsafe write requests

## Required Reads

Before changing a target project, read:

- [AGENTS.md](AGENTS.md)
- [SECURITY.md](SECURITY.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [`ecosystem.manifest.json`](ecosystem.manifest.json)
- [`WORKING-METHOD.md`](WORKING-METHOD.md) — the canonical 22-step execution order

## Notes

- The bootstrap is intentionally conservative.
- No repository file is changed during dry-run.
- Remote CI is only considered when `--include-remote-ci` is passed.
- Domain-specific policies such as tierheim or civic-tech rules are only activated when the discovery signals justify them.
- The Canonical Working Method (see `WORKING-METHOD.md` and `.hermes/skill-bundles/canonical-working-method.yaml`) defines the full evidence-gated, risk-tiered workflow. Use it for any non-trivial implementation task.
