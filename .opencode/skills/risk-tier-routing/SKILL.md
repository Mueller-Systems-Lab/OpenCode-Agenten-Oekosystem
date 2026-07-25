---
name: risk-tier-routing
description: Dynamically assesses task risk and routes to the appropriate workflow modules. Selects required safety, cost, infrastructure, product, documentation, and runtime modules based on task characteristics. Full Speckit only for HIGH tier and above.
compatibility: opencode
metadata:
  hermes: compatible
  risk_tier: all
---

## When To Use

Use this skill during run card creation, before workflow phases are selected. Every task must be risk-assessed before the execution plan is finalised.

Do NOT use this skill for:
- already-classified emergency hotfixes (use CRITICAL_BLOCK directly)
- read-only investigation with no filesystem writes (defaults to LOW_LOCAL)
- pure documentation-only tasks (defaults to LOW_LOCAL)

## Workflow

1. **Assess task characteristics against risk criteria.**
   - Collect: number of files affected, external systems involved, data sensitivity, reversibility, infrastructure impact, cost implications.
   - Cross-reference with the Risk Assessment Matrix below.

2. **Assign risk tier.**
   - Select one of: `LOW_LOCAL`, `MEDIUM_REVIEW`, `HIGH_HUMAN_GATE`, `CRITICAL_BLOCK`.
   - If multiple criteria match different tiers, use the HIGHEST tier.

3. **Select required workflow modules per tier.**
   - Use Module Selection Per Tier table.
   - Mark each module as `required`, `optional`, or `skipped`.

4. **Route to conditional modules.**
   - Based on the tier and specific risk indicators, activate any of:
     - safety module (if sensitive data or destructive operations)
     - cost module (if cloud resources or paid API usage)
     - infrastructure module (if Docker, network, or deployment changes)
     - compliance module (if PII, DSGVO/GDPR, or regulated data)
     - documentation module (if API or architecture changes)
     - runtime module (if language runtime, dependency, or build changes)

5. **Document rationale for tier assignment.**
   - Record which criteria triggered the tier.
   - Justify any skipped modules.
   - Note assumptions and uncertainties.

## Risk Assessment Matrix

| Criterion | LOW_LOCAL | MEDIUM_REVIEW | HIGH_HUMAN_GATE | CRITICAL_BLOCK |
|---|---|---|---|---|
| **Files affected** | 1–3 files | 4–10 files | 11–30 files | 30+ files or unknown scope |
| **External system involvement** | None | Read-only API calls | Read-write API calls, MCP servers | Production database, third-party credentials, finance systems |
| **Sensitive data presence** | No PII, no secrets | Internal business data | PII, DSGVO-relevant data, API tokens | Health records, payment data, classified credentials |
| **Reversibility** | Full rollback via git | Rollback possible with manual steps | Rollback complex, data migration involved | Irreversible (DROP TABLE, DELETE, data destruction) |
| **Infrastructure impact** | Local only, no infra changes | Dev environment only | Staging or shared environment | Production deployment, DNS, TLS, load balancer |
| **Cost implications** | None | Minimal (CI minutes, minor compute) | Moderate (cloud resources, paid API calls) | Significant (provisioning, long-running jobs, third-party contracts) |

### Tiebreaker Rule

If criteria span multiple tiers, assign the HIGHEST applicable tier. Use the highest tier present in ANY criterion, not the average.

### Downgrade Prohibition

A task MUST NEVER be downgraded to a lower tier to skip required workflow modules. If the assessment produces `HIGH_HUMAN_GATE`, the task runs with `HIGH_HUMAN_GATE` modules — no exceptions.

## Module Selection Per Tier

| Module | LOW_LOCAL | MEDIUM_REVIEW | HIGH_HUMAN_GATE | CRITICAL_BLOCK |
|---|---|---|---|---|
| **Speckit (full spec-driven development)** | skipped | optional | required | required (stop after diagnosis) |
| **Read Before Sketch** | optional | required | required | required |
| **Reality Refresh** | optional | required | required | required |
| **Run Card** | optional | required | required | required |
| **Security Evidence Gate** | skipped | optional | required | required |
| **Compliance / Privacy** | skipped | optional | required | required |
| **Infrastructure Review** | skipped | optional | required | required (stop after diagnosis) |
| **Cost Impact Analysis** | skipped | optional | required | required |
| **Documentation Update** | optional | optional | required | required (diagnosis only) |
| **Test Enforcement** | required | required | required | required (diagnosis only) |
| **Architecture Review / ADR** | skipped | optional | required | required |
| **Checkpoint & Rollback** | optional | required | required | required |
| **Review Agent** | optional | required | required | required |
| **Human Approval Gate** | not needed | not needed | required | required |

### CRITICAL_BLOCK Behaviour

`CRITICAL_BLOCK` tasks **must stop immediately with diagnosis**. No further phases (implementation, testing beyond diagnosis, deployment) may proceed.

Allowed actions after `CRITICAL_BLOCK` assignment:
- Produce a diagnosis report with findings
- Record the block reason and evidence
- Escalate to a human with the full diagnosis

Prohibited actions after `CRITICAL_BLOCK` assignment:
- Any filesystem write (even dry-run patches)
- Any network write operation
- Any database mutation
- Any module execution beyond diagnosis

### Module Overrides

A required module for a given tier may only be skipped when:
1. The module's subject matter does not apply (e.g., no data means skip Compliance).
2. The rationale is explicitly documented in the tier assignment.
3. The override is marked as `ASSUMPTION` in the documentation.

## Inputs

- **task description**: Free-text description of the work to be done
- **scope**: Explicit boundaries (what is included and excluded)
- **affected files**: List of files that will be created, modified, or deleted
- **external system list**: All external APIs, MCP servers, databases, or services involved
- **data sensitivity classification**: One of `none`, `internal`, `pii`, `health`, `payment`, `credentials`, `classified`
- **existing project risk profile**: From `ecosystem.manifest.json`, `SECURITY.md`, and `data-retention.json`

## Outputs

- **risk tier classification**: One of `LOW_LOCAL`, `MEDIUM_REVIEW`, `HIGH_HUMAN_GATE`, `CRITICAL_BLOCK`
- **required module list**: Modules marked `required` for the assigned tier
- **skipped module list**: Modules marked `skipped`, with rationale
- **optional module list**: Modules marked `optional`, with selection notes
- **rationale document**: Short markdown block explaining which criteria triggered the tier, any override decisions, and remaining uncertainties
- **conditional routing decisions**: Which conditional modules (safety, cost, infrastructure, compliance, documentation, runtime) are activated

### Output Example

```markdown
## Risk Tier Routing

**Tier:** HIGH_HUMAN_GATE

**Triggered by:**
- PII fields in affected data model (adopter entity)
- 15 files affected across models, controllers, and views
- External MCP server (PostgreSQL, read-write)
- Complex rollback (data migration with seed data)

**Required modules:**
- Speckit (full spec-driven development)
- Read Before Sketch
- Reality Refresh
- Run Card
- Security Evidence Gate
- Compliance / Privacy
- Infrastructure Review
- Cost Impact Analysis
- Documentation Update
- Test Enforcement
- Architecture Review / ADR
- Checkpoint & Rollback
- Review Agent
- Human Approval Gate

**Conditional modules activated:**
- compliance (PII present)
- infrastructure (MCP server involved)
- cost (PostgreSQL cloud costs)

**Rationale:**
Mixed criteria: data sensitivity triggers HIGH, files affected triggers MEDIUM, external system triggers HIGH.
Highest applicable tier assigned per tiebreaker rule. No downgrade applied.
```

## Security Boundaries

- **Never downgrade risk to skip required modules.** If assessment yields `HIGH_HUMAN_GATE`, the full module set for `HIGH_HUMAN_GATE` must be used.
- **Never skip the Security Evidence Gate or Compliance module for tasks involving PII, health data, payment data, or credentials.** These are non-negotiable.
- **Always document rationale.** Every tier assignment, module skip, and conditional routing decision must be recorded.
- **CRITICAL_BLOCK tasks must stop immediately.** No further phases beyond diagnosis are permitted. Implementation is forbidden regardless of subsequent findings.
- **Tiebreaker always goes to the higher tier.** When criteria overlap tiers, the highest tier wins. This is not negotiable.
- **External module routing must not bypass write-protection policies.** See `.opencode/policies/write-protection.json`.
- **If data sensitivity cannot be determined, default to the highest plausible tier.** Assume PII until proven otherwise.

## Completion Criteria

- [ ] Risk tier is assigned and documented with criteria evidence
- [ ] Required modules are selected per tier assignment
- [ ] Skipped modules include written justification
- [ ] Optional modules are explicitly selected or declined with reasoning
- [ ] Conditional modules are activated or suppressed with rationale
- [ ] CRITICAL_BLOCK tasks end after diagnosis — no implementation started
- [ ] Rationale document is attached to the run card
- [ ] No prohibited downgrades or overrides present
