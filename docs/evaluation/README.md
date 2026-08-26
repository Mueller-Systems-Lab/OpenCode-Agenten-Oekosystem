# Evaluation evidence

This directory contains the frozen Issue #33 harness specification, plans,
results, and retained evidence. It is development/evaluation material, not an
installable product surface.

The stable product decision is deliberately conservative:

- `generic.v1` is the only active and installable model harness.
- `PROMOTED_MODEL_SPECIFIC_PROFILES = 0`.
- HY3 v1/v2 were not promoted because value was not proven.
- Nemotron was rejected after a correctness regression.

The canonical summary is
[`issue-33-final-summary.md`](issue-33-final-summary.md). Raw and intermediate
records remain retained for auditability; they are not part of the normal user
journey.
