# OCAE CLI Reference

OCAE CLI v1.0.4 is the versioned distribution layer for the OpenCode Agent
Ecosystem. It bundles a build-generated, hash-verified closure of the canonical
Node installer and invokes it from an isolated payload directory.

The Python CLI owns argument validation, package integrity, provenance,
preflight, subprocess orchestration, and presentation. Governance decisions,
configuration merges, backups, rollback, agent installation, source locks, and
runtime assets remain owned by
[`scripts/install-governance.mjs`](../scripts/install-governance.mjs).

## Installation

Install the published release with `uv`:

```bash
uv tool install ocae-cli --from git+https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem.git@v1.0.4
```

The source ref is pinned to `v1.0.4`. The package does not clone the repository
during target installation.

## Quick start

From the target project:

```bash
ocae doctor .
ocae install . --dry-run
ocae install .
ocae verify .
```

`doctor` reports package integrity, Node.js, OpenCode, target permissions, and
existing installation state. `install --dry-run` performs the canonical plan
without changing the target. Apply only after reviewing that plan.

### Existing-project pre-task reconciliation

The global OpenCode adapter reconciles an installed OCAE project before the
first ordinary task. It reads the trusted project marker and source-lock
metadata without using the task prompt as authority. Older compatible installs
are migrated through the canonical installer and verified, current installs
continue directly to task bootstrap, and foreign projects pass through. Newer,
corrupt, tampered, or incompatible projects fail closed as
`PROJECT_INCOMPATIBLE`, `PROJECT_CORRUPT`, or `MIGRATION_BLOCKED_MANAGED_DRIFT`.
No manual task-capsule or owner-intent preparation is part of this product flow.

## Commands

### Version and provenance

```bash
ocae --version
ocae version
ocae version --json
ocae provenance
ocae provenance --json
```

`provenance` reports the distribution version, source repository, source ref,
source commit, payload hash, and payload file count. It does not expose secrets.

### Target operations

```bash
ocae doctor <target>
ocae install <target> --dry-run
ocae install <target>
ocae verify <target>
ocae update <target>
ocae rollback <target> --backup <backup-dir>
```

The target defaults to `.`. `update` preserves owner-edited content and only
updates managed files whose recorded state permits it. `rollback` requires a
backup directory emitted by a completed installation; never invent one.

Every target apply creates or updates project-local governance assets and
records managed files, installed agents, capability-profile bindings, source
repository, source commit, and source-lock hashes. OpenCode remains the primary
verified runtime. Hermes is optional and non-blocking.

### Global OpenCode bare-URL handoff

Enable the optional one-time integration after installing the CLI:

```bash
ocae integrate opencode
ocae integrate opencode --verify
```

The command discovers the installed OpenCode 1.18.x global plugin directory,
writes one OCAE-owned adapter plus a provenance manifest, and verifies that
OpenCode loads it. The adapter intercepts only the canonical OCAE repository URL
in `chat.message`; for ordinary tasks in an existing OCAE project it first
performs the pre-task reconciliation described above. It captures OpenCode's
current workspace, and invokes the
absolute, hash-bound `ocae` launcher with structured arguments and
`shell=false`. It performs doctor → verify → install/update → verify in the
caller workspace, then replaces the model message with a trusted result block.
Explicit OCAE development requests, unrelated URLs, source-target collisions,
symlinked targets, and manifest or executable tampering fail closed. OpenCode's
existing config and third-party plugins are not rewritten.

Use `ocae integrate opencode --remove` to remove only the OCAE-owned adapter and
manifest. Re-running the command is safe and returns `NOOP_IDEMPOTENT` when the
binding is already current.

## Product inventory

The released installer discovers 13 installable agents: one primary agent,
`issue-orchestrator`, and 12 subagents. The inventory is sourced from
[`../.opencode/agents/`](../.opencode/agents/) and mirrored in
[`../docs/release-data.json`](release-data.json). Each installable agent has a
capability profile, MCP preflight context, and runtime permissions.

The runtime canary and OpenCode discovery are separate checks: a successful
package install does not claim runtime execution when OpenCode is unavailable.

## Requirements

- Python >= 3.11
- `uv`
- Node.js for the canonical installer payload
- OpenCode for runtime discovery and governed agent execution
- write access to the target project; root/sudo is not required

## Classifications and exit codes

The CLI preserves the most precise result from the canonical installer:

| Classification | Meaning | Typical exit |
| --- | --- | --- |
| `VERIFIED_IN_SCOPE` | Required checks passed | 0 |
| `NOOP_IDEMPOTENT` | Desired managed state already exists | 0 |
| `NEEDS_REVIEW` | Conflict or owner decision remains | 1 |
| `TOOL_GAP` | Required runtime/tool verification is unavailable | 1 |
| `RED_BLOCK` | Safety or integrity check blocked the operation | 2 |

Specific tool-gap codes include `TOOL_GAP_NODE_RUNTIME` and
`TOOL_GAP_OPENCODE_RUNTIME_VERIFICATION`.

## Integrity and provenance

Before installation, OCAE verifies the package `RECORD` and every member of the
bundled payload against its manifest. The canonical installer then records a
source lock for managed runtime files and agent definitions. A changed source
lock, missing payload member, or hash mismatch fails closed.

## Updating and rollback

Update the CLI distribution itself with:

```bash
uv tool upgrade ocae-cli
```

Then update a target project with:

```bash
ocae update .
```

The CLI update and target-project update are separate operations. Rollback is
target-specific:

```bash
ocae rollback . --backup <backup-dir>
```

Rollback restores managed files, detects later edits, and preserves owner files.

## Troubleshooting

### `uv` is not available

Install `uv` using the official method for your operating system, then rerun
the pinned install command. Do not substitute an unpinned package source when
reproducibility matters.

### Node.js is not available

Install a supported Node.js runtime and rerun `ocae doctor .`. The Python CLI
cannot replace the canonical Node installer; this is reported as
`TOOL_GAP_NODE_RUNTIME`.

### OpenCode is not available

Installation can prepare project assets, but `doctor`/`verify` cannot claim
runtime discovery. Install OpenCode or run verification in the target
environment. The result is `TOOL_GAP_OPENCODE_RUNTIME_VERIFICATION`.

### PowerShell blocks `opencode.ps1`

On Windows, PowerShell execution policy may block the shim even when OpenCode is
installed. Run the command from an approved shell or use the executable exposed
by the installation, then rerun `ocae doctor .`. Do not weaken policy globally
just for this check.

### Agent name conflict

An existing target agent with the same name is preserved. Review the reported
conflict and choose an explicit owner resolution; the installer does not
silently replace it.

### Source-lock tamper detection

Stop and inspect the source-lock report. A changed managed file must be
reviewed before update or rollback. Do not delete the lock to force an apply.

### `TOOL_GAP_NODE_RUNTIME`

Node.js could not be resolved from the current process environment. Fix the
runtime or PATH and rerun the command.

### `TOOL_GAP_OPENCODE_RUNTIME_VERIFICATION`

OpenCode could not be resolved or could not list agents. Fix the runtime,
target configuration, or shell invocation and rerun verification.

### `NOOP_IDEMPOTENT`

The target already matches the requested managed state. No new mutation is
required; use `ocae verify .` if you need fresh runtime evidence.

## Windows limitation

`HOST_SYMLINK_CAPABILITY_LIMITATION` indicates that the host cannot create a
required symlink. This is a host capability limitation, not permission to
bypass the installer safety checks.

## Automation compatibility

The [AI bootstrap contract](../AI-BOOTSTRAP.md) and direct Node invocation are
maintained for URL-only automation. They are compatibility paths; the primary
user-facing entry point remains the pinned `ocae-cli` install.
