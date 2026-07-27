# Tasks — Canonical User Action Handoff Contract

## Phase 1 — Contract and RED

- [x] T001 Persist Constitution, Specify, Plan, Tasks, Analyze, Run Card, and
  Verification Contract.
- [x] T002 Add schema/governance drift RED tests.
- [x] T003 Add renderer/validator positive and negative RED tests.
- [x] T004 Add bootstrap/OpenCode/Hermes parity RED tests.
- [x] T005 Add final-status machine-report RED tests.
- [x] T006 Run focused tests and retain actual RED output.

## Phase 2 — Canonical Implementation

- [x] T101 Add Governance V2 contract and JSON Schema.
- [x] T102 Generate canonical IR and verify no drift.
- [x] T103 Implement capability-first normalization and validation.
- [x] T104 Implement deterministic German renderer and markdown validator.
- [x] T105 Integrate machine-readable final-status reports.

## Phase 3 — Surfaces

- [x] T201 Integrate bootstrap run report.
- [x] T202 Inject concise contract into generated AGENTS/OpenCode surfaces.
- [x] T203 Copy the canonical schema into bootstrap targets.
- [x] T204 Align Hermes source bundle and generated handoffs.
- [x] T205 Align Spec-Kit completion/verification prompts.
- [x] T206 Document migration and ADR.

## Phase 4 — Verification

- [x] T301 Run focused Green tests and all required positive/negative cases.
- [x] T302 Run E2E paths A–D in isolated fixtures.
- [x] T303 Run full regression, validator, syntax, scans, and diff checks.
- [x] T304 Run independent read-only review; fix and retest findings.
- [x] T305 Create atomic commits and push the approved feature branch.
- [x] T306 Clone the remote branch fresh and rerun full/focused verification.
- [x] T307 Post the structured completion comment to Issue #18.

## Dependency Order

`T001 → T002–T006 → T101–T105 → T201–T206 → T301–T307`.

No implementation task may begin before T001–T006 complete.
