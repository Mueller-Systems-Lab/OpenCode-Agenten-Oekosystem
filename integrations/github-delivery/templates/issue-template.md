---
name: Delivery Issue Template
about: Template for issues with machine-readable lifecycle markers
title: "[LIFECYCLE] "
labels: lifecycle, delivery
assignees: ''
---

<!--
LIFECYCLE_MARKER: ISSUE_READY
LIFECYCLE_VERSION: 1.0.0
LIFECYCLE_SCHEMA: https://github.com/xxammaxx/opencode-agent-ecosystem/integrations/github-delivery/lifecycle-schema.json
-->

## Issue Summary

<!-- Brief description of the issue -->

## Story Specification

### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

### Size Estimate

- **Story Points:** 
- **Complexity:** Low/Medium/High
- **Risk Tier:** LOW_LOCAL/MEDIUM_REVIEW/HIGH_HUMAN_GATE/CRITICAL_BLOCK

### Dependencies

- Depends on: 
- Blocks: 

## Delivery Lifecycle

<!--
LIFECYCLE_STATE: ISSUE_READY
LIFECYCLE_TRANSITIONS: STORY_PLANNED
LIFECYCLE_GATES: issue_triage
LIFECYCLE_EVIDENCE: issue_labels, issue_priority
LIFECYCLE_ROLES: issue-orchestrator
LIFECYCLE_FAIL_CLOSED: true
-->

### Required Gates

- [ ] Issue triage complete
- [ ] Story planned with acceptance criteria
- [ ] Size estimate provided
- [ ] Risk tier assessed

### Evidence Requirements

- `issue_view.json` - GitHub issue data
- `story_spec.md` - Story specification
- `acceptance_criteria.md` - Acceptance criteria
- `size_estimate.json` - Size estimate

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

## Checklist

- [ ] Issue triaged
- [ ] Story planned
- [ ] Acceptance criteria defined
- [ ] Size estimate provided
- [ ] Risk tier assessed
- [ ] Security requirements documented
- [ ] Compliance requirements documented
- [ ] Visual QA requirements documented
- [ ] Merge constraints documented
- [ ] Testing requirements documented
- [ ] Evidence storage plan documented
- [ ] Role separation documented

## References

- [Lifecycle Schema](lifecycle-schema.json)
- [Lifecycle Policy](lifecycle-policy.yaml)
- [Delivery Agent](agent-delivery.md)
- [Delivery Skill](skill-delivery.md)
- [Evaluator](evaluator.md)