# FRESH_CLONE_1 — f139e42 (clean disposable clone) — 2026-09-14

- Source: git clone → /tmp/opencode/fresh-clone-1 @ f139e42, worktree clean (0 dirty)
- Version truth: ecosystem.manifest.json 1.0.7 (pre-bump candidate, consistent)
- Build: uv build --wheel → dist/ocae_cli-1.0.7-py3-none-any.whl PASS
- Payload: canonical-runtime.tar.gz 198 files, 10/10 canonical swarm files present
  (SKILL.md, blackboard.py, swarm.ts, swarm.md, swarm-worker.md, swarm-ui/*, install.py, protocol.md, openai.yaml)
- Payload manifest: package_version=1.0.7, source_commit=f139e429317b…, archive_sha256=5a169af280427ac2…
- Release gate fail-closed: `build_backend.py check-release --manifest-version 1.0.7` without tag → FAIL (correct)
- Canonical subset: node scripts/run-tests.mjs --group swarm → FINAL_STATUS: PASS (EXIT_CODE 0)
- Installer: install-governance.mjs --apply → 15 agents (13 source + swarm + swarm-worker),
  .opencode/tools/swarm.ts present, source-lock 151 files
- Idempotency: second apply → "No changes required; installation is already current (idempotent apply)"
