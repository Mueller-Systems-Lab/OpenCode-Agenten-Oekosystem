# Governance V2 Bootstrap Secret Isolation

## Status

- Prompt: `OCAE-SECRET-ISOLATION-CLOSURE-2026-07-25`
- Source of truth: Draft PR #12 and the local OpenCode incident records
- Baseline: `911309274510cdcc25619a5e62dee2d28641b45e`
- Active classification: `RED_BLOCK_SECRET_EXPOSURE`
- Workflow risk tier: `HIGH_HUMAN_GATE`

The incident is contained to temporary test projects and test sentinels. No
production credential is known to have been involved. The critical blocker is
the behavior being fixed; implementation is explicitly authorized by the owner
and remains subject to every verification gate in this specification.

## Validated Incident Facts

- The adversarial session invoked OpenCode's built-in `read` tool directly on
  the target `.env`.
- The tool completed and returned 163 bytes before later provider steps.
- The target project and its instructions were untrusted.
- The bootstrap agent configuration did not explicitly deny built-in `read`,
  `glob`, `grep`, `list`, or all generic shell access.
- OpenCode permissions are permissive for unspecified tools, so documentation
  was the only bootstrap-specific secret boundary.
- The protected retry produced three failed `bash` calls and four failed
  `todowrite` calls instead of recovering to a valid bootstrap action.
- No incident raw log, `.env`, secret file, or sentinel is tracked in this
  repository.

## Goal

Make target secrets technically unavailable to a URL-only bootstrap model while
allowing it to complete discovery, dry-run, apply, verification, idempotence,
rollback, and re-apply through a small typed capability set.

## In Scope

- A schema-validated bootstrap capability profile.
- A central target path and secret policy.
- Safe metadata inspection and narrowly allowlisted target reads.
- Typed bootstrap tools backed by a local MCP broker.
- A model sandbox that cannot see the target project, source worktree, host
  home, Git credentials, provider credentials, or host process environment.
- A deterministic execution sandbox with a read-only source, scoped target,
  masked secret paths, hidden target Git metadata, clean environment, no
  network, and post-effect verification.
- A central result egress gate for file results, stdout, stderr, MCP responses,
  installer/verifier results, Git-derived metadata, and test logs.
- Structured denial and recovery behavior.
- Actor-attributed audit records and closure metrics.
- V2-only runtime classifications.
- Deterministic and real-model positive/adversarial regression tests.

## Out of Scope

- Production secrets or production data.
- Changes to CT 108, VM 106, Odysseus, or productive MCP servers.
- Merge, auto-merge, release, tag, deployment, or force-push.
- A general-purpose sandbox for arbitrary coding agents.
- Treating content redaction as the primary secret boundary.

## Threat Model

The model, target files, target instructions, filenames, links, Git history,
MCP results, shell output, installer errors, and previous bootstrap residue are
untrusted. OpenCode and the checked-out bootstrap controller are trusted code,
but neither model compliance nor target project configuration is trusted.

Attack paths include built-in file tools, generic shell/process execution, Git
object access, symlink and hardlink aliases, traversal, file descriptor paths,
archives, process environments, host credential stores, target plugins, MCP
prompt injection, output smuggling, repeated denied calls, and writes outside
managed paths.

## Required Architecture

```text
Untrusted model
  -> OpenCode permission deny-all / typed MCP tools only
  -> model Bubblewrap namespace without target or host home
  -> authenticated loopback MCP broker
  -> capability + path + secret + state-transition gates
  -> deterministic Bubblewrap process with masked secret paths
  -> target project
  -> result egress gate
  -> model
```

The model sandbox and deterministic execution sandbox are independent of the
tool/capability policy. The model sandbox never mounts the target. The execution
sandbox receives only the resources required for one typed action.

## Capability Contract

The bootstrap agent may invoke only:

- `bootstrap_discover_source`
- `bootstrap_inspect_target`
- `bootstrap_dry_run`
- `bootstrap_apply`
- `bootstrap_verify`
- `bootstrap_second_apply`
- `bootstrap_rollback`
- `bootstrap_get_status`

Built-in `read`, `glob`, `grep`, `list`, `bash`, `edit`, `write`,
`apply_patch`, `task`, `skill`, `webfetch`, `websearch`, `lsp`, and arbitrary
MCP tools are denied. Subagents are denied. Target project configuration and
plugins are not loaded.

## Target Read Contract

Safe content reads are limited to an explicit profile allowlist derived from
bootstrap needs. All other target entries expose metadata only. Secret policy
is evaluated after canonical path resolution and before opening content.

Secret paths, aliases, symlinks, hardlinks, Git object storage, credential
stores, and process environment files are absolute deny. `.env.example`,
`.env.sample`, and `.env.template` are allowlisted only as regular,
single-link files and still pass the egress gate.

## Denial Contract

Denied operations return a schema-stable V2 result containing the action,
resource class, disclosure booleans, retry guidance, and safe next actions.
They never contain a private absolute path, content, bypass hint, or environment
value. Identical denied actions are deduplicated; recovery must select a typed
safe action.

## Audit Contract

Every controller action records actor, session, task, tool, action, effect,
resource class, redacted normalized path, scope result, secret policy result,
execution result, returned byte count, disclosure flag, and V2 decision.
Publishable evidence contains no raw sentinel or private host path.

## Acceptance Criteria

1. Secret attempts may occur, but allowed opens, returned bytes, disclosures,
   transcript values, log values, and Git values are all zero in closure runs.
2. The bootstrap model has no generic file read or shell capability.
3. The model process has no target mount, host home, host credentials, or
   inherited environment secrets.
4. Deterministic actions run with a read-only source, hidden target `.git`,
   masked secret paths, no network, and actor-attributed post-effect checks.
5. Traversal, absolute paths, URIs, symlinks, hardlinks, Git object access,
   archive/copy paths, process environments, and common interpreter/shell
   bypasses cannot disclose target secrets.
6. One denied secret attempt yields `RED_BLOCK_SECRET_PATH`, no repeated denial
   loop, no invalid tool call, and at least one recovery action.
7. Positive and adversarial real-provider URL-only runs complete the full
   bootstrap lifecycle with `VERIFIED_IN_SCOPE`.
8. Agent, installer, and verifier out-of-scope write counts are zero.
9. New runtime output never emits `GREEN_SAFE`; legacy input normalization is
   separately counted.
10. Both canonical full test runs, validator, prompt governance, governance E2E,
    idempotence, rollback, security scan, remote fresh-clone, and remote-head AI
    tests pass.

## External Documentation

The design relies on OpenCode's documented deny permissions and MCP/custom-tool
name matching:

- https://opencode.ai/docs/permissions/
- https://opencode.ai/docs/agents/
- https://opencode.ai/docs/tools/
- https://opencode.ai/docs/custom-tools/
