# Hermes Bootstrap Assets

This directory contains portable project-local assets for Hermes Agent.

## Use

- treat the files as a bundle source
- keep the global Hermes home directory untouched
- enable only the skills and MCPs you actually need

## Layout

- `skill-bundles/` — Native YAML skill bundles for Hermes Agent (e.g. `canonical-working-method.yaml`)
- `bundles/` — JSON bootstrap manifests for the OpenCode bootstrap workflow (not native Hermes bundles)
- `mcp/` — MCP gateway handoff notes
- `skills/` — Individual Hermes skill markdown files
- `config.example.yaml` — Example Hermes Agent configuration referencing the YAML bundle

## Native YAML Bundles

Hermes-native skill bundles are defined as YAML files in `skill-bundles/`. Each bundle includes a list of skills and a multi-line `instruction` field that Hermes loads as a system prompt. Use these instead of listing skills on the command line when you need the full canonical workflow.

The canonical bundle also enforces the German terminal section
`## Erforderliche Aktion durch den Nutzer`. Only structured, capability-proven
`non_delegable_user_actions` are allowed; the empty state is exactly
`Keine Aktion durch den Nutzer erforderlich.`.

## JSON vs YAML

- Files in `bundles/` (`.json`) are **internal bootstrap manifests** consumed by the Node.js bootstrap scripts, not by Hermes directly.
- Files in `skill-bundles/` (`.yaml`) are **native Hermes skill bundles** that Hermes can load natively.
