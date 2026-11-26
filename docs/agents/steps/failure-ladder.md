# Failure ladder

**Start when** `ticket.py tried <n> --file <f>` prints "Three fixes have failed
since the last ladder: climb the failure ladder." The command counts attempts
from the claim, or the latest `Ladder` note, not from what the model remembers.
A failing test during TDD doesn't start the ladder.
A failure caused by your fix, in the same ticket, is the same failure, not a
new ladder. From the first ladder on, the ticket runs at the hard role
(`roles.implementer.hard`): the relay uses that role's model, effort and
`model_args` for every later session on it.

1. **Evidence:** keep the outputs, secrets redacted, in the `Ladder` note that
   starts the ladder (`ticket.py note <n> --keyword Ladder --file <what failed
   and the fixes already tried>`) and later in the PR's Evidence. If
   `project.json` sets `evidence_dir`, commit them there instead. Read earlier
   `Ladder` notes first; never retry a fix they list. The note refuses once
   the ticket has used `ladders_per_ticket` (default 2): hand off `stuck`.
2. **Diagnose in a fresh sub-agent** following `bt-diagnosing-bugs`. In single-session mode, give the sub-agent the hard role's model and
   effort in its brief, not in `AGENTS.md`. It only diagnoses; it makes no fix.
   It returns 200 words or fewer
   with: the command that reproduces the bug, the root cause, whether the fix
   is a patch or a root fix, whether the spec or rule itself is wrong, and the
   evidence (the loop and `tried.md`). No sub-agents in this harness → run
   those phases inline and write the same answers.
3. **Fix:** the claimant makes the fix, not the diagnosing sub-agent, and
   records every attempt with `ticket.py tried <n> --file <f>` (hypothesis and
   result); the count restarts after each `Ladder` note, so record these fixes
   with `tried` too. Re-run the exact check that failed — a long one through
   `tools/agents/job.py`, as in `steps/build.md` step 7 — then verify again
   after any fix. Fixed means that check passes, with its output shown.
4. **Still failing** → stuck handoff (`needs-info`). Stop.

Stop and hand off stuck at once if:

- the spec or rule is wrong → also file a decision ticket; never work around
  it;
- no loop that reproduces the failure can be built;
- the code has no sensible place to test → also see `steps/architecture.md`;
- `ticket.py note <n> --keyword Ladder --file <f>` refuses: the ticket has used its ladders.
