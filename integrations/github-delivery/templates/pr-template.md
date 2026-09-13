---
name: Delivery PR Template
about: Template for pull requests with machine-readable lifecycle markers
title: "[LIFECYCLE] "
labels: lifecycle, delivery
base: master
---

<!--
LIFECYCLE_MARKER: PR_DRAFT
LIFECYCLE_VERSION: 1.0.0
LIFECYCLE_SCHEMA: https://github.com/xxammaxx/opencode-agent-ecosystem/integrations/github-delivery/lifecycle-schema.json
-->

## PR Summary

<!-- Brief description of the PR -->

## Linked Issue

Closes #<ISSUE_NUMBER>

<!--
LIFECYCLE_ISSUE: <ISSUE_NUMBER>
LIFECYCLE_ISSUE_URL: https://github.com/xxammaxx/opencode-agent-ecosystem/issues/<ISSUE_NUMBER>
-->

## Delivery Lifecycle

<!--
LIFECYCLE_STATE: PR_DRAFT
LIFECYCLE_TRANSITIONS: PR_READY_FOR_REVIEW
LIFECYCLE_GATES: draft_pr_created, all_gates_pass
LIFECYCLE_EVIDENCE: draft_pr_url, draft_pr_sha, all_gate_results
LIFECYCLE_ROLES: executor
LIFECYCLE_FAIL_CLOSED: true
-->

### Required Gates

- [ ] Draft PR created
- [ ] All gates pass
- [ ] Review approved
- [ ] Pre-merge checks pass
- [ ] Decision packet ready
- [ ] Owner approval received

### Evidence Requirements

- `draft_pr_url.json` - PR URL
- `draft_pr_sha.json` - PR SHA
- `all_gate_results.json` - All gate results
- `review_approval.json` - Review approval
- `pre_merge_checklist.json` - Pre-merge checklist
- `decision_packet.json` - Decision packet
- `owner_approval.txt` - Owner approval

## Security Requirements

<!--
LIFECYCLE_SECURITY: minimal_permissions, sha_pinned_actions, concurrency_control, fail_closed_checks
LIFECYCLE_NO_PULL_REQUEST_TARGET: true
LIFECYCLE_NO_UNTRUSTED_SECRETS: true
-->

### Workflow Security

- [ ] Minimal permissions used
- [ ] Actions SHA-pinned
- [ ] Concurrency control enabled
- [ ] Fail-closed checks enforced
- [ ] No pull_request_target trigger
- [ ] No untrusted secrets used

## Compliance Requirements

<!--
LIFECYCLE_COMPLIANCE: dsgvo_check, data_minimization, consent_tracking
-->

### DSGVO/GDPR

- [ ] Data minimization enforced
- [ ] Consent tracking verified
- [ ] Retention policy applied
- [ ] Audit trail maintained

## Visual QA

<!--
LIFECYCLE_VISUAL_QA: applicable/not_applicable
LIFECYCLE_VISUAL_PATHS: css, scss, less, vue, jsx,tsx
-->

### Visual Changes

- [ ] Visual changes detected: Yes/No
- [ ] Visual QA executed: Yes/No
- [ ] Visual QA N/A recorded: Yes/No

## Merge Constraints

<!--
LIFECYCLE_MERGE: exact_sha_bound_token, owner_decision_packet, no_autonomous_merge
-->

### Merge Requirements

- [ ] Exact SHA-bound token required
- [ ] Owner decision packet required
- [ ] No autonomous merge allowed
- [ ] No branch deletion allowed
- [ ] No repository settings changes

## Testing Requirements

<!--
LIFECYCLE_TESTING: unit, integration, e2e, visual
-->

### Test Coverage

- [ ] Unit tests written
- [ ] Integration tests written
- [ ] E2E tests written
- [ ] Visual tests written (if applicable)
- [ ] Coverage threshold met (80%)

## Evidence Storage

### Temporary Evidence

- Store in `/tmp/opencode/T3-implementation/`

### Permanent Evidence

- Store in `integrations/github-delivery/evidence/`

### Blackboard Reference

- Reference evidence using native swarm tool

## Role Separation

<!--
LIFECYCLE_ROLES: issue-orchestrator, executor, security-agent, compliance-agent, review-agent, playwright-agent, ux-review-agent
-->

### Authorized Roles

- **Issue Orchestrator:** Coordinate, plan, track
- **Executor:** Implement, test, create PRs
- **Security Agent:** Review security, approve
- **Compliance Agent:** Review compliance, approve
- **Review Agent:** Review code, approve
- **Playwright Agent:** Run visual QA, record evidence
- **UX Review Agent:** Analyze UX, record evidence

### Prohibited Actions

- Agent cannot merge autonomously
- Agent cannot modify PR #8 or #11
- Agent cannot change repository settings
- Agent cannot delete branches
- Agent cannot deploy, release, or tag
- Agent cannot modify production data

## Changes

### Files Changed

- 
- 
- 

### Implementation Details

<!-- Details of implementation -->

### Test Results

- Unit tests: PASS/FAIL
- Integration tests: PASS/FAIL
- E2E tests: PASS/FAIL
- Visual tests: PASS/FAIL/N/A

## Checklist

- [ ] Draft PR created
- [ ] All gates pass
- [ ] Review approved
- [ ] Pre-merge checks pass
- [ ] Decision packet ready
- [ ] Owner approval received
- [ ] Security review complete
- [ ] Compliance review complete
- [ ] Visual QA complete (or N/A recorded)
- [ ] Evidence collected
- [ ] Blackboard updated

## References

- [Lifecycle Schema](lifecycle-schema.json)
- [Lifecycle Policy](lifecycle-policy.yaml)
- [Delivery Agent](agent-delivery.md)
- [Delivery Skill](skill-delivery.md)
- [Evaluator](evaluator.md)