# OpenCode Native Compatibility Baseline

Status: implementation contract for native OpenCode functionality restoration.

## Goal

OCAE governs concrete effects without removing normal local OpenCode
functionality. A native operation that is local, bounded to the target root,
non-secret, and reversible remains autonomous after task bootstrap. External,
publication, deployment, destructive, and secret effects remain governed.

## Reality refresh

- Repository: `C:\OpenCode-Agenten-Oekosystem`
- Branch: `fix/global-adapter-startup-regression`
- OpenCode runtime: `1.18.18` (local `opencode --version`)
- Current regression: the shell fallback maps almost every command to
  `LOCAL_EXECUTE` + `UNKNOWN_REVERSIBILITY`; the approval engine then blocks
  it. This affects inspection, build, Git read, package, publish, and release
  commands.
- Existing task-bootstrap, source-lock, target-root, secret, and external
  approval boundaries are retained.

## A/B compatibility matrix

| Native capability | Clean OpenCode baseline | Current OCAE | Restored OCAE contract | Evidence |
|---|---|---|---|---|
| Chat/startup | native | provider-dependent | unchanged | OpenCode 1.18.18/plugin contract |
| Plan/delegate | native | cold `task` can be capsule-blocked | read-only delegation allowed cold; child ceiling remains bounded | compatibility test |
| Read/grep/glob/skill | native | aliases work; shell inspection blocks | autonomous local inspection | classifier test |
| Write/edit/patch | native | bootstrap-dependent | automatic bootstrap + bounded local write | task-bootstrap tests |
| Bash/PowerShell inspection | native | generic unknown shell effect | deterministic parser and local inspection effect | classifier test |
| Build/test | native | generic unknown shell effect | bounded local build/test effects | classifier test |
| Git read/fetch/commit | native | read/fetch generic unknown or capsule-blocked during startup | Git read, bounded cold `git fetch`, and local Git write classes | classifier test |
| Push/merge/release/publish/deploy | native | mixed generic or gated | remains owner-gated by concrete effect | security matrix |
| Secrets/destructive filesystem | native tool exists | must remain blocked | fail closed | security matrix |

Provider-backed chat and full model-driven OpenCode E2E require a configured
provider and are not executable in this repository-only test run. The local
contract test still checks the installed OpenCode 1.18.18 plugin shape and the
actual resident installer/runtime path.

## Acceptance criteria

1. The classifier deterministically parses quoted arguments, PowerShell, cmd,
   Bash, pipes, and chained commands, combining a compound command by maximum
   effect.
2. Known local inspection, build, test, package, generation, and Git commands
   never fall through to unknown reversibility.
3. Unknown commands remain fail-closed.
4. Cold local inspection and safe read-only delegation pass without a manual
   Task Capsule.
5. The mandatory bounded Reality Refresh (`git fetch origin --prune` plus local
   Git reads) passes before Task Capsule bootstrap; arbitrary remote URLs do not.
6. A bootstrapped local build, test, write, and local Git commit are autonomous
   inside the target scope.
7. Secret access, destructive filesystem commands, push, merge, release,
   publish, workflow execution, and deployment remain blocked or owner-gated.
8. A resident installation includes the classifier and generated capability
   registry, and its behavior matches the source runtime.

## Verification contract

- Red tests: `test/compatibility/opencode-native-compatibility.test.mjs`
- Regression tests: existing approval, bootstrap, security, installer, and
  runtime-closure groups.
- Runtime gate: `node scripts/validate-ecosystem.mjs` and focused test groups.
- Out of scope: disabling governance, broad allow-all capsules, automatic
  remote mutation, secret reads, release publishing, or moving existing tags.
