# SPDX-License-Identifier: MIT
"""Canonical Agent Governance — Hermes Runtime Enforcement Plugin.

Entry point for installation via:
    hermes plugins install https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem

Registers the pre_tool_call enforcement hook and the /governance-* slash
commands with the Hermes plugin context.
"""


def register(ctx):
    """Register hooks and commands with the Hermes plugin context."""
    from .integrations.hermes.gate_hook import (
        pre_tool_call_handler,
        governance_install,
        governance_status,
        governance_doctor,
        governance_rollback,
    )

    ctx.register_hook("pre_tool_call", pre_tool_call_handler)

    ctx.register_command(
        "governance-install",
        governance_install,
        "Install governance into current project",
    )
    ctx.register_command(
        "governance-status",
        governance_status,
        "Show governance enforcement status",
    )
    ctx.register_command(
        "governance-doctor",
        governance_doctor,
        "Diagnose governance installation",
    )
    ctx.register_command(
        "governance-rollback",
        governance_rollback,
        "Rollback governance installation",
    )
