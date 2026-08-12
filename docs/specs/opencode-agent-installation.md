# OpenCode Agent Installation Verification Contract

## Desired Behavior

The URL-only installer installs the repository's runtime-installable OpenCode agent definitions, active skills, policies, governance plugin, and capability-profile provenance into a fresh target. OpenCode must discover the installed agents from the target at runtime without manual edits.

## Acceptance Criteria

1. Every active `.opencode/agents/*.md` source definition is installed unless an identical or user-owned target definition already exists.
2. Existing OpenCode configuration, user agents, skills, policies, MCPs, providers, and models are preserved through safe merge and conflict classification.
3. Installation provenance records installed agents, source commit/repository, managed files, and capability-profile bindings; source lock hashes the source and installed agent definitions.
4. A second apply is `NOOP_IDEMPOTENT`; rollback restores the pre-installation target and removes newly managed assets.
5. OpenCode 1.18.16 discovers the expected agent IDs from the fresh target, and at least one read-only Ecosystem subagent can be invoked.
6. Governance capability mapping, skill access, MCP preflight, allow/deny, early-deny audit, and fail-closed behavior remain intact.
7. No TTS component or CT108 dependency is introduced.

## Red Tests

1. `test/install/agent-installation.test.mjs`: a fresh target after current-master apply has no runtime-discoverable Ecosystem agents.
2. The same contract asserts the expected agent files and OpenCode configuration are absent before the fix and present after it.

## Regression Tests

1. Existing URL-only installer, rollback, source-lock, tamper, runtime-hardening, and resident-runtime tests.
2. Governance runtime, early-deny audit, and full canonical test manifest.

## Reality Gate

Run the canonical installer against a new target, execute `opencode agent list` from that target, parse the runtime output, and invoke a read-only Ecosystem subagent from that same target.

## Evidence Types

| Evidence Type | Source | How Collected |
|---|---|---|
| Red/green test output | Node test runner | Focused installer and runtime contract tests |
| Runtime discovery | OpenCode 1.18.16 | `opencode agent list` from the fresh target |
| Invocation log | OpenCode 1.18.16 | Read-only subagent canary with exit code and output |
| Provenance and integrity | Target manifests | Installation manifest and source-lock hashes |
| Regression output | Repository scripts | Focused suite, full suite, validator, and drift checks |
| Diff scope | Git | `git diff --stat` and reviewed patch |

## Untestable Assumptions

| Assumption | Why Untestable | Risk if Wrong |
|---|---|---|
| Provider/model availability for the live canary | It depends on configured external credentials and model service state | Runtime invocation may be a tool gap even when discovery is valid |
| Third-party MCP server behavior | MCPs are external and remain disabled unless configured | Required MCP can fail closed, which is the intended safe result |

## Completion Claim Gate

- [ ] All acceptance criteria met
- [ ] Red tests passing
- [ ] Regression tests passing
- [ ] Runtime discovery and invocation reality gate passed
- [ ] Evidence collected
- [ ] Independent verifier passed
- [ ] Final default-branch fresh clone passed
