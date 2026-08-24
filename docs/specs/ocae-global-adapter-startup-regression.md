# OCAE Global Adapter Startup Regression — v1.0.4

## Goal

Repair the global OpenCode adapter regression shipped in v1.0.3 without
changing the existing-installation migration behavior delivered by PR #29.
OpenCode must load the adapter in a no-project workspace and remain usable.

## Scope

- Export exactly one OpenCode plugin factory from the global adapter module.
- Accept only absolute string `directory` or `worktree` context values before
  resolving a project target; invalid context blocks fail closed.
- Perform no project discovery, migration, or filesystem target work while the
  plugin factory is loading.
- Require a real no-project OpenCode startup smoke after installation.
- Restore the previous adapter and manifest atomically when verification fails.
- Keep v1.0.3 immutable and publish v1.0.4 only from the verified merged
  `master` commit.

## Acceptance criteria

1. `node --check` passes for the adapter.
2. The adapter module namespace contains only `default`, and the default is a
   callable OpenCode plugin factory.
3. Factory invocation returns `chat.message` without resolving a project.
4. Invalid object-valued OpenCode target context returns
   `RED_BLOCK_TARGET_UNCLEAR` without throwing.
5. Existing-installation Old → Current → First-Task migration tests pass.
6. Integration verification starts OpenCode from a temporary project-free
   directory and rejects early runtime failure.
7. Failed verification leaves the previous integration state unchanged.
8. A real Windows v1.0.4 installation from the immutable release tag passes
   integration verification and one end-to-end startup/handoff canary.

## Verification evidence

The focused Node and Python regression tests cover the export contract, target
validation, migration compatibility, runtime smoke result handling, and
atomic rollback. The real Windows startup and release-tag E2E checks are run
after the squash merge and before the v1.0.4 release is declared verified.
