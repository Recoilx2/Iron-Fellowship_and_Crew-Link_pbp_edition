# Codebase health

`bt-improve-codebase-architecture` ends by grilling the owner, so the
orchestrator proposes it and the owner says go. The owner can also ask at any
time. Triggers are activity, never the calendar. Propose it:

- after each ship to `main`: survey the areas the spec touched (`steps/ship.md`
  last step);
- when `ticket.py next` says "Architecture survey due": that many ticket PRs
  (`survey_every_merged_tickets` in `project.json`, default 10) have merged
  since the last `Survey` note. Post the note when you deliver the report
  (`ticket.py note <spec> --keyword Survey --file <report>`);
- when:
  - a large spec is about to be planned: aim it at that spec ("how can we make
    this change easy?"), before `bt-to-spec`;
  - `bt-diagnosing-bugs` finds the code has no sensible place to test;
  - retro finds agents repeatedly struggling in the same area;
  - an area keeps using its full ladder ceiling or the 2-round review limit.

Then: report → the owner picks one candidate → grill → decision → spec →
tickets. Deliver the survey as the HTML report, not an interruption. Record a
rejected candidate as an ADR only when the owner's reason is load-bearing: a
future survey would need it to avoid re-proposing the same thing.
