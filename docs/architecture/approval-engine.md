# Approval Engine

`runtime/approval/approval-engine.mjs` returns one of four decision classes:

* A — autonomous: technically decidable, reversible, in capsule scope.
* B — lease/receipt: already authorized by bounded, valid authority.
* C — bundled owner decision: external, irreversible, publication, production, or value-sensitive effect.
* D — technical block: forbidden scope, unknown effect/reversibility, secret access, or governance mutation.

`approval-receipt.mjs` provides signed receipts, expiry, repository binding, bounded use, persistence, and revocation. `change-lease.mjs` enforces effect/path/delegation subsets. `approval-bundler.mjs` creates one recommended packet. `approval-audit.mjs` writes redacted JSONL evidence.
