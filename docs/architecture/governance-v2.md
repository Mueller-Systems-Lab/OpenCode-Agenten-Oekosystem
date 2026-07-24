# Governance V2 Architecture

```text
Owner Intent → Task Capsule → Effect/Scope/Reversibility
      ↓                  ↓
Policy IR → Capability Registry → Approval Engine
      ↓                  ↓
Lease/Receipt reuse → autonomous work or bundled owner packet
      ↓
Task graph statuses → Outcome Evidence → VERIFIED_IN_SCOPE
```

The runtime owns enforcement. The prompt kernel carries only eight durable rules. `read_scope` permits analysis, `write_scope` permits writes, `forbidden_scope` denies both, and `external_effect_scope` is evaluated separately. The Approval Coordinator is a collector and deduplicator; it never grants consent.

Risk routing is concrete: `LOW_LOCAL/COMPACT`, `MEDIUM_REVIEW/STANDARD`, `HIGH_HUMAN_GATE/CRITICAL`, and `CRITICAL_BLOCK/BLOCKED`. `RESEARCH` is a task mode, not a risk tier.
