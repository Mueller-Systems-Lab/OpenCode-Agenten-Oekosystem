# ADR: Master Protection and Required Core CI Gates

Status: Accepted

`master` promotes changes only through pull requests whose required check
`ocae-required` (workflow "OCAE Core Gates") is green. The gate runs the
canonical test suite (unit, contract, integration or the fail-closed portable
fallback, bootstrap, governance, e2e), the ecosystem validation including the
production sentinel, and the governance drift check. It is deterministic,
needs zero secrets, uses no external services at test time, and makes zero
paid model calls.

Force pushes and branch deletion on `master` are denied for all actors; the
ruleset has no bypass list. Emergency owner recovery is an explicit, auditable
ruleset change (temporarily disable or narrow it), not a silent bypass.

The ruleset is activated only after the `ocae-required` check name was observed
on a real pull request — no invented required check names, no protection
lockout. Optional capabilities (visual QA, multi-viewport matrices,
provider-backed model calls) never become required merge gates:
CI capability does not create a requirement.
