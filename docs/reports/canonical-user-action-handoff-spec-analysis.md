# Spec-Kit Analyze — Canonical User Action Handoff

## Inputs Checked

- Issue #18
- implementation prompt
- Constitution Check
- Specification
- Plan
- Tasks
- Governance V2 policy/schema/generator
- report/bootstrap/Hermes/closure-evidence code
- existing tests and test manifest

## Coverage Matrix

| Requirement group | Plan owner | Test owner | Status before implementation |
| --- | --- | --- | --- |
| Governance and reason codes | T101–T102 | T002 | Covered |
| Capability-first admissibility | T103 | T003 | Covered |
| Renderer and validator | T103–T104 | T003 | Covered |
| Completion JSON | T105 | T005 | Covered |
| Bootstrap/OpenCode | T201–T203 | T004 | Covered |
| Hermes parity | T204 | T004 | Covered |
| Spec-Kit prompts | T205 | T004 | Covered |
| Migration and ADR | T206 | structural validation | Covered |
| E2E and fresh clone | T301–T306 | focused/full suites | Covered |
| Independent review | T304 | review findings | Covered |

## Consistency Findings

- No unresolved requirement conflict exists.
- `Clarify` is not required.
- The local Spec Kit CLI is 0.14.2 while repository integration manifests
  declare `<0.14.0`; feature artifacts therefore follow the repository's
  versioned command/preset conventions without modifying global installation.
- The original checkout is dirty; all writes are isolated to the clean feature
  worktree.
- Issue #16 is an immutable dependency context, not this feature's source of
  truth.
- Existing plain `owner_actions` are incompatible with the new evidence
  contract and require an explicit migration boundary.

## Analyze Result

`PASS`: specification, plan, tasks, acceptance criteria, and tests are mutually
covered. Implementation remains gated on actual RED evidence.
