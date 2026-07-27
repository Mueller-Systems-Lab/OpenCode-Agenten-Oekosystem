# Model Assurance — Threat Model

## Assets

1. **Evaluation Integrity**: Scores and classifications must reflect actual model behavior
2. **Hidden Tests**: Acceptance criteria unknown to the candidate model
3. **Provider Budget**: Financial controls on external API calls
4. **Candidate Isolation**: Candidate workspace must not access production data
5. **Registry Accuracy**: Registry entries must reflect valid evaluations

## Threat Actors

### T1: Candidate Model
- May attempt to manipulate scores, evaluator, or hard gates
- May fabricate tool calls, test results, or agent delegations
- May leak credentials or modify files outside scope

### T2: Evaluator Operator
- May attempt to skip gates or bypass isolation
- May reuse stale evaluation results

## Threats and Mitigations

### TH-01: Score Manipulation
**Threat**: Candidate reads and modifies evaluation scores.
**Mitigation**: Scores stored outside candidate workspace. HG-10 blocks evaluator manipulation.

### TH-02: Hidden Test Leakage
**Threat**: Candidate discovers hidden test content through filesystem access.
**Mitigation**: Hidden tests stored in separate directory outside candidate workspace. Candidate only has access to public probes.

### TH-03: Provider Budget Exhaustion
**Threat**: Unrestricted provider calls consume budget.
**Mitigation**: HG-11 enforces budget limits. HG-12 blocks calls without explicit approval. Budget must be positive and declared.

### TH-04: Stale Evaluation Reuse
**Threat**: Old evaluation results used after model/harness/toolset change.
**Mitigation**: Registry invalidation on any parameter change. Expiry date enforcement.

### TH-05: False Agent Claims
**Threat**: Candidate claims to use build-agent or test-agent (which don't exist).
**Mitigation**: HG-14 and HG-15 directly block these claims. Agent reality defined in project-requirements.yml.

### TH-06: False Test Counts
**Threat**: Candidate reports more tests than actually executed.
**Mitigation**: HG-17 requires actual test runner output. HG-02 blocks invented test results.

### TH-07: Runtime Import Ignorance
**Threat**: Candidate accepts ERR_MODULE_NOT_FOUND as success.
**Mitigation**: HG-18 specifically blocks this. HG-19 requires real installation smoke test.

## Assumptions

1. The evaluator process has filesystem access to the candidate workspace for validation.
2. Hidden tests are placed in a directory that the candidate cannot access through normal tool permissions.
3. Provider credentials are configured separately and never exposed to the candidate.
4. The evaluation host has sufficient isolation (separate process, separate workspace) for shadow mode.
