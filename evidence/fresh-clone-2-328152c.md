# FRESH_CLONE_2 — 328152c (HTTPS clone from GitHub, pre-merge candidate) — 2026-09-14

- Source: git clone https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem.git @ 328152c, clean (0 dirty)
- Version truth: manifest 1.1.0
- Build: uv build --wheel → dist/ocae_cli-1.1.0-py3-none-any.whl PASS
- Payload: canonical-runtime.tar.gz, 10/10 canonical swarm files; payload manifest package_version=1.1.0, source_commit=328152cb8206…
- Canonical subset: --group swarm → FINAL_STATUS: PASS
- Installer: --apply → OK; second apply → "No changes required; installation is already current (idempotent apply)"
- Runtime: .opencode/tools/swarm.ts + .opencode/agents/{swarm,swarm-worker}.md present
