# Report formats (to the owner)

Rules: `docs/agents/reporting.md`. Dated history, one screen, no code.

## Report (end of a request)

Start from `ticket.py report [--spec <n>]`: it prints the factual sections
(Merged, Open work, Waiting on you, Decided without you) from GitHub. Add only
the narrative below; keep its numbers and links.

**Outcome:** <done | partly done | stuck, and what that means for the product>
**What changed:** <effects, in product or pipeline terms>
**Proof:** <each number with what it counts and what produced it>
**Problems hit:** <one line each: "hit X, fixed by Y">
**Decisions needed:** <decision format, or "none">
**Next:** <what happens next, and whether it waits on the owner>

## Stuck report

**Stopped:** <what can't proceed, in product terms>
**Broke:** <the failure: effect, then mechanism>
**Tried:** <each ladder step and what it showed>
**Evidence:** <link to the logs and outputs (the Ladder note or the PR)>
**Decision needed:** <options, trade-offs, recommendation>

## Status ("Where are we?")

**Done:** <effects delivered since the last status>
**In progress:** <what's being worked on, by which role>
**Blocked:** <what is blocked by what, in words; IDs at the end>
**Waiting on you:** <decisions, oldest first, with how long each has waited>

## Decision request

**Decision:** <one sentence>
**Options:** <each with its trade-offs>
**Recommendation:** <which, and why; "yes" accepts it>

## Paid-run request

**Runs:** <what it runs and why>
**Ready:** <proof: stub runs passing, with the command>
**Expected cost:** <computed from earlier run logs, or "unmeasured">
**Success means:** <the result that counts as success>

## Setup report (after install)

**Machine:** <what `setup.py survey` found missing or off, and what was installed with the owner's OK; "all present" if nothing>
**Installed:** <contract version, master commit, setup PR or first commit>
**Checked:** <what `setup.py check` found; each warning with what you did about it>
**Verify command:** <the command, and whether it passes now>
**Notifications:** <how the owner is notified, or "none">
**Harnesses:** <each harness, its headless command, and its smoke-test result as recorded in project.md; what failed and what you did>
**Extras:** <each extra enabled, for which roles, and its smoke-test result; "none" if none. Say if anything was installed globally (only with the owner's OK) or the Context7 key is unset>
**Needs you:** <the owner merges the setup PR on GitHub; `CODING_STANDARDS.md` is empty, so reviews give only advisory smells: add rules, or accept the smell baseline>
**Next:** open a fresh interactive session as orchestrator: `AGENT_SIGNATURE=orchestrator PATH="<guard dir>:$PATH" <interactive launch line>` (proved in step 4). This setup session ends here; don't continue as orchestrator in it.

## Filled example

```
Outcome: done; the planner emits one chapter per story unit.
What changed: chapter counts are now derived from the unit list, so no stage-3
gate run can be short by a fixed count.
Proof: python3 -m unittest tests/test_chapters.py → Ran 41 tests in 0.31s; OK
Problems hit: the first cut used the draft unit count; fixed by reading the
committed list (attempts recorded with `ticket.py tried 42`).
Decisions needed: none.
Next: review PR #42; no owner action until the batch lands.
```
