# Planning (orchestrator)

1. **Fuzzy idea** → `bt-grill-with-docs`, grilling style: every open question in
   one round, numbered, each with a recommended answer that "yes" accepts.
   It records glossary terms and ADRs as decisions land.
   - Needs facts → `bt-research`. Needs a feel for a design → `bt-prototype`.
   - More than one spec's worth of decisions, or more slices than the lint
     limits allow in one spec → `bt-wayfinder` map; resolve its decisions; then
     `bt-to-spec` from the map.
   - A large spec coming → offer `bt-improve-codebase-architecture` aimed at it
     first (`steps/architecture.md`).
2. **"Plan it"** → `bt-to-spec`, then `bt-to-tickets`, in the same session. Draft
   each in `.work/`, run `ticket.py lint ticket <file>`, file with `ticket.py
   new --title … --file <file>`.
3. **Shape the breakdown for a batch run** — only when the plan has a one-way
   decision or an owner-review path; otherwise the owner's spec approval
   covers the breakdown and the batch:
   - every owner decision is settled in the grill and spec; no ticket holds
     an open owner question;
   - every ticket runs unattended: a verify command with no human and no paid
     calls;
   - blocking edges are correct, including between tickets that touch the
     same files (export lists, schemas, migrations, the ADR folder);
   - a stuck ticket blocks only its dependants.
4. In that case, show the owner the breakdown, with a batch proposal:
   "Batch: these tickets, onto a batch branch, nothing needs you until the end."
5. **After approval:** `ticket.py integration --spec <n>` (once per spec; it
   creates `spec/<n>-<slug>`), publish the tickets (blockers first), run
   `ticket.py check <n> --promote` on each (`new` leaves no status), then `ticket.py batch start
   --tickets … --spec <n>` (`steps/batch.md`).
6. **Small change within the size limits:** the lint limits apply to slice and
   bug tickets (at most 8 acceptance criteria and 10 Touches entries); one seam;
   one verify command. Skip the spec:
   `ticket.py quick --title … --what … --verify "<command>"`
   files one `fix` ticket and makes it ready. It lands on the Small fixes
   spec's branch (`small_fixes_spec`), shipping with the other small fixes
   under one owner go-ahead. Options: `--acceptance` (a
   criterion naming its proof), `--out-of-scope` and `--touches`, each
   repeatable. A feature needing more than that uses the slice template.
   **Quick or fix tickets in parallel:** first check they don't touch the same
   files (`--touches`). If they do, run them one after the other, or block one
   on the other (`ticket.py block`).
