# Local Completion Runtime

This document describes the small runtime closure layer added to the current
`master` branch. It does not claim a live Hermes or CT108 installation.

## Agent capability profiles

The canonical source is `ecosystem.manifest.json` under
`catalogs.agents.profiles`. Every repository agent has one profile. Profiles
use default-deny semantics and declare tools, operations, paths, trust tier,
network/egress policy, version constraints, authentication requirements,
timeout, and the fail-closed preflight policy. Credentials are never stored in
the manifest.

## Mandatory MCP preflight

`scripts/lib/mcp-preflight.mjs` performs server discovery, MCP initialize and
`tools/list` discovery for configured local commands, then validates required
and optional capabilities. Required failures return
`FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT` and do not permit task execution.
Optional failures return `DEGRADED_OPTIONAL_MCP_CAPABILITY` and remain usable
only when the task can continue safely.

`runtime/agent/start.mjs` is the agent start boundary. It loads the profile,
performs the preflight through the resumable run executor, and refuses a
missing or invalid profile. A preflight fingerprint includes the profile,
inventory, and configuration hash; changed configuration cannot reuse the old
result.

## Restart and resume

`runtime/agent/run-state.mjs` stores an atomically replaced JSON state file.
It includes repository, task, agent execution, completed/pending steps,
blockers, evidence, gate, profile hash, and MCP fingerprint fields. A lock
file serializes parallel starts. Repository, profile, preflight, corruption,
and interrupted-step drift are conservative reconciliation conditions rather
than automatic continuation.

## Observability

`runtime/observability/events.mjs` writes bounded JSONL governance events for
agent start/resume, preflight, task, and policy outcomes. It keeps
project-specific attributes separate from official telemetry namespaces and
does not accept prompt or tool-output fields.

## Scope boundary

This project covers agent orchestration, capability profiles, MCP and
mandatory preflight, policy/tool governance, trust tiers, skills, runtime
security, Hermes integration, restart/resume, evidence, observability,
evaluation, bootstrap, governance, and runtime closure.

Text-to-speech, speech synthesis, audio narration, prompt read-aloud, voice UI,
and speech output are explicitly outside this project's scope. They are not
production components, capabilities, runtime hooks, observability events,
completion gates, or owner actions.

## Verification entry points

The focused contract suite is:

```text
node --test test/contracts/completion-runtime-contracts.test.mjs
```

The complete project gates remain:

```text
node scripts/run-tests.mjs --all --reporter dot
node scripts/validate-ecosystem.mjs
```

The separate [Hermes CT108 runtime closure package](../run-cards/hermes-ct108-runtime-closure-package.md)
must be executed from the authorized network before any production runtime
classification is made.
