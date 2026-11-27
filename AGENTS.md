# Agent rules

Shared by every harness.

**What this is.** Tickets, decisions, handoffs and reviews live on GitHub; read
them to pick up where the last agent stopped. Work like a careful engineer:
diagnose before fixing, research what you don't know, plan before building,
prove "done", and stop and ask rather than repeat a fix that failed.

- **Roles.** Each session is the orchestrator or the implementer; the owner
  (or orchestrator) says which. Sign as `<role>` (or `<role>#<n>` for a tagged
  sub-agent): `— implementer#2`. Set `AGENT_SIGNATURE` at launch or pass `--as`.
  One session may play both roles, with sub-agents; see `docs/agents/orchestrator.md`,
  which the orchestrator also reads. The owner is the architect.
- **GitHub** is the only channel between roles; rules in
  `docs/agents/contract.md`. Write to it only through
  `python3 tools/agents/ticket.py` (labels, claims, handoffs, reviews,
  comments, merges, closes); the contract lists the four raw `gh` writes.
- **All work** starts with the `bt-work` skill's **Session start** block
  (it runs `setup.py check --quick`; hooks may not); load only the step file
  the router points to. Use the `bt-` skills. Can't load skills? Follow
  `.agents/skills/<name>/SKILL.md` (or `.claude/skills/<name>/SKILL.md`). State
  your role, model and effort to the owner, from the `Roles:` line the check
  prints.
- **Context.** Hand reading, searching, building and reviewing to fresh
  sub-agents with a short brief; they return 200 words or fewer. Post a
  Report when `next` says Checkpoint due.
- **Writing to the owner:** `docs/agents/reporting.md`.
- **Temp files** go in `.work/` (gitignored); a ticket's `.work/tickets/<n>/`
  is in its worktree. Worktrees go where `ticket.py worktree` says. Name
  files written elsewhere in your handoff.
- **Numbers** come from code or tool output you just ran (name the command);
  otherwise write "unmeasured".
- **Refused?** Follow the message; never run that command another way.
- **Unclear?** Do what the owner said, not what you guess they meant; if a
  request could mean more, ask one short question first.
- **Paid calls** (the product's calls to paid APIs) need the owner's
  approval of that run.
