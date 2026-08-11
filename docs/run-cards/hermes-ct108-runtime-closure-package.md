# Hermes CT108 Runtime Closure Package

Status: prepared, not executed. This runbook is intentionally separated from
the local completion candidate because CT108 is unreachable from the current
network and plugin activation is owner-gated.

## Immutable inputs

- Repository: `OpenCode-Agenten-Oekosystem`
- Expected repository commit for this candidate: `82a38b6f05220994d3d8571aa73ae58f5e426ab4`.
- Compatible Hermes range: `>=0.18.0`; repository-tested version: `0.18.2`.
- Plugin source: `integrations/hermes/`
- Expected source file hashes:
  - `__init__.py`: `d6b59fdf0bccbe468e3948a78a6b3111328c91de4069bf00e599bc621e2aa08f`
  - `gate_hook.py`: `3577b3ad8a68b672528b8e54f5e619c3348b6315f8a503453987813b71d2e7ec`
  - `runtime_client.py`: `0e92b4ef79681c185d49b38bf17f63cd813440ab9533c0e79cb7d84682bd3678`
- Required registration: `ctx.register_hook("pre_tool_call", pre_tool_call_handler)`
- No credentials are part of this package.

## 1. Capture identity and backups on CT108

Run from the approved network with an owner-provided SSH alias and plugin
directory. Keep `CT108_PLUGIN_DIR` outside the repository and verify it before
copying.

```powershell
$env:CT108_HOST = "<owner-provided-ct108-alias>"
$env:CT108_PLUGIN_DIR = "<owner-confirmed-hermes-plugin-directory>"
ssh $env:CT108_HOST "hermes --version; sha256sum \"$env:CT108_PLUGIN_DIR/__init__.py\" \"$env:CT108_PLUGIN_DIR/gate_hook.py\" \"$env:CT108_PLUGIN_DIR/runtime_client.py\""
ssh $env:CT108_HOST "tar -czf /tmp/hermes-governance-backup-$(date -u +%Y%m%dT%H%M%SZ).tgz -C \"$env:CT108_PLUGIN_DIR/..\" \"$(basename \"$env:CT108_PLUGIN_DIR\")\""
```

The owner must replace only the alias and confirmed plugin directory. No
unrelated Hermes or operating-system upgrade is allowed in this run.

## 2. Deploy the exact repository plugin

From the repository root, first record the commit and source hashes:

```powershell
git rev-parse HEAD
Get-FileHash integrations/hermes/__init__.py,integrations/hermes/gate_hook.py,integrations/hermes/runtime_client.py -Algorithm SHA256
```

Then copy only those verified plugin files and any repository-declared plugin
metadata into the owner-confirmed plugin directory:

```powershell
scp integrations/hermes/__init__.py integrations/hermes/gate_hook.py integrations/hermes/runtime_client.py $env:CT108_HOST:"$env:CT108_PLUGIN_DIR/"
```

Immediately compare the remote hashes with the local output. A mismatch is a
`RED_BLOCK`; do not restart.

## 3. Restart and health check

Use the existing CT108 service supervisor, supplied by the owner. Do not
invent a second process or run a foreground duplicate.

```powershell
ssh $env:CT108_HOST "<owner-approved-hermes-restart-command>"
ssh $env:CT108_HOST "hermes --version; <owner-approved-hermes-health-command>"
```

Record process identity, loaded plugin path, plugin hashes, Hermes version,
repository commit, and UTC timestamps.

## 4. Runtime allow and deny canaries

Use the real Hermes `pre_tool_call` path, not a direct Python import.

Allow case:

```text
agent -> pre_tool_call(bounded read_fixture) -> allow -> fixture tool executes -> expected result
```

Deny case:

```text
agent -> pre_tool_call(forbidden write/path escape) -> deny -> tool is not executed
```

The deny canary must include an execution marker proving that the underlying
tool did not run. If the hook is unavailable or the tool executes after deny,
classify `RED_SECURITY_ENFORCEMENT_REGRESSION` and stop.

## 5. Rollback

```powershell
ssh $env:CT108_HOST "<owner-approved-hermes-stop-or-restart-command>"
ssh $env:CT108_HOST "tar -xzf /tmp/<captured-hermes-governance-backup>.tgz -C \"$(dirname \"$env:CT108_PLUGIN_DIR\")\""
ssh $env:CT108_HOST "<owner-approved-hermes-restart-command>"
```

Verify the previous plugin hashes and repeat the health check. Preserve the
backup and runtime evidence; do not delete it autonomously.

## Expected completion evidence

`GREEN_HERMES_CT108_RUNTIME_ENFORCEMENT_VERIFIED` is permitted only when the
same process identity reports the expected plugin hashes and both real allow
and deny canaries pass, with the deny proving no underlying tool execution.
