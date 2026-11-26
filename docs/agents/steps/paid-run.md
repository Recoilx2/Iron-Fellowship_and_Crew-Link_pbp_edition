# Paid run

A paid run is any run where the product calls a paid API (for example
OpenRouter or DeepSeek). The harnesses' own model use doesn't count.

1. API keys not set up yet → `bt-wizard` walks the owner through it; keys go
   to the secret store or harness environment, never into the repo.
2. Stub mode is the default. A paid call needs the switch named in
   `project.json` (`paid_run_switch`). Only `ticket.py paid-run` sets it;
   never set it yourself.
3. Ask with the paid-run request in `templates/report.md`: what it runs, proof
   it's ready (stub runs passing), expected cost (computed from earlier run
   logs, or "unmeasured"), and what counts as success.
4. The approval lives on that decision ticket, which must still be open: the
   owner's comment, or, when they approve in your session, a Decided note
   with their words on an `Owner: "..."` line (`ticket.py note <n> --keyword
   Decided --file <f>`), posted then. An approval for another ticket or
   session never carries over. From a clean checkout: `python3 tools/agents/ticket.py paid-run <n> -- <command>`.
   It checks the approval, runs once with the switch on, keeps the log in
   `.work/paid-runs/` and posts a `Paid run` note. Paid runs never
   share a branch with code changes; they produce evidence only, and any fix
   becomes a ticket.
5. Report the actual cost and result from that log, then close the decision.
   If the run couldn't happen, leave it open, under Waiting on you.
