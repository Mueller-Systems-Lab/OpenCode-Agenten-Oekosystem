# Restart and TTS Evidence

## Restart

Approval receipts have process-restart replay protection and a parallel
double-consume race test. The current `master` branch does not provide a
generic persistent agent run state containing the requested project/run/task,
execution, commit, gate, preflight, configuration-hash, and handoff fields.
No end-to-end interrupt-and-resume can therefore be claimed.

## TTS

No local TTS engine or prompt-summary implementation was found. The final
German summary is stored in `08-tts-summary.de.txt` as the documented text
fallback `DEGRADED_TTS_TEXT_FALLBACK`. No audio was generated and no prompt was
sent to an external service.
