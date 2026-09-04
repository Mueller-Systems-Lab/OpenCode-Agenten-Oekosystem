# Issue #43 free-model DEBUG log differential

Experiment: `issue-43-free-model-observation-canary-opencode-big-pickle-20260904T121500Z`
Target: `opencode/big-pickle`
OpenCode: `1.18.27`

The traces below are sanitized extracts. Timestamps, request IDs, and temporary paths are omitted or normalized where present.

## Differential interpretation

- CONTROL_0: not captured
- IDENTITY: not captured
- ENVELOPE: not captured
- Exact OpenCode internal message roles and provider request payload ordering are not exposed by this CLI surface; message role is therefore UNOBSERVABLE.
- The observable CLI event order and adapter trace order are retained in the evidence JSON; any provider-side resume ordering beyond that boundary is not inferred.
