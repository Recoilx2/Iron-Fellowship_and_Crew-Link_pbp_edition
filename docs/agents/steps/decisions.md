# The owner answered (orchestrator)

Use this when the owner answers a decision request or a stuck ticket, in a
session or on a ticket.

**Door:** every decision ticket states `Door: one-way` or `two-way` and ticks
its `## Door check` boxes. A tick (data migration, public API/CLI/file format,
external dependency, money, security or an owner-only spec area) makes it
one-way. Only the owner's answer counts; close with `--answer <comment URL>`
for an unsigned comment, or `--owner "<their words>"`. `next` names these as
waiting on the owner. A two-way door is the orchestrator's job: `ticket.py
decide <n> --file <f>` with `Choice:`, `Evidence:` and `Undo:` lines posts a
signed Decided note and closes the ticket as completed.

1. Record the answer where it was asked: `ticket.py note <n> --keyword
   Decided --file <answer>` on the decision ticket or the stuck ticket. Quote
   the owner's words, given for this ticket; never copy them from another.
   One note per ticket; it prints the note's URL.
2. Close a decision ticket: `ticket.py close <n> --reason completed --answer
   <URL of a comment on that ticket>`. A paid-run approval closes after its
   `Paid run` note (`steps/paid-run.md`).
3. Act on it, quoting the owner with `--owner`:
   - **Resume:** `ticket.py set <ticket> ready-for-agent --note "<one line>"
     --owner "<their words>"`. If the answer changes scope, update the
     ticket's sections first (`ticket.py lint` passes).
   - **Accept the work as it is** (after a review-limit escalation):
     `ticket.py set <ticket> needs-review --note "Owner accepts as is" --owner
     "<their words>"`, then approve and merge it (`steps/review.md`).
   - **Stop:** `ticket.py close <n> --reason not-planned --note "<why>"`.
4. If the answer contradicts an earlier decision, ADR or spec, record which
   one wins (a new ADR via `bt-domain-modeling` if it's architectural).
5. Mention it in the next report.
