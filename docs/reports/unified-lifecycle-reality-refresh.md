# Unified Lifecycle Reality Refresh

Scope: repository state at `595df52e9bcc16e12c88f8fcada6ea71fd10934b`, before
the unified-lifecycle working-tree changes. This report records source
ownership rather than relying on prior reports.

| Statement | Canonical source | Other copies | Drift risk | Action |
| --- | --- | --- | --- | --- |
| URL-only handoff | `AI-BOOTSTRAP.md` | `README.md`, `BOOTSTRAP.md` | high | Direct all new lifecycle commands to `scripts/ocae.mjs` after checkout. |
| Legacy overlay install | `scripts/bootstrap-project.mjs` | README/BOOTSTRAP examples | high | Keep component compatibility; orchestrate it only for a missing overlay. |
| Governance V2 install | `scripts/install-governance.mjs` | `bootstrap.mjs`, AI contract | medium | Keep source lock, hash, conflict, backup, and rollback ownership in V2. |
| Structural V2 verification | `bootstrap/verify.mjs` | installer post-validation | medium | Treat as integrity evidence, not hook-invocation evidence. |
| Runtime launch/evaluation | `scripts/run-governed-opencode.mjs` and runtime adapters | reports/docs | high | Separate direct evaluator tests from an actual runtime proof. |
| Main classification | `scripts/lib/gates/classifications.mjs` | manifests and docs | medium | Preserve its four public classifications; attach lifecycle substatus. |
| Installation provenance | `.opencode/ecosystem-installation.json` | `.agent-governance/source-lock.json` | medium | Consume read-only in lifecycle discovery. |

## Resolved operational questions

1. Before this change, URL-only installation was canonically handed off through
   `AI-BOOTSTRAP.md`, with `bootstrap.mjs` delegating to Governance V2.
2. `bootstrap-project.mjs` is the overlay/bootstrap component for OpenCode/Hermes
   project assets and reports.
3. `install-governance.mjs` owns Governance V2 runtime, policies, source lock,
   manifest, bridges, V2 backup, and rollback.
4. A target could need both components, but no prior single lifecycle selected
   or proved their combined state.
5. The components have separate conflict and ownership paths; V2 is hash and
   provenance aware, while the overlay has its own conservative merge path.
6. Existing reports and direct evaluator commands can establish structural or
   adapter evidence, but not by themselves an active post-restart runtime hook.
7. Direct launchers, alternative CLI paths, runtime configs, plugins, shell and
   subprocess paths, MCP paths, old adapters, and direct runtime imports remain
   bypass surfaces requiring dynamic review.
8. A hook file being present, plugin auto-discovery being documented, and a
   direct evaluator returning a block are documented/structural claims unless a
   runtime invocation produces scoped evidence.

## Evidence boundary

This durable report intentionally excludes run-specific process inventories,
profile paths, temporary roots, runtime logs, receipt material, and
time-bound activation evidence. Runtime activation and restart claims require
fresh isolated proofs validated against the versioned governance schemas.
