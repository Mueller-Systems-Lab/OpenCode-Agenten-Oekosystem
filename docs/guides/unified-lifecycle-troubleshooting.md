# Unified Lifecycle Troubleshooting

| Result | Meaning | Safe next action |
| --- | --- | --- |
| `TARGET_PATH_UNSAFE` / `RED_BLOCK` | Target or managed path is missing, special, or a symlink. | Use a real project directory; do not replace the path or link automatically. |
| `OWNER_CONTENT_CONFLICT` | A managed hash differs or an unowned file conflicts. | Review the owner change and use the component installer only with an explicit owner decision. |
| `RUNTIME_NOT_FOUND` / `TOOL_GAP` | No supported project runtime or local CLI could be safely detected. | Install/select a supported project-local runtime, then rerun `verify`. |
| `HOOK_REGISTERED_UNPROVEN` | A bridge file exists but hook invocation was not observed. | Run the disposable real-runtime procedure; do not call it active yet. |
| `RESTART_UNPROVEN` | Controls ran without a genuine new runtime process. | Stop and start the isolated runtime, then repeat both controls. |
| `BYPASS_RISK` | Known launch paths were not fully covered or a bypass is open. | Review launcher, direct CLI, plugins, subprocesses, MCP, and direct imports. |
| `METRICS_WRITE_UNAVAILABLE` | The optional local metrics destination is unsafe or unavailable. | Use `--no-metrics` or a safe project-local `--metrics` path. |
| `Registry JSON is corrupted` | The explicit local registry is not a valid OCAE registry. | Restore a known-good local registry; never force the CLI to overwrite it. |

For a component-specific rollback, retain the backup path produced by that
component and select `--layer overlay` or the default `--layer governance`.
`remove` only removes a registry entry; it never removes target governance
files.
