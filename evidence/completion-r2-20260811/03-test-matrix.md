# Final Test Matrix

All commands below ran against the same source HEAD
`82a38b6f05220994d3d8571aa73ae58f5e426ab4` with the uncommitted local delta.
The canonical runner stops at the first failing group; groups were also run
individually to expose the complete matrix.

| Command | Files | Tests | Passed | Failed | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| `node scripts/run-tests.mjs --all --reporter dot` | 8 executed of 38 expected | 212 | 210 | 2 | host symlink gate |
| `node scripts/run-tests.mjs --group contract --reporter dot` | 8 | 140 | 139 | 1 | runner includes the 2 symlink failures |
| `node scripts/run-tests.mjs --group integration --reporter dot` | 6 | 41 | 35 | 6 | 5 direct symlink failures plus dependent runner failure |
| `node scripts/run-tests.mjs --group bootstrap --reporter dot` | 10 | 82 | 75 | 7 | seven direct symlink creation failures |
| `node scripts/run-tests.mjs --group governance --reporter dot` | 3 | 9 | 8 | 1 | symlink-ledger test |
| `node scripts/run-tests.mjs --group e2e --reporter dot` | 3 | 126 | 124 | 2 | runner propagation of symlink failures |
| `node --test test/contracts/completion-runtime-contracts.test.mjs` | 1 | 11 | 11 | 0 | pass |
| focused installer/resident portability suite | 5 | 31 | 31 | 0 | pass |
| `node scripts/check-governance-drift.mjs` | — | — | — | — | `GOVERNANCE_DRIFT_CHECK_OK` |
| `node scripts/validate-ecosystem.mjs` | — | — | — | — | `RED_BLOCK` because canonical suite is 210/212 |

No test was skipped or weakened to conceal the symlink limitation.
