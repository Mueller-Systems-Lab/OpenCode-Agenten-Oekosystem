# T8 Biological coordination primitives — verification (2026-09-13)

Worker: ses_f63466d30ffeQfCFuJKMHiIT2R · Task 13 · Branch feat/ocae-product-consolidation
Engine: `.agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py` (1369 lines, schema_version 2)
Refs: `references/protocol.md` (§Biological coordination), `SKILL.md` (§Deterministic biological primitives),
`docs/specs/ocae-biological-swarm.md`, `docs/plans/ocae-biological-swarm-plan.md`
Method: verify-then-fix-tiny-gaps. Read-only; **no engine/test edits** (all residual gaps are design-level, >20 lines).

## A–G verdict table

| ID | Primitive (Mission §9) | Implemented | Tested | Gap |
|----|------------------------|-------------|--------|-----|
| A | Signal / pheromone (scheduling priority only) | YES — `cmd_signal`: append-only `signals(subject,delta,reason,source,expires_at,persistent)`; `effective_signal` = SUM active deltas; `next` orders by `-(priority+signal)`, tie = ascending id | YES — biological T1 (order flip + 2.2s TTL evaporation), mission-gaps G8 (3+3=6 accumulation) | None blocking. Notes: append-only, no dedup (by design, G8); expired rows retained, only excluded from effective sum; `persistent` flag stored but `effective_signal` still honours TTL (flag has no expiry-override effect) |
| B | Inhibition (temporary routing penalty) | YES — `cmd_inhibit`: `penalty>=0`, `ttl>0` required, `expires_at=now+ttl`; `effective_inhibition` sums active per (subject,task_class) | YES — biological T3 (inhibited `a` loses to `b`); probe 20260913: all-inhibited (`a`=5,`b`=9) → `MATCH\|T1\|a\|inhibition:5` = **least-inhibited selected, never blocks (no starvation)** | No starvation-block by design; penalty is advisory only |
| C | Scout facts (bounded read-only exploration) | YES — `cmd_scout`: voter must be registered + `authorized=1` + `role=scout`; `ref` required; `confidence∈[0,1]`; optional TTL; `done` rejects scout-owned/completing tasks (`SCOUT_CANNOT_COMPLETE_IMPLEMENTATION`); snapshot caps 20, watch caps 5 | YES — biological T3 (scout fact insert + scout-done rejected) | **No OBSERVED→confirmed promotion rule in engine** — no confidence threshold, no promotion transition; facts stay advisory. Reported, not implemented (design-level, >20 lines) |
| D | Recruitment (PROPOSED→admit, priority-based) | YES — `propose`→PROPOSED; `admit` requires PROPOSED + non-empty evidence, →READY; `next` = effective-priority recruitment | YES — mission-gaps G7 (propose/reject path); G3/G5 (READY reclaim/retry); spec AC 5/plan BB-4 chain | None |
| E | Quorum (independent authorized evidence threshold) | YES — `vote` requires registered+authorized voter + non-empty ref, optional TTL; `quorum_status` = distinct PASS voters minus implementation worker (first CLAIM), fresh only; `quorum --gate` fail-closed; `done` requires PASS result + quorum | YES — biological T2 (self/unauthorized/stale excluded, 2/2 PASS→done); mission-gaps G4/G6/G10/G12 | **Fingerprint binding honest report: `ref` is a free-text evidence pointer, NOT a hash.** `votes.ref TEXT NOT NULL`, no digest computed, no artifact-hash comparison anywhere in engine. "Fingerprint" = evidence-ref string. Hash-bound votes would be a design-level addition (>20 lines) — reported only |
| F | Capability matching (deterministic routing) | YES — `register-worker` validates capabilities JSON list, stores sorted+deduped, authorized+role; `match` filters `required⊆caps`, excludes `authorized=0` and `role=scout`, sorts by `(inhibition_penalty, -extra_caps, worker)` | YES — biological T3 (`match --requires read,python` → `b`); mission-gaps G12 (deauthorized excluded) | None |
| G | Adaptive parallelism / minimum parallelism | PARTIAL — engine has **no parallelism primitive**: concurrency = leases + atomic claim + `renew`/expiry recovery. Minimum-parallelism rule lives only in `docs/plans/ocae-biological-swarm-plan.md` ("BB-1..BB-3 sequenced — one engine; BB-4 follows; BB-5 blocked on external gate"). Not engine-enforced | Indirect — G2 (atomic claim, no steal), G3 (expiry recovery), hardening D1/E1 (renew/claim idempotency) | **No engine-level adaptive-parallelism primitive** (e.g. worker-count scaling, parallel-slot caps). Doc rule only; enforcement would be design-level (>20 lines) — reported only |
| — | Authority neutrality (cross-cutting) | YES — protocol.md + SKILL.md: signals/votes/scout/inhibition/caps are data, never authority; preflight gate; gates require evidence; peer cannot renew чужой claim / vote deauthorized | YES — G1 (preflight), G9 (snapshot leaks no fact values), G11 (ses_ identity), G12 (no peer escalation), spec AC 8 | None |

## Test runs (2026-09-13, real runs, this session)

- `node --test test/blackboard-biological.test.mjs` → **3/3 PASS** (signal TTL, quorum self/unauthorized/stale, scout+inhibition+match)
- `node --test test/blackboard-hardening.test.mjs` → **11/11 PASS** (schema v2, runs, deps, renew, claim idempotency, result dedup)
- `node --test test/blackboard-mission-gaps.test.mjs` → **12/12 PASS** (G1–G12 incl. preflight, atomic claim, expiry, DONE gating, green, reject, aggregation, observer secrecy, quorum integrity, session id, no-escalation)
- Total: **26/26 PASS**, 0 fail. Extra probes (temp DB, not canonical): all-inhibited→least-inhibited; persistent+TTL stored; scout low-confidence stored without promotion.
- Canonical board untouched except task-13 claim/facts/results (this worker). `git diff --stat` pre-existing modifications left intact; no commits/pushes.

## Fix policy outcome

No code edits: every residual gap (C promotion rule, E hash-bound fingerprint, G engine parallelism, signal/vote pruning bounds) exceeds the ≤20-line fix budget and is a design decision for the supervisor. Authority-neutral primitives A–G verified implemented+tested as specified in `docs/specs/ocae-biological-swarm.md` acceptance criteria 1–8.
