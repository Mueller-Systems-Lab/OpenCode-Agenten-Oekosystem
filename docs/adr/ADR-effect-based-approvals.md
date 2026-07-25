# ADR: Effect-Based Approvals

Status: Accepted for this migration

Tool names and MCP server trust are not authorization. Each concrete action resolves through the capability registry into effects, resource scope, reversibility, approval class, validation, and audit level. Unknown effects, secret access, approval-engine mutation, and capability-registry mutation are technical blocks. Receipts are signed, bounded, expiry-checked, repository-aware, revocable, and optionally delegable only through subset checks.
