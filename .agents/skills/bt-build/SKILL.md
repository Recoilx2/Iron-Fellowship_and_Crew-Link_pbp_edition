---
name: bt-build
description: Owner command: build a ready ticket, or a small change with no ticket.
disable-model-invocation: true
argument-hint: "[ticket number or small change]"
---
If this session hasn't run `bt-work`'s Session start, run it. Then treat the owner's text after the command ($ARGUMENTS) as the request. For a ticket, follow `docs/agents/steps/build.md`; for a small change with no ticket, `ticket.py quick` as `bt-work`'s table says.
