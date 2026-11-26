# Housekeeping (orchestrator; at session start, and again whenever `next` says "Housekeeping due")

1. `python3 tools/agents/setup.py check --fix`: folders, labels, skills,
   hooks, guard, secrets, contract version. A newer master contract →
   `setup.py sync` (MINOR applies with one line in the next report; MAJOR asks
   the owner). Land a sync like setup: commit on `setup/sync-<version>`, open
   a PR from the sync block of `templates/setup-pr.md`; a fresh reviewer
   approves, then `merge <pr>`. A MAJOR sync also needs `--owner-go-ahead`
   (until the owner answers, it's in the report's Waiting on you). Merging a `setup/*` PR merges `main` into every open
   `spec/*` and `batch/*` branch and pushes each, so worktrees cut from them
   read the new rules; it prints one line per branch. Resolve any branch it
   names as a CONFLICT: merge the base it names (`main`, or for a batch its
   spec branch) into it in its worktree, fix, verify, push; a branch that
   heads an open PR then needs a fresh review. Worktrees cut before the sync keep the old rules until their
   branch merges the base in.
2. `ticket.py sync --rebuild` refreshes the local tracker copy: `since` cannot
   see deletions, so a full read corrects them. Then `ticket.py stale --release`:
   claims whose batch ended, whose relay halted, or whose claimant moved on
   (contract, Claims). Branch and work are kept.
3. Promote tickets that pass their template but have no status yet (filed by
   agents or retro): `ticket.py check <n> --promote`. The audit lists them as
   `unpromoted`.
   Triage every issue still labelled `needs-triage` with `bt-triage`.
4. Find and fix:
   - blocker edges onto landed tickets;
   - leftover branches, after `ticket.py tidy` has cleared worktrees, ticket
     dirs, receipts and relay logs;
   - `prototype/*` and `research/*` branches whose ticket has closed;
   - specs whose ship PR merged but are still open: `ticket.py close <spec> --reason completed`.
5. Re-ask: everything still waiting on the owner (`ticket.py next --role
   owner`) goes in the next report, oldest first.
6. Propose deleting rules that haven't fired across the last several merged
   tickets or batches.
7. `setup.py check` warns that Matt's upstream changed → regenerate that
   `bt-` skill in the master copy from his new version (README, "Our
   skills"), run the master's tests, bump the contract MINOR, then
   `setup.py sync` here.
8. `ticket.py audit`: count contract violations on this repo. Each kind that
   recurs becomes a retro candidate; the counts go in the next report.
9. Anything not mechanical becomes a cleanup ticket.
10. `ticket.py note <spec> --keyword Housekeeping --file <file>` on the Small
    fixes spec (or the open spec): this clears the "Housekeeping due" trigger.
