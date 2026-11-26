# After the work

When a ticket merges, or before a session ends:

1. When `next` says "Retro due" (after a spec ships), run `bt-retro` in a fresh
   sub-agent, not on every ticket merge. Each candidate rule is filed as a
   ticket (`Type: cleanup` for checks and wording; `Type: decision` if it
   changes roles, merging, spending or who decides what), drafted in `.work/`,
   linted, filed with `ticket.py new --from <n>`, naming the incident that
   prompted it. Nothing found → post
   "retro: no candidates" with `ticket.py note <n> --keyword Retro --file <file>`.
   A candidate about Baton itself (not this project) goes to the master copy's
   issue tracker: `master_repo` in `.contract-manifest.json`; if that's null,
   tell the owner.
2. When `next` says "Checkpoint due": post your Report
   (`docs/agents/templates/report.md`) as in step 4, and keep working.
3. `ticket.py tidy` (add `--dry-run` to preview): clears merged worktrees,
   closed tickets' `.work/tickets/<n>/`, stale verify receipts and old relay
   logs; it names every worktree it skips (uncommitted changes, or untracked
   or ignored files such as `.env` or an open ticket's dir, a detached HEAD, or a
   prunable entry), which stay for
   their owner to sort out.
4. Hand off: the implementer with `ticket.py handoff` on its ticket. The
   orchestrator holds no ticket, so it posts its session-end report on the
   open spec instead (`ticket.py note <spec> --keyword Report --file
   <report>`); with no open spec, on the ticket(s) the session worked on. The
   next session reads it.
