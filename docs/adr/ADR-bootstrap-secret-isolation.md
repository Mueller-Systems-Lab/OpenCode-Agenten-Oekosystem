# ADR: Isolate URL-only Bootstrap Models from Target Secrets

## Status

Accepted for implementation on the explicitly authorized security-closure
branch. Completion remains blocked until the verification contract passes.

## Context

An adversarial test model used OpenCode's built-in `read` tool to open a target
`.env`. The existing contract prohibited the action but did not remove the
capability. A later permission-based retry prevented the read but exposed an
unusable tool surface and failed to recover.

## Decision

Use a brokered, typed bootstrap protocol with two independent Bubblewrap
boundaries:

1. The OpenCode model process runs with deny-all permissions except the typed
   bootstrap MCP tools. Its namespace contains a dedicated temporary home and
   work directory, but no target, source worktree, host home, or host
   credentials.
2. Each deterministic bootstrap action runs separately with a read-only source,
   a target view appropriate to the action, secret paths masked by unreadable
   read-only mounts, target Git metadata hidden, a clean environment, and no
   network.

A central broker owns capability state, safe target inspection, path policy,
result egress, audit attribution, denial deduplication, and lifecycle ordering.

## Alternatives

### Prompt and documentation rules

Rejected. The incident proves that model compliance is not a security boundary.

### OpenCode `.env` read deny rules only

Rejected. They do not close shell, Git, interpreter, archive, symlink, process
environment, target plugin, or unknown MCP paths.

### Filename denylist plus redaction

Rejected as the primary control. It cannot reliably identify copied or aliased
secrets and acts too late after content has already been opened.

### Generic shell inside a target-mounted model sandbox

Rejected. Command filtering is not a complete interpreter or filesystem
security boundary.

### Container image

Viable but not selected for the default because Bubblewrap and unprivileged user
namespaces are already available, avoid an image dependency, and permit a
smaller runtime surface. Container execution remains a future equivalent
backend if it meets the same contract.

### Typed wrappers without an OS boundary

Rejected as the sole design. A tool registration or permission regression would
immediately restore host-level access.

## Dependency Impact

- Requires Linux Bubblewrap for live secure-model and deterministic sandbox
  execution.
- Uses only Node.js standard library for policy, broker, MCP, audit, and tests.
- Retains the existing installer and verifier as deterministic inner programs.
- Does not add npm dependencies, services, privileged users, Docker access, or
  production configuration.

## Coupling

- OpenCode coupling is restricted to documented permission configuration, CLI
  `run`, and remote MCP transport.
- Installer/verifier coupling is restricted to their JSON CLI contracts.
- Security policy modules remain independently unit-testable without OpenCode,
  Bubblewrap, a provider, or network access.
- The broker never imports target code or target OpenCode configuration.

## Consequences

- Bootstrap AI runs fail closed with `TOOL_GAP_SECURE_SANDBOX` when Bubblewrap
  or required namespace support is absent.
- Provider network remains available only to the model namespace; deterministic
  target actions have no network.
- Model-visible results are smaller and structured.
- A denied secret read can recover without expanding capabilities.
