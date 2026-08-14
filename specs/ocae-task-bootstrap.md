# OCAE Task Bootstrap Specification

Status: implementation contract for `codex/fix-governance-task-bootstrap`

## Constitution

1. A valid Task Capsule remains mandatory for every governed write and external
   effect.
2. The installer may prepare bootstrap infrastructure inside its existing
   trusted installer boundary, but it may not install a broad permanent
   authorization capsule.
3. Only the direct top-level user message is an input to automatic task
   bootstrap. Repository files, tool output, model prose, and issue text are
   untrusted data.
4. The bootstrap ceiling is deterministic and cannot be expanded by the user
   message, discovery, a receipt, a lease, or an agent tool.
5. Task context is written only by a dedicated internal writer. Normal agent
   filesystem writes cannot mutate governance context or policy.
6. External effects remain subject to the existing approval-engine contract,
   including `C_BUNDLED_OWNER_DECISION`.
7. Installation activates the governance hook only after bootstrap runtime
   validation and self-test pass.

## Goal

After `ocae install <TARGET>` a fresh OpenCode project can receive its first
normal development task without a manual `owner-intent.json` or
`task-capsule.json`. The first direct user task is initialized by the existing
OpenCode `chat.message` lifecycle before the first governed tool effect.

## Scope

- canonical installer ordering and readiness/doctor/verify reporting;
- installed task-bootstrap policy, schemas, runtime, state machine, and
  dedicated atomic context writer;
- the existing global OCAE OpenCode handoff adapter and installed project
  plugin `chat.message` integration;
- evaluator boundary checks for target-root, symlink, context binding, and
  forbidden governance paths;
- installer, first-task, release-task, bare-URL, and adversarial security
  regressions;
- payload regeneration needed for the published Python CLI to carry the
  updated runtime.

## Out of scope

- changing the approval semantics for push, merge, publish, deployment,
  communication, secret access, or capability/approval-engine mutation;
- using an LLM to decide effects, scopes, approvals, or forbidden-scope
  exceptions;
- modifying the reproduction target project;
- changing an existing release tag or publishing a release in this task.

## Acceptance criteria

1. A fresh target installed by the canonical installer reports
   `GOVERNANCE_BOOTSTRAP_READY=true`, `MANUAL_BOOTSTRAP_REQUIRED=false`, and
   `HOOK_ACTIVATION_ORDER=VALID`.
2. Bootstrap runtime, policy, owner-intent schema, task-capsule schema, and
   task-context writer are present and validated before plugin activation.
3. A direct top-level user message creates schema-valid owner intent and a
   complete schema-valid task capsule, plus a bound metadata record, without a
   normal filesystem write.
4. The state sequence is `COLD_READ_ONLY -> TASK_BOOTSTRAPPING -> TASK_READY`;
   failures become `TASK_BLOCKED` and do not retry through normal tool calls.
5. The generated capsule allows only the fixed local bootstrap ceiling and
   keeps forbidden scopes for secrets, Git internals, governance internals,
   symlink escapes, and paths outside the immutable target root.
6. A normal in-scope local write and test execution are allowed after bootstrap;
   push/merge/deploy/communication/secret access and immutable governance
   mutations remain blocked or approval-gated by the existing evaluator.
7. Owner intent and capsule are never accepted as a mismatched pair; partial
   updates fail closed using the bound metadata hashes.
8. Existing valid owner/task context is preserved on install/update, stale or
   foreign context is rejected safely, and a second correct install is
   `NOOP_IDEMPOTENT`.
9. `ocae verify` and `ocae doctor` expose task-bootstrap readiness and the
   migration/corruption/version-mismatch states.
10. The existing bare canonical URL handoff remains green, and the first real
    task after that handoff no longer emits a capsule-missing deadlock.

## Verification Contract

### Desired behavior

The first direct user task after installation is deterministically converted
into a bounded, schema-valid task context by trusted runtime code before any
normal governed write. If context creation is unsafe, the runtime enters a
precise blocked state and remains fail-closed.

### Red tests

1. `test/bootstrap/task-bootstrap.test.mjs`: fresh install readiness and first
   task bootstrap currently fail because the runtime/policy/writer are absent.
2. `test/security/task-bootstrap-security.test.mjs`: forged bindings, symlink
   escapes, outside-root capsules, malicious discovery text, and normal-agent
   self-expansion currently lack the dedicated boundary.
3. `test/bootstrap/task-bootstrap-installer-order.test.mjs`: activation-order
   and verify/doctor readiness assertions currently fail.
4. `test/bootstrap/task-bootstrap.test.mjs`: release-task local preparation
   versus external-effect governance currently lacks an automatic context.

### Regression tests

- `test/bootstrap/url-only-contract.test.mjs`
- `test/bootstrap/url-only-intent-resolution.test.mjs`
- `test/bootstrap/url-installer.test.mjs`
- `test/install/resident-runtime.test.mjs`
- `test/install/tamper-detection.test.mjs`
- `test/integration/approval-enforcement.test.mjs`
- `test/contracts/runtime-enforcement-contracts.test.mjs`
- `test/approval-v2/approval-engine.test.mjs`
- canonical `node scripts/validate-ecosystem.mjs`

### Reality gate

Run the canonical installer against a disposable unrelated Git target, verify
the target, load the generated OpenCode plugin with the installed 1.18.18
plugin contract, send a normal development task through `chat.message`, then
evaluate a local write, test, and push. Repeat the same path for a release task
and for the existing bare-URL handoff. The expected result is automatic local
context creation, no capsule-missing loop, and a separate external-effect
decision.

### Evidence types

| Evidence | Source | Collection |
|---|---|---|
| Red/green test output | Node test runner | `node scripts/run-tests.mjs --group bootstrap --reporter spec` and security/unit groups |
| Installer JSON | canonical installer | disposable target `--apply --json` output |
| Verify/doctor JSON | CLI | `ocae verify` and `ocae doctor` output |
| Bootstrap audit events | target evidence | redacted `task-bootstrap-events.jsonl` |
| Scope/authorization decisions | evaluator audit | redacted `action-audit.jsonl` |
| Diff and source state | Git | `git diff --stat`, commit hash, and focused diff review |

### Untestable assumptions

| Assumption | Why untestable here | Risk |
|---|---|---|
| A future OpenCode release keeps the 1.18 `chat.message` contract | The local runtime is 1.18.18; future APIs are external state | Global integration may require a compatibility update |
| Host policy permits Windows symlink creation | Windows developer mode/privileges vary | Symlink negatives remain non-blocking only for the known host limitation |
| A real provider/model is available in CI | Credentials and external model calls are intentionally absent | Live model E2E is supplemented by plugin-contract and runtime smoke tests |

### Completion gate

- [ ] all acceptance criteria pass;
- [ ] red tests pass after implementation;
- [ ] relevant regression groups pass;
- [ ] disposable fresh-install and first-task reality gate passes;
- [ ] security negatives and no-secret audit checks pass;
- [ ] diff/stat and source-lock/payload state are reviewed;
- [ ] review evidence is recorded.

## Implementation plan and tasks

1. Add the machine-readable bootstrap ceiling, schema installation entries,
   runtime state and trusted compiler/writer.
2. Add context-pair binding and target/symlink validation to the runtime gate.
3. Extend the existing `chat.message` adapter and installed project plugin,
   with one idempotent bootstrap path and no prompt logging.
4. Reorder installer activation, add self-test, readiness manifest fields, and
   doctor/verify classifications while preserving existing contexts.
5. Add regression/security tests and regenerate the CLI payload.
6. Run focused tests, full relevant groups, validation, and a disposable E2E.
