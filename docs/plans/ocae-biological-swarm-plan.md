# Biological Swarm Plan

1. Extend `scripts/blackboard.py` with additive schema migration, deterministic
   signal/TTL/quorum/inhibition/matching commands, and observer projection.
2. Add focused blackboard tests and preserve old CLI behavior.
3. Update the portable skill, OpenCode adapters, protocol reference, archive,
   and architecture map with the explicit authority boundary.
4. Run focused and canonical local gates, inspect the diff, and record the
   release/distribution blockers separately from local evidence.

## Tasks

- BB-1: signal, TTL, migration, and priority semantics.
- BB-2: quorum and authority enforcement.
- BB-3: scouts, inhibition, and capability matching.
- BB-4: observer, adapter, archive, documentation, and tests.
- BB-5: release and bare-URL validation, pending external GitHub/browser gate.

## Minimum effective parallelism

BB-1, BB-2, and BB-3 touch one canonical Python engine and therefore are
sequenced to avoid duplicate write work. BB-4 follows the engine tests.
BB-5 is blocked until the canonical GitHub workflow and headed browser are
available.
