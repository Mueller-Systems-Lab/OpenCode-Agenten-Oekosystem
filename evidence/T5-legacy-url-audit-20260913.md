# T5 Legacy policy and canonical URL drift — read-only audit (2026-09-13)

Scope: executable runtime logic only (`scripts/`, `runtime/`, `src/`, `bootstrap/`,
`build_backend.py`, adapters, installers). Historical docs/evidence may retain the old
identity; runtime must not. No files edited. Canonical identity:
`https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem`.

Method: repo-wide grep for `xxammaxx/OpenCode-Agenten-Oekosystem`,
`.config/opencode/skills/coordinate-blackboard-swarm`, `Non-Touch|Push Gate|
Requires explicit human approval`, and `approval|owner_approve` scoped to runtime dirs;
cross-checked against `governance/policy-core.yaml` (effect-based V2, `git.push =
C_BUNDLED_OWNER_DECISION`, scopes replace broad Non-Touch blocking).

## Area 1 — stale repository identity `xxammaxx/OpenCode-Agenten-Oekosystem`

Runtime (`scripts/`, `runtime/`, `src/`, `bootstrap/`, `build_backend.py`): **zero matches — CLEAN**.
Canonical identity confirmed in `build_backend.py:18`, `bootstrap/lib/contract.mjs:5`,
`bootstrap/manifest.json:5,22`, `src/ocae_cli/_adapter/opencode-handoff.js:8`,
`src/ocae_cli/opencode.py:387`, `scripts/install-governance.mjs:2192` (fallback to canonical).

| file | line | snippet (truncated) | verdict |
|---|---|---|---|
| test/bootstrap/existing-installation-automigration.test.mjs | 67 | `OCAE_BOOTSTRAP_SOURCE_REPOSITORY: "https://github.com/xxammaxx/..."` | HISTORICAL-FIXTURE — intentional old-source migration fixture; asserts old install migrates to canonical. Not runtime drift. Advisory: add code comment marking it intentional. |
| evidence/budget-lifecycle-multiprocess-reality-20260821T130109Z/fresh-install-sentinel-final-state.txt | 92 | `"source_repository":"https://github.com/xxammaxx/..."` in stdout_tail | HISTORICAL-LOG — frozen 2026-08-21 run output. Do not rewrite evidence. |
| evidence/budget-lifecycle-multiprocess-reality-20260821T130109Z/fresh-install-sentinel-pre-change.txt | 92 | same as above | HISTORICAL-LOG |
| evidence/pr7-remediation-20260721T143600Z/06-post-fix-installer.txt | 2 | `"source_repository":"https://github.com/xxammaxx/..."` | HISTORICAL-LOG |
| evidence/pr7-remediation-20260721T143600Z/01-pre-fix-installer.txt | 2 | same | HISTORICAL-LOG |
| docs/evaluation/issue-33-final-summary.md | 19,20 | PR links `.../xxammaxx/.../pull/34,35` | HISTORICAL-DOC |
| docs/run-cards/pr7-remediation-model-assurance-run-card.md | 30 | PR #7 `.../xxammaxx/.../pull/7` | HISTORICAL-DOC |
| docs/plans/ocae-product-realignment-plan.md | 23 | canonical source URL stated as `https://github.com/xxammaxx/...` | HISTORICAL-DOC — plan predates canonical transfer; superseded by `bootstrap/manifest.json` + `build_backend.py:18`. Advisory doc refresh only. |
| docs/reports/governance-v2-remote-refresh.md | 7 | `gh api repos/xxammaxx/...` | HISTORICAL-DOC |
| docs/reports/spec-kit-integration-final-report.md | 38 | `Repository: https://github.com/xxammaxx/...` | HISTORICAL-DOC |
| docs/reports/final-project-closure.md | 55,59 | release + `uv tool install ... xxammaxx ... @v1.0.7` | HISTORICAL-DOC — release-time URL; current README/AI-INSTALL already canonical. |
| docs/reports/runtime-hardening-compliance-review.md | 150,168,169 | discusses `https://github.com/xxammaxx/....git` as PII-02 finding | HISTORICAL-DOC (meta-discussion, not an endorsement) |
| docs/reports/url-installer-runtime-enforcement-compliance-review.md | 87 | example `https://github.com/xxammaxx/...` | HISTORICAL-DOC (example string) |
| docs/reports/canonical-working-method-run-report.md | 10 | Issue link `.../xxammaxx/.../issues/2` | HISTORICAL-DOC |

## Area 2 — legacy `git push *` human-gate / Non-Touch contradictions

Runtime: **CLEAN — V2 scopes only, no legacy blocking**.
`scripts/` uses `write_scope`/`forbidden_scope` (`install-governance.mjs:483,1956`,
`bootstrap-project.mjs:222-223`, `apply-repository-overlay.mjs:96-97`);
`runtime/gates/evaluate-action.mjs:79-84`, `runtime/approval/*`, `runtime/bootstrap/task-bootstrap.mjs:87-88,187-191`
enforce capsule scopes. `governance/policy-core.yaml:37` = `git.push → C_BUNDLED_OWNER_DECISION`
(effect-based, bundled, revocable) — not a blanket deny. `WORKING-METHOD.md:354-387`
explicitly states V2 scopes replace Non-Touch and legacy entries are migration input only — no contradiction.

| file | line | snippet | verdict |
|---|---|---|---|
| docs/architecture/canonical-working-method.md | 132-134,162-174 (170) | `Push Gate \| git push to any remote \| Deny \| Requires explicit human approval at all tiers`; 9-gate table; `Non-Touch Areas` re-injection list | HISTORICAL-DOC — architecture note predates V2; superseded by `governance/policy-core.yaml`. Advisory doc refresh only; NOT executed by runtime. |
| .opencode/skills/run-card/SKILL.md | 30 | template row `Non-Touch Areas \| Files/directories that must not be touched` | TEMPLATE-LABEL — coexists with V2 `Out of Scope`/`Hard Constraints` rows; `WORKING-METHOD.md:354` declares Non-Touch migration-input only. Advisory: rename row to `Forbidden scope` for consistency. Not a runtime override. |
| docs/migration/governance-v1-to-v2.md | 6 | `Replace Non-Touch checks with read/write/forbidden/external scopes` | CANONICAL-MIGRATION-NOTE — PASS, aligns with V2. |
| WORKING-METHOD.md | 354,387 | `Scope Model (V2; replaces Non-Touch Areas)`; `Legacy Non-Touch entries are migration input only` | CANONICAL — PASS. |

## Area 3 — duplicate approval rules that could override Governance V2

Runtime: **CLEAN — no override**. Single authority: `runtime/approval/approval-engine.mjs`,
`approval-receipt.mjs`, `change-lease.mjs`, `approval-bundler.mjs` + `governance/policy-core.yaml`
+ `governance/generated/capability-registry.json`.

| file | line | snippet | verdict |
|---|---|---|---|
| scripts/lib/runtimes/hermes.mjs | 12-13,82-83,139-144,185-216,249 | `skills.write_approval` / `memory.write_approval` / `/yolo` detection + warnings | SCOPED-ADVISORY — external-runtime (Hermes) config lint only; does not grant/override OCAE effects. PASS. |
| scripts/lib/runtimes/odysseus.mjs | 19-26,153,254-289,476-502 | `mcp_tier_2_approval ... gate: human`, docker/ssh/email approvals | SCOPED-ADVISORY — Odysseus integration approval hints; separate external tool, no Governance V2 override. PASS. |
| scripts/lib/runtimes/generic.mjs | 82 | `all privileged operations require explicit approval` | SCOPED-ADVISORY — generic external-runtime caution. PASS. |
| bootstrap/manifest.json + manifest.schema.json + lib/contract.mjs | 67 / 118 / 140 | `approval_model: effect-based` (const-enforced) | CANONICAL — PASS. |
| scripts/lib/gates/*, scripts/install-governance.mjs approval-receipt handling | various | receipt load/validate/consume | CANONICAL-V2 — PASS (delegates to runtime engine). |

## Area 4 — hardcoded `$HOME/.config/opencode/skills/coordinate-blackboard-swarm` dependencies

| file | line | snippet | verdict |
|---|---|---|---|
| .agents/skills/coordinate-blackboard-swarm/adapters/opencode/swarm.ts | 5 | ``const skillRoot = `${process.env.HOME}/.config/opencode/skills/coordinate-blackboard-swarm` `` | RUNTIME — hard dependency on `$HOME`-anchored install path; contradicts skill contract "resolve `scripts/blackboard.py` relative to SKILL.md". Uses env (not a user-home literal) so low severity, but breaks portable/relocated checkouts and custom skill dirs. Only runtime hit in scope. **Needs relative-resolution fix (advisory, non-blocking for this audit).** |
| evidence/opencode-local-installation.md | 13 | `SKILL_INSTALL_PATH=$HOME/.config/...` | HISTORICAL-LOG — install trace. Ignore. |
| scripts/, runtime/, src/, bootstrap/ (excl. above adapter) | — | zero matches | CLEAN. |

## Overall

- Areas 1–3 runtime: **CLEAN (PASS)**. Stale URLs and push-gate/Non-Touch language survive only in frozen evidence, historical docs/reports, one intentional migration-test fixture, and template labels — none executed by runtime.
- Area 4 runtime: **one narrow portability hit** (`swarm.ts:5` absolute `$HOME` skill path). Hence overall audit **FAIL (narrow, advisory)** — not a canonical-URL drift, strictly an adapter path-resolution hardening item.
- No writes performed except this file. No commits/pushes.
