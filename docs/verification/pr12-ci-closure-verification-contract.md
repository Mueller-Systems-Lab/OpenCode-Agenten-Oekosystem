# PR 12 CI Closure Verification Contract

## Desired behavior

- Security Review runs deterministic repository-owned security, contract, and
  integration tests without a model-provider credential or third-party agent.
- Visual QA classifies the complete pull-request diff before deciding whether
  visual execution is applicable.
- A non-visual diff reports `CHECK_RESULT: NOT_APPLICABLE`, a stable reason,
  and every evaluated path.
- A visual diff is never reported successful without an applicable visual
  validation implementation.
- Both workflows use least-privilege, read-only repository permissions.

## Acceptance criteria

1. Neither workflow references `ANTHROPIC_API_KEY`,
   `anomalyco/opencode/github`, `continue-on-error`, nor an ignored exit code.
2. Security Review invokes the canonical test runner for `unit`, `contract`,
   and `integration`.
3. `package.json` by itself is classified as non-visual.
4. Frontend source and CSS/SCSS changes are classified as visual.
5. Non-applicable output contains the result, reason, and evaluated paths.
6. Applicable output exits non-zero until a real visual validation command is
   configured.
7. Workflow contract tests are part of the canonical contract group.
8. Approval receipts match the current intent, task, capsule hash, branch, and
   base SHA; a receipt never expands the capsule's effects or resource scope.
9. Malformed signatures fail closed with a structured result.

## Red and regression tests

- `test/contracts/ci-workflow-contract.test.mjs`
  - rejects provider-dependent or privileged workflows;
  - rejects security workflows without the canonical deterministic groups;
  - rejects visual workflows without explicit diff evidence;
  - verifies visual path positive and negative classification;
  - verifies fail-closed behavior for applicable visual changes.
- `test/approval-v2/approval-engine.test.mjs`
  - rejects receipt replay across task/intent/capsule/branch/base contexts;
  - rejects receipt-based capsule scope expansion;
  - rejects malformed signatures without throwing.

## Reality gate and evidence

- Red: the contract test fails against the pre-fix workflows.
- Green: the contract test passes after the minimal workflow and classifier
  changes.
- Regression: the full canonical contract group passes.
- Structural evidence: workflow text inspection and `git diff --check`.
- Live evidence: classifier subprocess exit codes and captured stdout/stderr.

## Untestable assumptions

- GitHub-hosted `ubuntu-latest` provides Git and can install the pinned Node
  runtime through the GitHub-maintained setup action.
- Live GitHub Actions execution is outside this local change step and must be
  verified after push by the orchestrator.
