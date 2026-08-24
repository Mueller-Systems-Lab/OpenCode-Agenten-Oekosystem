# URL-Only Discovery Canary

The final default branch was cloned from the normal repository URL and the documented dry-run invocation was executed:

`node scripts/bootstrap-project.mjs --target <empty-target>`

The empty target produced the expected `NEEDS_REVIEW` result and exit 1 because there was no target project signal to approve automatically; no apply was performed. The generated plan output was discoverable and named the managed OpenCode paths, agents, skills, policies, MCP selection/trust tiers, backup/rollback flow and reports.

Repository documentation discovery was confirmed for `README.md`, `AI-BOOTSTRAP.md` and `BOOTSTRAP.md`. TTS is documented as out of scope and was not emitted as a current product component.

OpenCode itself was not installed on this host (`opencode` command unavailable), so no live OpenCode apply was simulated.

