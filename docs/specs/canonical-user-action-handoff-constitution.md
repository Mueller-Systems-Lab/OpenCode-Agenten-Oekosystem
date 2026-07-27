# Constitution Check — Canonical User Action Handoff

Issue: #18
Risk Tier: `HIGH_HUMAN_GATE`
Context Level at check: `WARM`

## Existing Constitutional Sources

The feature is governed by these existing sources, in precedence order:

1. `governance/policy-core.yaml` and its generated Governance V2 IR
2. `PROMPT-KERNEL.md`
3. `AGENTS.md`
4. `WORKING-METHOD.md`
5. Issue #18 and this specification set

No new competing constitution is introduced. The feature extends Governance V2
with a completion-report contract and keeps the eight-rule prompt kernel limit.

## Non-Negotiable Principles

1. Reality and executable capability evidence prevail over a generic
   `TOOL_GAP` or an agent's self-description.
2. A user action is permitted only when the concrete effect cannot be completed
   by an available, authenticated, permitted, authorized suitable agent or tool.
3. Physical actions, personal/legal decisions, and explicitly non-delegable
   security or owner approvals remain human.
4. Completion reports end with one German section named exactly
   `## Erforderliche Aktion durch den Nutzer`.
5. An empty action set renders exactly
   `Keine Aktion durch den Nutzer erforderlich.`.
6. GitHub user actions use a complete web-UI sequence, never CLI-only guidance.
7. Structured reason codes and capability evidence are mandatory; free text is
   explanatory evidence, not authority.
8. Secrets, PII, credential material, and portable absolute user paths are
   redacted before rendering or persistence.
9. The same semantics must be derived into OpenCode, Hermes, bootstrap, prompt,
   report, and machine-readable completion surfaces.
10. Unknown reason codes, unknown effects, incomplete evidence, contradictions,
    or execution/delegation duplication fail closed.

## Governance Compatibility Decision

- Governance V2 remains authoritative; no legacy phase or blanket approval rule
  may override effect-based authorization.
- Existing `owner_actions` arrays are compatibility inputs only. They are not
  canonical and may not be copied into a user handoff without normalization.
- `VERIFIED_IN_SCOPE` remains a completion classification, not proof that a user
  action is necessary or unnecessary.
- The change requires an ADR because it adds a shared schema and executable
  cross-runtime report boundary.

## Constitution Result

`PASS_WITH_EXTENSION`: the existing constitution is sufficient. The new
contract must be added to canonical Governance V2, not maintained as an
independent prompt-only rule.
