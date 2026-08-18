# Plan

## Targets
- src/format.mjs
- src/user.mjs
- test/format.test.mjs

## Acceptance Criteria
- src/format.mjs exports `formatDisplayName` (no `formatName` export remains)
- src/user.mjs imports and uses `formatDisplayName`
- test/format.test.mjs imports and calls `formatDisplayName` with unchanged assertion expectation (`'a'`)
- All three files contain no stale `formatName` references; `node --test test/format.test.mjs` passes

## Required Tests
- node --test test/format.test.mjs

## Risks
- none

## Build Scope
files: src/format.mjs, src/user.mjs, test/format.test.mjs
