# OCAE — OpenCode Agent Ecosystem

Status: **Stable / Operational**

OCAE is a URL-installable, governed multi-agent ecosystem for OpenCode. Install
one versioned CLI into an existing project and get 13 specialized agents,
capability profiles, skills, policies, verification, and fail-closed
project-local governance.

## FOR AI AGENTS RECEIVING THIS URL:

If another OpenCode project is already open, the default task is to install OCAE
into that existing project. Capture that workspace before cloning or fetching;
this repository is read-only installation source material. Do not develop OCAE
unless the user explicitly asks for OCAE development. See [AI-BOOTSTRAP.md](AI-BOOTSTRAP.md)
and [`ocae.handoff.json`](ocae.handoff.json).

## Quick install

```bash
uv tool install ocae-cli --from git+https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem.git@v1.0.7
```

Then, from the target project:

```bash
ocae doctor .
ocae install .
ocae verify .
ocae integrate opencode
```

`ocae install . --dry-run` previews the changes. The package requires Python
3.11+, `uv`, and Node.js. OpenCode is required for runtime discovery and agent
verification. The optional `ocae integrate opencode` command installs one
OCAE-owned global OpenCode adapter for bare-URL handoff; it is idempotent and
does not rewrite `opencode.jsonc`.

The stable release is `v1.0.7`, published from commit
`4d6d4586e98e60976e89cb426e77edee35a3bfef`. The install command is pinned to
that release tag; the repository `master` branch may contain documentation
and publication updates after the product release baseline.

## Repository protection and delivery flow

`master` is protected: changes land through pull requests, direct pushes,
force pushes, and branch deletion are denied, and merging requires the
`ocae-required` check (workflow **OCAE Core Gates**) to pass. Protection is
activated via a repository ruleset after `ocae-required` first reports on a
real pull request (see [docs/adr/ADR-master-protection-core-gates.md](docs/adr/ADR-master-protection-core-gates.md)). The gate runs
the canonical test suite, the ecosystem validation (production sentinel), and
the governance drift check — deterministic, without external services at test time, and
without paid provider secrets. Optional capabilities (visual QA, viewport matrices) are not required
merge gates. Emergency owner recovery is an explicit, auditable ruleset change;
there is no silent bypass.

## What is OCAE?

OCAE CLI v1.0.7 is the installable distribution layer for this repository. The
Python CLI validates inputs, package integrity, provenance, and tool preflight.
The canonical governance and installation logic remains in
[`scripts/install-governance.mjs`](scripts/install-governance.mjs), which is
bundled into a hash-verified runtime payload.

An install adds project-local OpenCode assets while preserving existing
configuration and user content:

- 13 OpenCode agents: one primary agent and 12 subagents
- 13 capability profiles bound to those installable agents
- skills, policies, and the Governance Plugin
- MCP preflight and fail-closed capability decisions
- source-lock integrity and provenance
- backup before mutation, rollback, and resume/runtime governance

## Quick start

1. Install the CLI with `uv tool install` above.
2. In an existing project, run `ocae doctor .` and review the preflight.
3. Run `ocae install .`, then `ocae verify .`.
4. Once per machine, run `ocae integrate opencode` to enable bare canonical-URL
   handoff in OpenCode. Use `--verify` to inspect the binding or `--remove` to
   remove only the OCAE-owned adapter.

The installer is idempotent. Existing providers, models, MCP definitions, user
agents, third-party plugins, and project configuration are preserved. Name
conflicts and source-lock tampering fail closed instead of being overwritten.

When the global OCAE adapter sees an ordinary task in an already-installed
OCAE project, it performs a trusted pre-task reconciliation first. Older
compatible project installations are upgraded through the canonical installer
and verified before task bootstrap; current projects take the fast path. A
foreign project is passed through unchanged, while corrupt, newer, or
tampered installations fail closed with a precise classification.

## Agents

The installable inventory is derived from [`.opencode/agents/`](.opencode/agents/)
and is published in the [agent inventory on the landing page](docs/index.html#agents).
The primary agent is `issue-orchestrator`. The inventory also includes
`review-agent`, `security-agent`, `architecture-agent`, `documentation-agent`,
`compliance-agent`, and `executor`, plus the remaining specialized subagents.

Each agent is paired with a capability profile. The runtime sequence is:

```text
Agent → Capability Profile → MCP Preflight → Governance Decision → Tool Execution
```

OpenCode discovery for the released runtime verified 13/13 agents. The governed
canary uses `issue-orchestrator` as the primary agent.

The model harness is intentionally conservative: `generic.v1` is the only
promoted/installable model profile. HY3 candidates were not promoted because
they did not prove value, and Nemotron was rejected for a correctness
regression. Evaluation code and evidence remain development-only.

## Governance and safety

OCAE is project-local and fail-closed. It backs up before mutation, records an
audit trail and source lock, and supports rollback. It preserves existing
configuration, user agents, and third-party plugins. Secrets are not read by
default, and no MCP server is enabled automatically.

OpenCode is the primary verified runtime. Hermes is an optional, non-blocking
runtime adapter; no Hermes deployment is required for the CLI installation.
Playwright visual QA and additional MCP integrations are optional capabilities,
not installation prerequisites. MCP servers remain disabled unless explicitly
enabled by the project owner.

## How it works

```text
uv
 ↓
ocae-cli (Python CLI)
 ↓  hash-verified bundled payload
scripts/install-governance.mjs (canonical installer)
 ↓
Target project → OpenCode agents, skills, policies, plugin, profiles, locks,
                 preflight, provenance, backup and rollback
```

The Python layer does not reimplement governance decisions. It delegates to the
canonical Node installer from the pinned payload.

## CLI reference

| Command | Purpose |
| --- | --- |
| `ocae --version` | Print the installed CLI version |
| `ocae version` | Print version information; add `--json` for machine output |
| `ocae provenance` | Show source ref, commit, and payload provenance |
| `ocae doctor .` | Run package, Node, OpenCode, and target preflight |
| `ocae install .` | Install into a target project |
| `ocae install . --dry-run` | Preview installation without writes |
| `ocae verify .` | Verify installation and OpenCode agent discovery |
| `ocae update .` | Update an existing managed installation |
| `ocae rollback . --backup <backup>` | Restore from a recorded backup |
| `ocae integrate opencode` | Install and verify the global bare-URL adapter |
| `ocae integrate opencode --verify` | Verify the global adapter binding |
| `ocae integrate opencode --remove` | Remove only the OCAE global adapter |

See the complete [CLI reference](docs/ocae-cli.md).

## Requirements

- Python >= 3.11
- [uv](https://docs.astral.sh/uv/)
- Node.js for the canonical installer
- OpenCode for runtime discovery and governed agent execution

With no provider credentials configured, installation still prepares the core
and reports `CORE_READY` with `PROVIDER_NOT_CONFIGURED`; that is not an
installation failure.

## Updating and rollback

Update the CLI with:

```bash
uv tool upgrade ocae-cli
```

Then update a target project with `ocae update .`. The installer checks
provenance and managed-file state before changing it. To restore a backup, use
`ocae rollback . --backup <backup>` with the path reported by the installer.

## Documentation

- [OCAE CLI reference](docs/ocae-cli.md) — current installation, commands, troubleshooting, and rollback
- [AI bootstrap path](AI-BOOTSTRAP.md) — automation and URL-only compatibility contract
- [AI install contract](AI-INSTALL.md) — automation-specific governance details
- [Bootstrap background](BOOTSTRAP.md) — legacy/manual architecture reference
- [Working method](WORKING-METHOD.md) — governance and engineering method
- [`docs/architecture/`](docs/architecture/) — architecture and ADR material
- [`docs/specs/`](docs/specs/) — specifications and verification contracts
- [`docs/reports/`](docs/reports/) — historical evidence and run reports
- [`docs/evaluation/`](docs/evaluation/) — frozen harness evidence and the
  final no-promotion decision
- [GitHub Pages landing page](https://xxammaxx.github.io/OpenCode-Agenten-Oekosystem/)

## Known limitations

On hosts that cannot create the required symlink shape, installation may report
`HOST_SYMLINK_CAPABILITY_LIMITATION`. This is a host capability limitation;
the installer remains fail-closed and reports the exact affected operation.

Model-specific optimization is not part of the stable product: no candidate
profile is promoted. OpenCode version compatibility follows the supported range
documented in the [CLI reference](docs/ocae-cli.md). Hermes and optional MCP
capabilities require their own host tooling and credentials.

## License

OCAE is available under the [MIT License](LICENSE).

## Automation path

AI and automation callers may use the [AI bootstrap contract](AI-BOOTSTRAP.md)
or invoke the bundled canonical Node installer directly. Those paths are
compatibility/automation interfaces; the primary human entry point is the
versioned `ocae-cli` workflow above.

For AI-assisted installation into another project, start with AI-BOOTSTRAP.md.
Do not invent raw URLs or example paths. Never read target project secret files.
