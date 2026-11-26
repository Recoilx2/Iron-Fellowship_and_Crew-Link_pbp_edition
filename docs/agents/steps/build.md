# Build one ticket

Done means a passing verify receipt on the pushed head; `handoff done` refuses without one.

1. `ticket.py claim <n>`. It prints the branch, its **Base** (the active
   batch's branch, else the spec's integration branch, else `main`), the
   worktree path and the verify command.
   If the ticket has an earlier handoff (a released claim, `partial`, a
   resumed `stuck`, or changes requested), it also prints that handoff's
   **Next**: start there, on the same branch.
2. `ticket.py worktree <branch> --create --base <Base>`; work there. It reuses
   the branch if it already exists locally or on origin. `.work/tickets/<n>/`
   lives in this worktree (gitignored). Create worktrees only this way; never
   turn on the harness's own worktree isolation. Confirm the worktree holds
   Base's latest commit before starting; if not, merge it (step 5).
3. **Clean baseline:** run the verify command before changing anything.
   Already failing, and this ticket is the bug for that failure → expected:
   it's your failing test. Carry on. Already failing otherwise → stop: one bug
   per failure, blocked on an open bug (`ticket.py block <n> --by <bug>`) or
   filed as one (`ticket.py new --from <n>`). Hand off `partial`.
4. `bt-implement` (it uses `bt-tdd`). A bug ticket writes its failing test
   first (`steps/bugs.md` step 2). The spec's testing decisions and the
   ticket's Behaviour and Verify sections are the agreed seams. A new seam →
   `ticket.py set <n> needs-info --note "<the question>"`.
5. If the base moved and `merge` refused it (conflict, changed diff or failing
   verify), or you need its code: `git fetch`, then `git merge origin/<Base>`.
   Never rebase or force-push a pushed branch.
6. Commit (messages include `#<n>`), then **self-check**: run `bt-code-review`'s
   four sections (Standards, Spec, Fit, Proof) in a fresh sub-agent when the harness
   has sub-agents, inline otherwise — following its SKILL.md either way, not
   "a manual look". Act only on findings that cite a rule or spec line; smells
   are advisory. Build only what Behaviour asks, nothing from Out of scope,
   and don't restructure outside the task. This doesn't replace the review in
   `steps/review.md`.
7. **Verify**, in the ticket's worktree:
   - **Green:** at the commit you will push, run
     `python3 tools/agents/job.py verify` (it runs the project's verify command
     and records the receipt), then `job.py wait verify --max 9m` (one line;
     repeat while it says "running"), then `job.py tail verify -n 40` and read
     the output. New warnings count as failures. Only a passing receipt for the PR head counts.
     No sleep or `pgrep` loops.
   - **Bug ticket only, red proof first:** commit the failing test alone and
     run `job.py verify` on it (the failure is recorded), then commit the fix
     and run the green verify. `handoff done` needs both receipts unless
     `--no-red-proof '<why>'` (the owner sees it in `report`). Other ticket
     types need no failing receipt.
   - **Evidence:** Paste the real command output in the PR's Evidence (a signed
     comment if long; committed only if `evidence_dir` is set) and the
     handoff's Proof.
   - After any fix (a self-check finding, a review finding or a base merge),
     verify again. Unexpected failure → `steps/failure-ladder.md`.
8. Push. If the ticket already has an open PR, pushing updates it; otherwise
   open one with `bt-pr` (body from `templates/pr.md`; `ticket.py lint pr
   <file>` first), based on Base.
9. **Prove the acceptance criteria.** Run each criterion's named proof (see
   the ticket's Acceptance criteria) now, and put every result in the
   handoff's Proof. Passing tests alone aren't enough. Anything you're unsure
   of goes in **Concerns**.
10. `ticket.py handoff <n> --file <handoff>` with Status `done`; it needs the
    passing receipt for the PR head. In a batch, go to `steps/batch.md` step 3
    (merge your own PR).

Temp files: `.work/tickets/<n>/`. Name anything written elsewhere in the
handoff.
