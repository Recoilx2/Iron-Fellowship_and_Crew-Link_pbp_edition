---
name: bt-resume
description: Owner command: pick up where the last session left off.
disable-model-invocation: true
---
If this session hasn't run `bt-work`'s Session start, run it. Then read the latest `Report` note as `docs/agents/orchestrator.md` (Every session) says, and loop on `ticket.py next --role orchestrator` as it describes, stopping only where it says to.
