# Run Card — rw-05-skill-task

Skill: .opencode/skills/run-card/SKILL.md (all 17 mandatory fields)

| # | Field | Value |
|---|-------|-------|
| 1 | Goal of the run | Fix src/calc2.mjs so multiply(a, b) returns a * b; test/calc2.test.mjs passes |
| 2 | Why necessary | Existing test asserts multiply(3, 4) === 12; current implementation returns a + b (= 7) |
| 3 | Risk Tier | LOW_LOCAL |
| 4 | Context Level | COLD |
| 5 | Source of Truth | local only (soak task instructions; no GitHub issue) |
| 6 | Scope | src/calc2.mjs |
| 7 | Out of Scope | test/calc2.test.mjs, skill files, repository outside fixture |
| 8 | Hard Constraints | Only src/calc2.mjs may change; test must not be edited; node --test must be green; no git operations |
| 9 | Non-Touch Areas | test/, .opencode/, any file outside the fixture directory |
| 10 | Involved Agents | real worker (no subagent delegation) |
| 11 | Verification Contract | Desired behavior: multiply(a,b) === a*b. Acceptance: multiply(3,4) === 12 and `node --test test/calc2.test.mjs` passes. Reality gate: real test run output. Evidence: test output, file diff. Untestable assumptions: none. |
| 12 | Red Tests | `node --test test/calc2.test.mjs` expected to fail before fix (multiply(3,4) returns 7) |
| 13 | Test Matrix | node --test test/calc2.test.mjs |
| 14 | Evidence Plan | Red test output (pre-fix), green test output (post-fix), changed files list |
| 15 | Owner-Approval-Status | NOT_REQUESTED (LOW_LOCAL, no approval gates apply) |
| 16 | Rollback Strategy | Revert single line in src/calc2.mjs back to `return a + b` (reversible local file edit) |
| 17 | Expected Completion Classification | GREEN_SAFE (legacy) / VERIFIED_IN_SCOPE (V2 claim naming); no terminal claim set in build artifact |
