# Runtime and MCP Evidence

## Hermes / CT108

- Requested endpoint: CT108, `192.168.1.210:9119`.
- Fresh TCP probe: failed in the current network (`TcpTestSucceeded=False`).
- Local `hermes` executable: not found on PATH.
- Local Hermes installation/plugin process: not discovered.
- Runtime plugin SHA256, service identity, hook invocation, allow path, deny
  path, and fail-closed runtime-failure proof: unavailable.

This is an external/network and owner-gated blocker, not evidence that the
runtime is secure or insecure. The repository hook source must not be promoted
to a runtime GREEN claim.

## MCP

The repository contains MCP candidate selection and a guarded MCP call path,
but the current `master` branch has no declarative per-agent required/optional
capability contract and no mandatory preflight gate wired to agent start,
restart, or configuration changes. Therefore the requested invariant
`FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT` is not proven active.

No credentials or secret values are included in this evidence.
