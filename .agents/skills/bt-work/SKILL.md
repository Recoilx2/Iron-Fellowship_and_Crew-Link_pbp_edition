---
name: bt-work
description: Router for all ticket and project work in a repo set up with baton. Use at the start of any task (the owner asks to think, plan, build, fix, review, ship, or "where are we?"), when holding a ticket, when something fails, when a PR needs review, or when a session is ending. It names the one step file and skill to use next.
---
<!-- baton's own router, 2026-11-13. -->

# Work router

Find the situation, read that one step file in `docs/agents/steps/`, and use
the `bt-` skills it names. No outside skills: Baton owns all of them.

## Session start

1. **Both roles:** run `python3 tools/agents/setup.py check --quick` (hooks may
   not run it). Act on every WARN or FAIL; "gh guard not seen" says exactly how
   to put the guard on PATH. Its `[agents] Roles:` line names your model and
   effort: state your role, model and effort to the owner, and sign as the role
   alone. Then follow the lines for your role under Extras in `docs/agents/project.md` (none listed means none apply).
2. **Orchestrator:** follow "Every session" in `docs/agents/orchestrator.md`
   (the last `Report`, housekeeping, then the `next` loop and its wait rule).
3. **Implementer:** run `ticket.py next --role implementer` and do what it
   prints. For a "Build #n" job, `ticket.py claim <n>`, then `steps/build.md`.
   Nothing printed means nothing to do. To wait for work: `ticket.py next
   --role implementer --wait 4h` in the background (tool calls time out; it
   wakes when a job appears).

An owner command (`bt-think`, `bt-plan`, `bt-build`, `bt-fix`, `bt-review`,
`bt-ship`, `bt-status`, `bt-resume`, `bt-architecture`) names its step file directly: skip
the table.

| Situation | Step file |
|---|---|
| The owner has an idea or wants to plan ("let's think about X", "plan it") | `planning.md` |
| You hold a ready ticket ("do this", "build it", or a `Build #n` job from `next`) | `build.md`; in a batch, then `batch.md` step 3 (merge your own PR) |
| A small change with no spec ("fix this", "change that") | `ticket.py quick --title … --what … --verify "<command>"` (see `planning.md` step 6), then build and review |
| Something failed unexpectedly during a ticket | `failure-ladder.md` |
| An approved batch run, or `next` said "Run the batch on spec #n" | `batch.md` |
| A PR is `needs-review` (orchestrator), or "review it" | `review.md` |
| A bug report, or "X is broken" | `bugs.md` |
| A ticket merged, or the session is ending | `after.md` |
| "Ship it", or a bad change on `main` | `ship.md` |
| The owner answered a decision or a stuck ticket | `decisions.md` |
| A paid run is wanted | `paid-run.md` |
| Code getting hard to change, or "look at the architecture" | `architecture.md` |
| After a ship or batch (orchestrator) | `housekeeping.md` |
| "Where are we?" | `ticket.py status`, then the status format in `docs/agents/templates/report.md` |
| "I don't follow" | `bt-wait-what` |
| A step only a human can do (API keys, a dashboard, an account) | `bt-wizard` |
| Writing or changing rules, templates or skills (orchestrator) | `bt-writing-for-agents` |

## Always

- A question the ticket doesn't answer (new seam, scope, behaviour): move the
  ticket to `needs-info` with a decision request (`ticket.py set`). Never
  guess.
- A bug outside your ticket: file it on `docs/agents/templates/bug.md` with
  `ticket.py new --from <n>`, then carry on.
- Every label, claim, handoff, review, merge, close and comment goes
  through `python3 tools/agents/ticket.py`; `docs/agents/contract.md` lists the
  four raw `gh` writes.
- Stopping for any reason: post a handoff (`docs/agents/templates/handoff.md`,
  `ticket.py handoff`).
