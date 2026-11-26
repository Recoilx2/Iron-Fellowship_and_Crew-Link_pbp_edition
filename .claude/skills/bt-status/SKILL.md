---
name: bt-status
description: Owner command: report where things stand.
disable-model-invocation: true
---
If this session hasn't run `bt-work`'s Session start, run it. Then treat the owner's text after the command ($ARGUMENTS) as the request and run `ticket.py status`, then report in the format of `docs/agents/templates/report.md`.
