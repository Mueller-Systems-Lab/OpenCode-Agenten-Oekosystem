# TTS_SCOPE_RECONCILIATION
Baseline searched: `82a38b6f05220994d3d8571aa73ae58f5e426ab4` plus the uncommitted R2 delta. Search terms were case-insensitive: `tts`, `speech`, `audio`, `voice`, `synthesis`, `prompt summary`, `prompt-summary`, `tts.summary`, `tts.result`, and `DEGRADED_TTS_TEXT_FALLBACK`.

| Datei/Änderung | TTS-only | gemischt | behalten | entfernen | Begründung |
| --- | ---: | ---: | ---: | ---: | --- |
| `runtime/tts/summary.mjs` | ja | nein | nein | ja | R2-only summary, redaction-for-summary, local engine adapter, audio output, and fallback. |
| `scripts/run-completion-canary.mjs` | nein | ja | ja | ja | Keep MCP/start/resume/policy canaries; remove TTS import, execution, report field, and R2 evidence target. |
| `test/contracts/completion-runtime-contracts.test.mjs` | nein | ja | ja | ja | Keep N1–N10, resume, start, and observability coverage; remove the two TTS tests/imports. |
| `runtime/observability/events.mjs` | nein | ja | ja | ja | Keep generic governed events; remove only `tts.summary` and `tts.result`. |
| `scripts/validate-ecosystem.mjs` | nein | ja | ja | ja | Keep validator and runtime closure requirements; remove `runtime/tts/summary.mjs` from required production lists. |
| `docs/architecture/local-completion-runtime.md` | nein | ja | ja | ja | Keep local runtime documentation; replace TTS section with explicit scope boundary. |
| `ecosystem.manifest.json` | nein | nein | ja | nein | No R2 TTS capability/profile/configuration found. |
| `test/test-manifest.json` | nein | nein | ja | nein | Completion contract file remains required; its non-TTS tests stay. |
| `runtime/agent/*`, `scripts/lib/mcp-preflight.mjs` | nein | nein | ja | nein | Core completion functions have no TTS dependency. |
| `docs/run-cards/hermes-ct108-runtime-closure-package.md` | nein | nein | ja | nein | CT108 package concerns Hermes runtime only; update only if source commit/hash inputs change. |
| `evidence/completion-r2-20260811/**` | historical | nein | ja | nein | Immutable historical evidence; contains R2's incorrect TTS claim and is labeled out of production baseline by this R3 report. |
| `evidence/completion-refresh-20260811/**` | historical | nein | ja | nein | Immutable prior-run evidence; not production code or current baseline. |
| `evidence/completion-canary-r2/**` | historical | nein | ja | nein | Immutable R2 canary output including TTS events; R3 writes a separate canary directory. |
| `docs/reports/url-installer-runtime-enforcement-research.md` | external research mention | nein | ja | nein | Pre-existing research reference to another integration surface; not loaded product code and not introduced by R2. |
| `docs/reports/odysseus-integration-research.md` | external research mention | nein | ja | nein | Pre-existing external ecosystem inventory; not this project's production architecture. |

## Historical evidence notice

The R2/refresh/canary TTS artifacts are `HISTORICAL_OUT_OF_SCOPE_ARTIFACT`. They remain unchanged to preserve run history and are not part of the Production Baseline. `REMAINING_PRODUCT_TTS_REFERENCES` is measured only over productive runtime, manifest, current tests, current canary implementation, and current architecture documentation.
