# Approval Minimization Report

Governance V2 measures owner interruptions, requests, duplicates, serial rounds, bundling, autonomous decisions, reuse, and time blocked. The target is zero duplicate, serial, and unnecessary requests for the deterministic scenario set. Remaining requests are concrete external/irreversible effects and are emitted as one recommended packet.

The recorded 30-scenario run reports:

```text
V1 owner interruptions: 26
V2 owner interruptions: 1 (0 routine; one bundled owner round)
V2 approval requests: 1, containing 14 bundled decisions; bundled ratio: 1
V2 duplicate requests: 0
V2 serial approvals: 0
V2 unnecessary escalations: 0
V2 autonomous decisions: 10
V2 technical blocks: 6 (unknown/forbidden effects; fail-closed by design)
V2 task success: 1.0; false allow: 0; false block: 0
```

The report is intentionally evidence-led: reproduce it with `node scripts/evaluate-prompt-governance.mjs --json`. The JSON includes the scenario IDs behind owner decisions and prevented routine escalations; counters come from the approval coordinator exercised by that run. The V1 figures are a deterministic compatibility baseline over the same fixtures, not a claim about an unobserved live conversation.
