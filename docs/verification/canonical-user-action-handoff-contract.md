# Verification Contract — Canonical User Action Handoff

## Desired Behavior

All relevant generated or required completion reports end with a mandatory
German user-action section that contains only actions proven non-delegable after
capability, authentication, permission, authorization, agent, and personal
decision checks.

## Acceptance Criteria

1. Governance V2 and generated IR contain the canonical contract.
2. One JSON Schema defines controlled reason codes and capability evidence.
3. The renderer always emits the exact German final section.
4. Empty actions emit exactly the standard sentence.
5. Multiple actions are stable and deduplicated.
6. GitHub actions require concrete numbered web-UI controls and reject CLI-only
   guidance.
7. An available authenticated permitted authorized capability or suitable agent
   prevents delegation.
8. Recommendations, residual risks, next steps, already-executed actions,
   missing evidence, unknown reasons, and contradictions fail validation.
9. Bootstrap output contains the contract in AGENTS, Hermes, schema, and report
   surfaces.
10. OpenCode, Governance, Hermes, Spec-Kit, and validator constants do not drift.
11. Machine-readable final-status reports require the structured handoff.
12. Existing regression and security boundaries remain green.

## Red Tests

- `test/contracts/user-action-handoff.test.mjs`
- `test/contracts/user-action-handoff-schema.test.mjs`
- `test/integration/user-action-handoff-surfaces.test.mjs`
- final-status additions in closure-evidence coverage

Each central contract must fail before implementation: governance/schema,
renderer, validator, bootstrap/OpenCode, Hermes, and machine completion.

## Positive Matrix

1. empty action set;
2. physical action;
3. missing permission after capability check;
4. GitHub merge with non-delegable owner approval;
5. stable multiple actions without duplicates;
6. German report with official English UI labels;
7. isolated fixture bootstrap;
8. Hermes handoff parity.

## Negative Matrix

1. authorized commit delegated;
2. authorized PR creation delegated;
3. missing `gh` treated as full gap despite connector;
4. CLI-only GitHub action;
5. missing section;
6. English section;
7. wrong heading;
8. empty sentence plus actions;
9. optional recommendation;
10. residual risk;
11. missing reason code;
12. missing capability evidence;
13. already executed action;
14. unsuitable current agent despite suitable alternative;
15. GitHub steps without visible labels;
16. placeholders despite known target;
17. next steps copied wholesale;
18. unproven “KI kann das nicht” statement;
19. explicit non-array action input;
20. unknown handoff fields;
21. noncanonical external action ordering;
22. schema-incompatible scalar types;
23. confirmation before navigation or action control;
24. GitHub target disguised as `manual`;
25. English handoff prose around otherwise valid technical labels;
26. fenced Markdown examples mistaken for live sections;
27. local Linux, root, media, WSL, macOS, or Windows paths leaked.

## Regression Tests

- `npm test`
- `node scripts/validate-ecosystem.mjs`
- governance generation/drift
- schema and lifecycle tests
- bootstrap tests
- security/redaction tests
- Hermes parity
- CLI contract
- gitignore/credential/path scans
- syntax checks
- `git diff --check`

## Reality Gate

- Path A: rendered no-action completion ends exactly with heading + sentence.
- Path B: fixture owner-only GitHub merge renders repository, PR, reason,
  numbered visible UI controls, confirmation, and abort condition.
- Path C: authorized writable connector prevents user delegation.
- Path D: isolated fresh-project bootstrap generates all required surfaces and
  a valid completion report.
- Path E: after push, fresh remote clone installs reproducibly and passes full
  regression, validator, and focused E2E.

## Evidence Types

| Evidence | Source | Collection |
| --- | --- | --- |
| RED output | focused `node --test` | captured terminal output and exit code |
| GREEN output | focused/full test runner | captured terminal output and counts |
| governance drift | generator `--check` | exit code and status line |
| validator | ecosystem validator | classification and exit code |
| E2E | isolated fixture tests | deterministic test output |
| security/privacy | scans and redaction tests | exit codes and findings |
| diff | Git status/diff/stat/check | local Git output |
| remote identity | local/remote SHA | `git rev-parse`/`ls-remote` |
| fresh clone | real remote clone | clone SHA and reproduced test output |
| review | independent read-only agent | structured finding table |

## Untestable Assumptions

| Assumption | Why untestable here | Risk if wrong |
| --- | --- | --- |
| GitHub may vary UI labels by repository settings | no browser mutation or owner-session UI inspection is authorized | instructions may require the documented abort condition |
| A downstream consumer may ignore generated instructions | consumer behavior is outside this repository | schema/validator still fail closed when invoked |

## Completion Claim Gate

- all acceptance criteria met;
- every RED test becomes GREEN;
- full regression and validator pass;
- paths A–E pass;
- no critical/high review finding remains;
- no secret/private evidence artifact is committed;
- Issue #16 and `master` remain unchanged;
- local and remote feature SHA match;
- final report itself validates under the new contract.
