# Issue #43 free-model DEBUG log differential

Experiment: `issue-43-free-model-observation-canary-opencode-big-pickle-20260904T121500Z`
Target: `opencode/big-pickle`
OpenCode: `1.18.27`

The traces below are sanitized extracts. Timestamps, request IDs, and temporary paths are omitted or normalized where present.

## CONTROL_0 representative healthy run

- aggregate: `3/5` verified successes; two runs stopped with `VERIFIER_REJECTION`
- representative run verified_success: `true`
- failure_class: `NONE`
- timeout_class: `NONE`
- message_sequence: `step_start → tool_use → step_finish → step_start → tool_use → step_finish → step_start → tool_use → step_finish → step_start → text → step_finish`
- observation_trace: ``
- debug_lifecycle_events: `session_creation`

```text
timestamp=[TIMESTAMP] level=INFO run=88177650 message="creating instance" directory=[TMP_PATH_REDACTED]
timestamp=[TIMESTAMP] level=INFO run=88177650 message=fromDirectory directory=[TMP_PATH_REDACTED]
timestamp=[TIMESTAMP] level=INFO run=88177650 message=bootstrapping directory=[TMP_PATH_REDACTED]
timestamp=[TIMESTAMP] level=INFO run=88177650 message=loading path=[PATH_REDACTED]
timestamp=[TIMESTAMP] level=INFO run=88177650 message=loading path=[PATH_REDACTED]
timestamp=[TIMESTAMP] level=INFO run=88177650 message=loading path=[PATH_REDACTED]
timestamp=[TIMESTAMP] level=INFO run=88177650 message=loading path=[TMP_PATH_REDACTED]
timestamp=[TIMESTAMP] level=DEBUG run=88177650 message="loading config from [PATH_REDACTED]"
timestamp=[TIMESTAMP] level=INFO run=88177650 message=loading path=[PATH_REDACTED]
timestamp=[TIMESTAMP] level=DEBUG run=88177650 message="loading config from [PATH_REDACTED]"
timestamp=[TIMESTAMP] level=INFO run=88177650 message=loading path=[PATH_REDACTED]
timestamp=[TIMESTAMP] level=INFO run=88177650 message="all LSPs are disabled"
timestamp=[TIMESTAMP] level=INFO run=88177650 message="all formatters are disabled"
timestamp=[TIMESTAMP] level=INFO run=88177650 message=init
timestamp=[TIMESTAMP] level=INFO run=88177650 message=created id=ses_f935b8a44ffe1H6W11l8ShoyLG slug=proud-pixel version=1.18.27 projectID=global directory=[TMP_PATH_REDACTED] path=tmp/ocae-live-case-gP6Z8N workspaceID=undefined parentID=undefined title="New session - [TIMESTAMP] agent=undefined model=undefined metadata=undefined permission="[{\"permission\":\"question\",\"pattern\":\"*\",\"action\":\"deny\"},{\"permission\":\"plan_enter\",\"pattern\":\"*\",\"action\":\"deny\"},{\"permission\":\"plan_exit\",\"pattern\":\"*\",\"action\":\"deny\"}]" cost=0 tokens.input=0 tokens.output=0 tokens.reasoning=0 tokens.cache.read=0 tokens.cache.write=0 time.created=1788529112507 time.updated=1788529112507
timestamp=[TIMESTAMP] level=INFO run=88177650 message="event connected"
timestamp=[TIMESTAMP] level=INFO run=88177650 message=loop session.id=ses_f935b8a44ffe1H6W11l8ShoyLG step=0
timestamp=[TIMESTAMP] level=INFO run=88177650 message="shell tool using shell" shell=/bin/bash
timestamp=[TIMESTAMP] level=INFO run=88177650 message=stream providerID=opencode modelID=big-pickle session.id=ses_f935b8a44ffe1H6W11l8ShoyLG small=true agent=title mode=primary
timestamp=[TIMESTAMP] level=INFO run=88177650 message="llm runtime selected" llm.runtime=ai-sdk llm.provider=opencode llm.model=big-pickle
timestamp=[TIMESTAMP] level=INFO run=88177650 message="watcher backend" directory=[TMP_PATH_REDACTED] platform=linux backend=inotify
timestamp=[TIMESTAMP] level=INFO run=88177650 message="project copy refresh started" projectID=global
timestamp=[TIMESTAMP] level=INFO run=88177650 message="project copy refresh done" projectID=global updated=[] removed=[]
timestamp=[TIMESTAMP] level=INFO run=88177650 message="booting location services" directory=[TMP_PATH_REDACTED] workspaceID=undefined
timestamp=[TIMESTAMP] level=INFO run=88177650 message=process session.id=ses_f935b8a44ffe1H6W11l8ShoyLG messageID=msg_06ca478b9001pP6E4ht7gqG3Fn
timestamp=[TIMESTAMP] level=INFO run=88177650 message=stream providerID=opencode modelID=big-pickle session.id=ses_f935b8a44ffe1H6W11l8ShoyLG small=false agent=build mode=primary
timestamp=[TIMESTAMP] level=INFO run=88177650 message="llm runtime selected" llm.runtime=ai-sdk llm.provider=opencode llm.model=big-pickle
timestamp=[TIMESTAMP] level=INFO run=88177650 message=evaluated permission=read pattern=tmp/ocae-live-case-gP6Z8N/data/input.txt action.permission=read action.action=allow action.pattern=*
timestamp=[TIMESTAMP] level=INFO run=88177650 message=loop session.id=ses_f935b8a44ffe1H6W11l8ShoyLG step=1
timestamp=[TIMESTAMP] level=INFO run=88177650 message="touching file" file=[TMP_PATH_REDACTED]
timestamp=[TIMESTAMP] level=INFO run=88177650 message=process session.id=ses_f935b8a44ffe1H6W11l8ShoyLG messageID=msg_06ca48cae001HyzDAMEY8fZmTN
timestamp=[TIMESTAMP] level=INFO run=88177650 message=stream providerID=opencode modelID=big-pickle session.id=ses_f935b8a44ffe1H6W11l8ShoyLG small=false agent=build mode=primary
timestamp=[TIMESTAMP] level=INFO run=88177650 message="llm runtime selected" llm.runtime=ai-sdk llm.provider=opencode llm.model=big-pickle
timestamp=[TIMESTAMP] level=INFO run=88177650 message=evaluated permission=edit pattern=tmp/ocae-live-case-gP6Z8N/data/output.txt action.permission=edit action.action=allow action.pattern=*
timestamp=[TIMESTAMP] level=INFO run=88177650 message=formatting file=[TMP_PATH_REDACTED]
timestamp=[TIMESTAMP] level=INFO run=88177650 message="touching file" file=[TMP_PATH_REDACTED]
timestamp=[TIMESTAMP] level=INFO run=88177650 message=loop session.id=ses_f935b8a44ffe1H6W11l8ShoyLG step=2
timestamp=[TIMESTAMP] level=INFO run=88177650 message=process session.id=ses_f935b8a44ffe1H6W11l8ShoyLG messageID=msg_06ca49f4e001UV7r5RZrQm3qwX
timestamp=[TIMESTAMP] level=INFO run=88177650 message=stream providerID=opencode modelID=big-pickle session.id=ses_f935b8a44ffe1H6W11l8ShoyLG small=false agent=build mode=primary
timestamp=[TIMESTAMP] level=INFO run=88177650 message="llm runtime selected" llm.runtime=ai-sdk llm.provider=opencode llm.model=big-pickle
timestamp=[TIMESTAMP] level=INFO run=88177650 message=evaluated permission=read pattern=tmp/ocae-live-case-gP6Z8N/data/output.txt action.permission=read action.action=allow action.pattern=*
ti
[DEBUG_LOG_TRUNCATED]
```

## Differential interpretation

- CONTROL_0: captured
- IDENTITY: not captured
- ENVELOPE: not captured
- The attempt stopped after the prescribed CONTROL instability boundary; no
  Identity or Envelope DEBUG lifecycle trace exists for this attempt.
- Exact OpenCode internal message roles and provider request payload ordering are not exposed by this CLI surface; message role is therefore UNOBSERVABLE.
- The observable CLI event order and adapter trace order are retained in the evidence JSON; any provider-side resume ordering beyond that boundary is not inferred.
