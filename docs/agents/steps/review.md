# Review (a fresh reviewer, every round, in both modes)

1. `ticket.py review <pr> start`. It refuses if the other role is already
   reviewing, or if you opened the PR (except an integration or batch PR, where
   the orchestrator posts the verdict from a fresh reviewer sub-agent's findings).
2. **Use a fresh reviewer sub-agent every time**, in single-session mode and in
   two-harness mode. The orchestrator never reviews in its own context: it
   briefed the work, so it can't be the fresh check. Brief the reviewer (model
   and effort as in `orchestrator.md`, Sub-agents) with:
   - the diff file, the ticket(s) or spec, and the base ref by name;
   - a scratch worktree of the PR head, where the reviewer reads the diff and
     runs the product code on its own inputs — the implementer's probes alone
     aren't evidence;
   - a scratch path for findings (`.work/tickets/<n>/findings.md`;
     `.work/reviews/<pr>/` for a batch or spec review with no single ticket).
   - the ticket's or spec's body, pasted in;

   For a bug ticket, also paste the handoff's reproduce command. The reviewer
   runs `bt-code-review` inline — Standards, Spec, Fit and Proof, one after
   the other — and returns 200 words or fewer, with verify and the
   `Revert check:` line as one line each. `ticket.py revert-check <pr>` (or `--base <ref> --head <ref>`, git only) prints
   that line: it runs verify on the PR head with every changed non-test file put
   back as on the base.
   It runs no `gh` or `ticket.py` writes and posts nothing. You rule on its
   findings and post the review with `ticket.py`. If this harness has no
   sub-agents, give the same brief to a fresh session with no memory of the
   work; never reuse the session that briefed the implementer.
3. Every round reviews the latest commit in full, not just earlier findings.
4. Count only findings that cite a rule, a spec line or a reproduced failure
   (the exact command and its output, in the review); smells are advisory.
   Mark each Critical, Important or Minor (defined in `bt-code-review`; not
   everything is Critical). Minor and advisory findings go in the review
   comment under `Carried forward` and on to the ship review.
5. Outcome:
   - **Clean** → `ticket.py review <pr> approved --head <sha> --file <evidence>`
     (the evidence carries the reviewer's `Revert check:` line),
     where `<sha>` is the commit the reviewer actually read (`git rev-parse
     HEAD` in the scratch worktree; a prefix of 7+ characters is fine). It
     records the head commit you approved and refuses if the PR head moved
     since; any later push needs a new approval. Then `ticket.py merge <pr>`
     (into an integration branch; `main` also needs the owner's go-ahead).
     Then `steps/after.md`.
   - **Cited findings** → `ticket.py review <pr> changes --file <findings>` (all
     of them in one file). The ticket returns to `ready-for-agent`; when the
     round limit is reached (counted since the owner last decided) it goes to
     `needs-info`.
   - **Bugs outside the PR** → `ticket.py new --from <pr>` on the bug
     template.
   - **The branch is behind its base** (another ticket landed first): review
     it as it is; the approval survives. `ticket.py merge` brings the base in
     itself and checks the diff is unchanged and verify passes. If it refuses
     (conflict, changed diff, failing verify) → `ticket.py set <n>
     ready-for-agent --note "<what merge said>"`; the implementer merges the
     base in, re-verifies and updates the PR body's `Probes:` line, and the
     new head needs a new approval.
   - **Findings on an integration or batch PR** (it closes no tickets, so
     nobody would hear about changes) → file one fix ticket for the whole
     review, listing every finding
     (`ticket.py new --from <pr> --parent <spec>`). Merge once it lands.
   - **After the verdict**, remove the review's scratch worktree: `git worktree remove <path>`, never `--force`; if git refuses, leave it and name it in your report.

6. **Owner review paths** (`owner_review_paths` in `project.json`, plus every
   dependency manifest): `ticket.py merge` refuses a PR that changes one of
   these files unless an owner approval follows the first note naming its head
   (the reviewer's `Approved`, or in a batch the done handoff; GitHub's
   timestamps): an unsigned comment starting `Approved`, or `ticket.py review
   <pr> approved --head <sha> --owner "<their words>"`. The refusal names the files and says how to get approval;
   batches need it too. A manifest PR lists each new dependency with its
   registry URL under `## Dependencies`; in Fit, open each URL and confirm the
   package exists and is maintained (LLMs invent package names).

**Implementer, receiving a review:** `ticket.py claim <n>` again, then check
each finding against the code before changing anything.

1. If any finding is unclear, stop: ask in a PR comment and fix nothing until
   every one is clear.
2. A finding that conflicts with an ADR or a recorded owner decision isn't
   yours to settle: `ticket.py set <n> needs-info` with the conflict.
3. Fix one finding at a time and test after each. Push back with evidence on
   what doesn't hold up. Never reply with bare agreement ("you're right"); say
   what you checked. Push to the same PR, verify, and hand off
   `done`.
