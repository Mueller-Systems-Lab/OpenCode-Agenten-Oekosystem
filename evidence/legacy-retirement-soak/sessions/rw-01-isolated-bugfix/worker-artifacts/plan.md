# Plan

## Targets
- src/calc.mjs
- test/calc.test.mjs (read-only reference — must not change)

## Acceptance Criteria
- `add(2, 3)` returns `5` (addition, not subtraction)
- test/calc.test.mjs is unchanged and passes via `node --test test/calc.test.mjs`
- No other source files are modified

## Required Tests
- node --test test/calc.test.mjs

## Risks
- none

## Build Scope
files: src/calc.mjs
