# T8 residuals close-out — quorum fingerprint + scout promotion (2026-09-13)

Task 13 (second result; DONE not marked). Branch feat/ocae-product-consolidation.
Engine: `.agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py` 1369 → 1430 lines (+61, ≤80 budget).
Protocol: `.agents/skills/coordinate-blackboard-swarm/references/protocol.md` bio +4 lines.

## E. Quorum fingerprint binding
- `vote … --fingerprint FP` (default: current task fingerprint).
- Task fingerprint = value of latest `fingerprint` fact (`fact <id> fingerprint <sha> --ref …`), default `""`.
- `quorum_status` returns `(n, required, stale)`; only votes with `fp == current` count; stale = fresh authorized non-owner PASS votes with mismatched fp.
- `vote`/`quorum` print `n/m (stale:k)`; `done` enforces fingerprint-filtered quorum; `snapshot.tasks[].quorum` stays `n/m` (backward compat).
- Old votes (`fingerprint=''`) match only empty current fingerprint.

## C. Scout promotion (OBSERVED → confirmed)
- `scout-confirm <scoutFactId> --reviewer W --ref R`: requires reviewer `authorized=1`, reviewer != original scout (self-confirm → `SCOUT_SELF_CONFIRM_REJECTED`), non-empty ref; sets `confirmed=1,confirmed_by,confirmed_ref` (migration-safe ALTERs).
- `snapshot` includes per-scout `confirmed/confirmed_by` + top-level `scouts_confirmed`.

## Tests (real runs, this session)
- `node --test test/blackboard-quorum-scout.test.mjs` → 6/6 PASS (QS1 explicit FP bind; QS2 default FP + mutation invalidates; QS3 quorum excludes stale; QS4 self-confirm rejected; QS5 second-scout confirm; QS6 snapshot confirmed count).
- `node --test test/blackboard-biological.test.mjs test/blackboard-hardening.test.mjs test/blackboard-mission-gaps.test.mjs` → 26/26 PASS (3+11+12), no regressions.
- `python3 -c ast.parse` ok; `node --check` ok.

## Scope guard
- No commits/pushes; DONE not marked; untouched: build_backend, installers, swarm.ts, manifest versions, docs beyond protocol.md bio lines.
