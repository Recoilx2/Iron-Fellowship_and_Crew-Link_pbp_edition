---
name: bt-fix
description: Owner command: fix a bug, root cause first.
disable-model-invocation: true
argument-hint: "<issue number or description>"
---
If this session hasn't run `bt-work`'s Session start, run it. Then treat the owner's text after the command ($ARGUMENTS) as the request and follow `docs/agents/steps/bugs.md`.
