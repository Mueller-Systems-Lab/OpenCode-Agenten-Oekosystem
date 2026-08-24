# Post-Merge Tests

Exact final remote `master`: `7f0c21b6c8a4e9af045171c12cead3530e34e05d`.

- Focused completion plus Windows checkout contract: PASS, exit 0.
- Full suite: 212 tests, 210 passed, 2 failed, 0 skipped; both failures are the real Windows symlink `EPERM` cases listed in `symlink-host-capability.md`.
- `scripts/validate-ecosystem.mjs`: `RED_BLOCK` only because the full suite is 210/212.
- `scripts/check-governance-drift.mjs`: PASS.
- `scripts/run-completion-canary.mjs`: PASS.

