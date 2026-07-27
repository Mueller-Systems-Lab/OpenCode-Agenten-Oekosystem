# Independent Review — Canonical User Action Handoff

**Date:** 2026-07-27
**Mode:** independent, read-only, leaf review
**Decision:** approved in reviewed scope; no open critical, high, or otherwise
blocking finding.

The first reviewer exhausted its execution quota after reporting and retesting
the initial findings. A replacement independent read-only reviewer completed
the final review. Neither reviewer modified repository files.

## Initial Review Findings

| ID | Severity | Evidence / reproduction | Affected area | Decision and fix | Retest |
| --- | --- | --- | --- | --- | --- |
| REV-UAH-001 | HIGH | installed runtime omitted the canonical module/schema | installer | include runtime module, schema and install-report handoff | PASS |
| REV-UAH-002 | HIGH | machine JSON could retain unredacted handoff values | renderer/runtime | sanitize before machine serialization; reject raw unredacted input | PASS |
| REV-UAH-003 | HIGH | a generic button could satisfy GitHub navigation/confirmation | web validator | require navigation, action button, explicit confirmation and ordering | PASS |
| REV-UAH-004 | MEDIUM | generated AGENTS referenced a schema absent from bootstrap target | bootstrap | generate the project-local canonical schema mirror | PASS |
| REV-UAH-005 | MEDIUM | parity assertions were mainly textual | tests | add behavioral OpenCode/Hermes/bootstrap/schema checks | PASS |
| REV-UAH-006 | MEDIUM | repository overlay lacked canonical machine/Markdown completion | overlay | write both reports through the canonical handoff | PASS |
| REV-UAH-007 | HIGH | GitHub target schema allowed an unknown object without PR/issue/branch | JSON Schema | require repository plus one concrete target object | PASS |
| REV-UAH-008 | HIGH | explicit malformed actions became an empty handoff; unknown top fields survived | runtime/closure/registry | reject non-array input and unknown fields before normalization | PASS |
| REV-UAH-009 | MEDIUM | reversed external ordering validated and rendered input order | runtime | reject noncanonical external order; stable producer normalization | PASS |
| REV-UAH-010 | HIGH | runtime accepted schema-invalid scalar types | runtime | enforce strings, booleans, arrays, integers and optional-field types | PASS |
| REV-UAH-011 | MEDIUM | confirmation could precede navigation | web validator | require every navigation/action control before confirmation | PASS |
| REV-UAH-012 | MEDIUM | media, root and WSL paths escaped portable redaction | redaction | cover Linux/macOS/Windows/WSL/media/root user prefixes | PASS |
| REV-UAH-013 | HIGH | a GitHub target could be disguised as `manual` | delegation validator | infer GitHub targets and require `github_web` | PASS |
| REV-UAH-014 | MEDIUM | explanatory prose mentioning `gh` was treated as a command | Markdown validator | constrain command detection to instruction-shaped content | PASS |
| REV-UAH-015 | MEDIUM | fenced examples counted as live final sections | Markdown validator | mask fenced blocks while preserving heading offsets | PASS |
| REV-UAH-016 | MEDIUM | English action prose passed with German metadata | language validator | validate handoff prose while exempting visible technical UI labels | PASS |

## Final Review Findings

| ID | Severity | Evidence / reproduction | Affected area | Decision and fix | Retest |
| --- | --- | --- | --- | --- | --- |
| REV2-UAH-011 | HIGH | authorization flags could contradict unavailable capabilities | capability evidence | add monotonic availability/authentication/permission/authorization rules | PASS |
| REV2-UAH-012 | MEDIUM | runtime ignored schema `maxLength: 512` and non-GitHub `web_ui` | schema/runtime parity | enforce length and forbid `web_ui` outside `github_web` in both layers | PASS |
| REV2-UAH-013 | MEDIUM | `official_docs` did not disclose missing live UI verification | renderer | emit an explicit German non-live note | PASS |
| REV2-UAH-014 | HIGH | canonical bootstrap verifier emitted completion without a handoff | bootstrap verifier | integrate JSON, human, early-return and source-only paths | PASS |
| REV2-UAH-015 | HIGH | path-qualified/wrapped Git and `gh` commands bypassed detection | CLI validator | detect absolute paths and `sudo`, `env`, `command`, and shell prefixes | PASS |

## Final Retest Evidence

- Independent sequential focused suite: 82/82 passed.
- Ecosystem validator: `VERIFIED_IN_SCOPE`.
- Governance generation: `GOVERNANCE_GENERATION_CHECK_OK 4`.
- `git diff --check`: passed.
- Bootstrap source-only JSON: valid structured empty handoff.
- Bootstrap human verification: exact canonical terminal section.
- Protected-surface scan: no changes to `.github/workflows`, `SECURITY.md`,
  `.opencode/policies`, `.opencode/agents`, or `.opencode/skills`.
- No credential, private-worktree, `.env`, or database artifact finding.
- Dependency base remained
  `b2718d753d6bcc1655e46143f044880e622c6b95`.

The reviewer explicitly found no open critical/high or otherwise blocking
finding. Remote SHA and fresh-clone evidence remain separate post-push gates.
