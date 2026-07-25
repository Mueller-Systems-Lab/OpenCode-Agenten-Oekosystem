# Governance V2 Validation Report

This report is generated from the local isolated worktree. It must be refreshed after each material runtime change. The baseline was the clean tree at `fe91a8670448a23359d0ccfc2d29ad20369a32ff`; the original worktree contained unrelated untracked changes and was not modified.

## Recorded validation

* Base SHA: `fe91a8670448a23359d0ccfc2d29ad20369a32ff`
* Isolated branch: `feat/governance-v2-minimal-consent-20260724`
* Node: `v22.22.0`; npm `10.9.4`; Python `3.12.3`; Git `2.43.0`
* Baseline suite: 459 tests, 53 suites, 459 pass, 0 fail, 4.575 s
* Governance V2 suite: 491 tests, 53 suites, 491 pass, 0 fail, 3.416 s
* Second complete suite: exit 0 with the dot reporter
* `node scripts/generate-governance.mjs --check`: exit 0
* `node scripts/check-governance-drift.mjs`: exit 0
* `node scripts/validate-ecosystem.mjs`: `VERIFIED_IN_SCOPE`, exit 0
* `node scripts/run-governance-e2e.mjs`: exit 0; dry-run, intent/capsule load, lease inheritance, restart receipt, revocation, fail-closed unknown effect, and rollback all passed.

## Prompt and approval metrics

* Baseline permanent instruction inventory: 12,360 words across the V1 instruction set.
* V2 permanent kernel: 108 words (the evaluator's deterministic token proxy); the kernel contains exactly eight durable rules.
* The 30-scenario deterministic evaluator reports V2 duplicate requests `0`, serial approvals `0`, unnecessary escalations `0`, one bundled owner round, and zero routine owner interruptions.

## Known unchecked areas

* The existing V1 gate CLIs and their adapters retain `GREEN_SAFE` as a compatibility output. New V2 policy/runtime paths emit `VERIFIED_IN_SCOPE`; a later migration must replace the legacy internal constants without breaking existing consumers.
* No live OpenCode, Hermes, Odysseus, MCP provider, merge, deployment, or production execution was exercised. The V2 engine, capability registry, installer surface, deterministic harness, and temporary-project E2E were exercised locally.

The deterministic prompt evaluator is `scripts/evaluate-prompt-governance.mjs`; the temporary-project E2E is `scripts/run-governance-e2e.mjs`. No external provider, MCP, merge, deployment, or production data was used.
