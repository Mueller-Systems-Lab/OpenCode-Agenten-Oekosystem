# ADR: Governance V2 — Thin Prompt, Thick Runtime

Status: Accepted for this migration

The permanent OpenCode instruction surface is reduced to `PROMPT-KERNEL.md`. Detailed policy is loaded lazily from the canonical `governance/policy-core.yaml` and its deterministic generated capability/risk artifacts. Authorization is enforced by executable effect classification, scope checks, lease/receipt validation, and fail-closed unknown-effect handling.

This keeps security and evidence gates executable while allowing agents to decide routine technical details autonomously. `WORKING-METHOD.md` remains a reference for evidence and risk context; it no longer independently creates approval phases.
