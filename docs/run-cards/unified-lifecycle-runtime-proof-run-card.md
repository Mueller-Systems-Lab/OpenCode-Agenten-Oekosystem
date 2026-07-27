# Run Card: Unified Lifecycle

## Goal

Unify lifecycle operation while producing honest runtime-activation and
multi-project status evidence.

## Why necessary

The overlay bootstrap, Governance V2 installer, and runtime launcher currently
have separate ownership and verification paths; structural hook files can be
mistaken for active enforcement.

## Risk Tier and context

- Risk Tier: `HIGH_HUMAN_GATE` (runtime enforcement, local project metadata,
  security-sensitive path and approval semantics)
- Context: `HOT` after owner approval in this session
- Source of truth: [Issue #16](https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem/issues/16)

## Scope

New lifecycle modules, proof/registry/metrics schemas, targeted installer
integration, tests, docs, and validation listed in the implementation plan.

## Out of scope and non-touch areas

All other paths, specifically `.github/`, `.opencode/policies/`, secrets,
global configurations, existing user worktrees, remote infrastructure, commit,
push, PR, merge, deployment, skill write, and memory write.

## Constraints

No secrets or `.env` contents; no production runtime; no global config; no
silent overwrite; no fake runtime claim; local-only metrics; explicit tool gaps.

## Security assessment — completed before compliance screening

The primary risks are path or symlink escape during target and registry access,
overwriting owner content while composing the two installers, forged or replayed
approval receipts, a structural hook being reported as active, and accidental
disclosure through evidence. The implementation therefore has to use the
existing path-safety, provenance, backup, hashing, and redaction primitives
where applicable; reject symlinks and special files; redact bounded subprocess
evidence; keep registry writes local and locked; and classify unexercised
runtime paths as `TOOL_GAP` or `NEEDS_REVIEW`. It may not invoke a dangerous
action, a productive runtime, or a global configuration to obtain evidence.

## Compliance and data-minimisation screening — after security assessment

The registry separates portable identity from a local machine reference, and
the metrics format contains only operational counters, timestamps, identifiers,
classifications, and evidence paths. It excludes prompts, secrets, complete tool
output, and network transmission. Metrics remain local, schema-validated, and
disableable. This is a scope-limited data-minimisation assessment, not a claim
of legal or DSGVO compliance for a target project.

## Involved roles

Issue orchestration, implementation, security review, compliance screening, and
read-only review at the later review gate.

## Verification Contract

See `docs/verification/unified-lifecycle-runtime-proof-contract.md`.

## Test matrix

Unit, schema/contract, legacy compatibility, integration, adversarial,
concurrent registry, fresh-clone, spaced path, custom temporary root, isolated
runtime, and two complete canonical runs.

## Evidence and rollback

Record bounded local command output and generated proof documents. Code rollback
is a later normal revert; target rollback delegates to existing backup manifests.

## Approval states

| Gate | State |
| --- | --- |
| Apply | APPROVED — scoped local implementation |
| Commit | NOT_REQUESTED |
| Push | NOT_REQUESTED |
| PR | NOT_REQUESTED |
| Merge | NOT_REQUESTED |
| Deploy | NOT_REQUESTED |
| Remote CI | NOT_REQUESTED |
| Skill write | NOT_REQUESTED |
| Memory write | NOT_REQUESTED |

## Expected classification

`NEEDS_REVIEW` until real-runtime evidence is evaluated; no outcome may imply
that a production or owner runtime was tested.
