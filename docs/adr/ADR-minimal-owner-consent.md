# ADR: Minimal Owner Consent

Status: Accepted for this migration

Owner consent is requested only for an effect that is external, irreversible, value-laden, or outside existing authorization. Requests are deduplicated by task/effect/resource/semantic reason and bundled into one recommended `OWNER_DECISION_PACKET`. A waiting node does not stop unrelated safe graph nodes. The Task Capsule records a target and maximum interruption budget.

Routine filenames, test choices, refactors, retries, local commits, and other reversible in-scope decisions are autonomous.
