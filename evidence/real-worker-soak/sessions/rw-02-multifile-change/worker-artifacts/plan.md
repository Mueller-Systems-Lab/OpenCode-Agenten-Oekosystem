# Plan
## Targets
- src/format.mjs — rename formatName to formatDisplayName
- src/user.mjs — import formatDisplayName
- test/format.test.mjs — update import
## Acceptance Criteria
- src/format.mjs exports formatDisplayName
- src/user.mjs uses formatDisplayName
- test/format.test.mjs passes
## Required Tests
- node --test test/format.test.mjs
## Risks
- low: import mismatch
## Build Scope
files: src/format.mjs, src/user.mjs, test/format.test.mjs
