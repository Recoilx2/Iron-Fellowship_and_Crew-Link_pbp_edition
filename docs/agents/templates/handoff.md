**Status:** done | partial | stuck
**Effect:** <what now works or doesn't, in product terms>
**Did:** <summary of the change>; PR #<n>
**State:** branch <name> @ <commit hash from `git rev-parse --short HEAD`, never the word HEAD>; worktree <path or none>; .work/tickets/<n>/ <kept or cleaned>; written outside the project: <paths or none>
**Proof:** <command> → <result it printed>
**Decisions:** <each call made within the agent's authority, why, and what it costs if wrong; "none">
**Left:** <remaining acceptance criteria, or "none">
**Next:** <the exact first step for whoever picks this up>
**Concerns:** <doubts about the work, or "none"; optional>
**Questions:** <for the owner, in decision format, or "none">
**Suggested skills:** <for the next step, or "none">
<!-- `ticket.py` signs it: no signature line here. -->
<!-- Redact every secret as `<REDACTED>` in Proof and anywhere output is pasted. -->

## Filled example

```
- **Status:** done
- **Effect:** Plans now produce one chapter per story unit.
- **Did:** Derived the chapter count from the unit list; PR #42
- **State:** branch ticket/42-chapters @ 1f3a9c2; worktree /ws/.worktrees/demo/ticket-42-chapters; .work/tickets/42/ cleaned; written outside the project: none
- **Proof:** python3 -m unittest tests/test_chapters.py → Ran 41 tests in 0.31s; OK
- **Decisions:** Kept the old field name as an alias; costs a cleanup if a caller still uses it.
- **Left:** none
- **Next:** Review PR #42 with `python3 tools/agents/ticket.py review 42 start`; findings go in `.work/tickets/42/findings.md`.
- **Questions:** none
```
