# PR Reconciliation Matrix

## PR facts

| PR | Status | Base | Head | Scope | Reviews / CI |
| --- | --- | --- | --- | --- | --- |
| #17 | open, mergeable, not draft | `master` / `f2b448963e632890973f8e697af780ffeedeb640` | `b2718d753d6bcc1655e46143f044880e622c6b95` | 51 files, +4232/-75; unified lifecycle and runtime activation proof | no submitted reviews; OpenCode Security Review failed |
| #19 | open, mergeable, draft, stacked on #17 | PR #17 / `b2718d753d6bcc1655e46143f044880e622c6b95` | `d67ce035ff0d1419686e0d21a86e2e089c928538` | 51 files, +3818/-42; canonical user-action handoff | no submitted reviews; OpenCode Security Review failed |

Both PRs are based on an older master point. Neither was merged or used as a
second implementation source.

## Gap matrix

| Gap | master | PR #17 | PR #19 | Entscheidung |
| --- | --- | --- | --- | --- |
| Agent capability profiles | agent catalog only; no per-agent contract | no `required_tools` / `optional_tools` profile system | no capability profile system | `NEEDS_NEW_IMPLEMENTATION` |
| Mandatory MCP preflight | absent | generic/kernel preflight only; no MCP agent-start invariant | handoff validation only | `NEEDS_NEW_IMPLEMENTATION` |
| MCP negative enforcement | guarded MCP call exists | runtime proof focuses lifecycle/activation | no MCP preflight proof | `NEEDS_NEW_IMPLEMENTATION` |
| Generic restart/resume state | approval replay only | lifecycle status/run metrics, not requested generic state | no generic state | `NEEDS_NEW_IMPLEMENTATION` |
| TTS | absent | absent | absent | `NEEDS_NEW_IMPLEMENTATION` |
| Governance observability for new paths | partial evidence/run cards | runtime proof evidence | handoff evidence | `NEEDS_NEW_IMPLEMENTATION` |
| Hermes source hook | present in master | adds runtime activation proof surfaces | reused/propagated | `REUSE_FROM_MASTER`; CT108 still owner-gated |
| Windows path portability | partial drift | changes runner assertions, not these path defects | no relevant correction | `NEEDS_NEW_IMPLEMENTATION` |
| User-action handoff | partial/current master baseline | not present | PR #19 implementation | `OWNER_MERGE_DECISION_REQUIRED` |
| Unified lifecycle | absent from current master | PR #17 implementation | depends on PR #17 | `OWNER_MERGE_DECISION_REQUIRED` |
