# OCAE Product Realignment Plan

Status: locally implemented; the canonical all-groups runner termination gap is
fixed and locally verified. Final classification remains
`AMBER_OCAE_URL_INSTALL_PRODUCT_REALIGNMENT_PARTIAL` pending published-URL
verification.
Source of truth: owner request and GitHub issue #33, with local repository
reality used for installer/runtime facts.

## Product invariant

`OCAE_IS_AN_OPENCODE_URL_INSTALLABLE_AGENT_ECOSYSTEM`

A supported OCAE release must be reproducibly installable into a fresh
OpenCode-compatible project from the canonical HTTPS repository URL without
developer-private filesystem state or credentials. OpenCode remains the host;
OCAE contributes installed agents, governed runtime, policies, harness
profiles, and host-capability discovery.

## Validated starting facts

- The canonical source URL is
  `https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem`.
- `bootstrap.mjs` is the URL/ref/provenance launcher; its installer is
  `scripts/install-governance.mjs` and its verifier is `bootstrap/verify.mjs`.
- The installer already copies agents, skills, policies, governance runtime,
  routing, and the Issue #33 harness files into the target.
- The installer currently also copies `runtime/harness/evaluation.mjs`, and
  the default harness registry contains candidate profiles. These are the
  portability/product-boundary gaps addressed here.
- Existing isolated installer and harness tests are green before this run.
- A fresh isolated target has no developer auth store and still installs;
  OpenCode agent discovery passes with `opencode agent list --pure`.

## Artifact policy

| Class | Contract |
|---|---|
| Installable product runtime | `runtime/run.mjs` and its governed runtime dependencies, excluding evaluation runner code |
| Installable agent definitions | `.opencode/agents/*.md` |
| Installable governance | `.opencode/policies/**`, `.agent-governance/**`, installed hook/plugin |
| Installable harness profiles | generic profile always; only explicitly promoted model profiles |
| Installable plugin/tool integration | OpenCode governance plugin and capability/MCP preflight policy; external MCPs remain host capabilities |
| Installer/bootstrap | canonical manifest, launcher, installer, verifier, source provenance and rollback contract |
| Development/test infrastructure | `test/**`, canonical test runner, sentinel checks, development-only scripts |
| Evaluation-only | candidate registry, evaluation module/runner, benchmark corpus and evaluation reports |
| Local developer state | `.git/**`, `.opencode/memory/**`, Playwright session state, private auth/config stores, credentials |
| Volatile evidence | temporary logs, raw benchmark outputs, session evidence and install-local audit data |

## Audit classifications

- `runtime/mcp/server-registry.mjs`: optional external host capability. Global
  config discovery is derived from `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`,
  and the host environment; it is not required for installation or core
  readiness.
- `runtime/routing/model-catalog.mjs`: provider/model identifiers are routing
  metadata supplied by the OpenCode host. It does not own credential storage.
- `scripts/run-governed-opencode.mjs`: development/validation launcher; its
  home/config references are explicitly outside the installed runtime.
- `runtime/harness/model-harness-profiles.mjs`, `runtime/harness/evaluation.mjs`,
  and `scripts/run-issue-33-live-evaluation.mjs`: evaluation-only candidate
  machinery; they are not in the installer runtime file list.
- `hy3`, `muse`, `nemotron`, `mimo`, and related model IDs: test/evaluation or
  catalog fixtures, never installation prerequisites. Unknown routed models
  use `generic.v1`.
- Developer auth stores, PATs, SSH keys, `.git`, memory, Playwright state, and
  absolute checkout paths: local developer state; isolated acceptance tests
  prove they are not needed by installation.

## Verification Contract

### Desired Behavior

Fresh isolated OpenCode targets install the core OCAE ecosystem from the
canonical URL contract, discover the installed agents, load governance and
the generic harness, and report provider/tool availability separately from
core installation. Candidate/evaluation machinery is not installed by
default. Existing #33 routing, resolver, authority, and generic-fallback
behavior remains intact.

### Acceptance Criteria

1. The canonical manifest explicitly describes product artifact classes,
   product invariant, host boundary, capability-status semantics, and the
   evaluation exclusion list.
2. The installed runtime contains the generic harness and any promoted
   product profiles, but not the evaluation runner or candidate-only registry.
3. The post-install verifier reports `CORE_READY`, provider/tool status, and
   blockers without requiring provider credentials or reading secret contents.
4. An isolated temporary HOME/XDG install succeeds with no auth store, PAT,
   SSH key, or developer checkout path dependency.
5. OpenCode discovers all installed OCAE agents from the fresh target using
   the locally available pure discovery mode.
6. Unknown models resolve to the installed generic harness; candidate
   evaluation remains an explicit development-only path.
7. Existing URL, installer, runtime, harness, security, governance, and
   sentinel tests remain green.

### Red Tests

1. `test/install/product-realignment.test.mjs` asserts the missing artifact
   classification and evaluation exclusion contract against the current
   baseline.
2. The same test asserts the missing post-install capability status fields
   and candidate-free installed product registry.
3. The same test exercises isolated OpenCode agent discovery and fails until
   the fresh-environment proof is part of the acceptance suite.

### Regression Tests

- `test/bootstrap/url-only-contract.test.mjs`
- `test/install/agent-installation.test.mjs`
- `test/install/fresh-install-sentinel.test.mjs`
- `test/harness/*.test.mjs`
- `test/controller/production-sentinel.test.mjs`
- `node scripts/validate-ecosystem.mjs`
- full canonical test manifest, with the existing termination gap reported
  separately if it recurs

### Reality Gate

Run the installer in an isolated temporary HOME/XDG environment, verify the
target with `bootstrap/verify.mjs`, import the installed runtime and harness,
and run `opencode agent list --pure` from the target. No real user OpenCode
configuration is modified.

### Evidence Types

| Evidence | Source | Collection |
|---|---|---|
| Dirty-state preservation | Git | `git status --short`, `git diff --stat`, reviewed diff |
| Contract proof | Node tests | focused red/green and regression test output |
| Install proof | Installer/verifier | isolated target JSON reports and exit codes |
| OpenCode discovery | OpenCode 1.18.22 | `opencode agent list --pure` in isolated target |
| Security boundary | source audit/tests | path/credential scans and existing security tests |
| Architecture truth | docs/manifest | invariant, ADR/spec/manifest diff |

### Untestable Assumptions

| Assumption | Why untestable here | Risk |
|---|---|---|
| A fresh user has a usable external model/provider | Provider service and host auth are external | Core install can be ready while a real task is unavailable; this is reported, not greened |
| Non-pure OpenCode discovery behavior | The local CLI hangs without `--pure` in this environment | Full live OpenCode operation remains a separate tool/host gap |
| GitHub authenticated writes | `gh` is unavailable; issue reads work through REST and GitHub connector | Start comment is posted; PR/push are out of scope for this run |

### Completion Claim Gate

- [x] Product acceptance criteria and red tests pass after implementation
- [x] Focused regression tests, sentinel, documentation, and governance checks pass
- [x] Isolated reality gate passes; live provider capability remains external
- [x] Evidence is collected without exposing secret contents
- [x] Diff and unrelated dirty files reviewed; no commit or destructive cleanup performed
- [x] All-groups runner completes with the full canonical manifest (1,300 tests, 0 failures)
- [ ] Canonical remote URL install remains pending
- [ ] Issue #33 completion comment is posted after the final local classification
