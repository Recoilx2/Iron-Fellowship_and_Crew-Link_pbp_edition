# Bugs

- **The owner reports a bug in conversation** → you reproduce it and file
  it straight onto `templates/bug.md` with `ticket.py new`; no triage.
  `bt-triage` is for issues no agent created on GitHub (raw reports from
  outside): reproduce, categorise, brief → a bug ticket.
- **Bug an agent found** → straight onto `templates/bug.md` with
  `ticket.py new --from <where found>`; no triage.
- `new` leaves no status: `ticket.py check <n> --promote` makes it ready.

**Triage outcome** (`bt-triage`): write the brief on the bug or slice
template, lint it, file it with `ticket.py new --from <raw issue>`, promote it
(`ticket.py check <new> --promote`; `ready-for-human` instead:
`ticket.py set <new> ready-for-human --note "<why>"`), then close the raw issue
as a duplicate noting the new ticket. A `wontfix` closes with `--reason wontfix
--note`.

Then, as a ticket (`steps/build.md`):

1. **Keep the evidence** (failing logs and outputs, secrets redacted) as in
   `steps/failure-ladder.md` step 1, then **diagnose** as its step 2 says
   (fresh sub-agent, `bt-diagnosing-bugs` phases 0–4 only, its five returns).
2. **Fix:** the claimant writes the failing test (phase 5) and the fix; the
   diagnosing sub-agent does neither. That is `build.md` step 4: `bt-implement`
   runs `bt-tdd` once, starting from the diagnosis's reproduce command. Record
   every attempt with `ticket.py tried <n> --file <f>` (hypothesis and result);
   when it says three fixes have failed, follow `steps/failure-ladder.md`.
3. Verify → review → merge, as usual. `build.md` step 7 holds the red proof:
   failing test committed first with its failing receipt, then the fix. If the
   test and fix already share a commit, split them or hand off with
   `--no-red-proof '<why>'`.
4. Tell the owner, in plain words: why it broke, why the fix works, and how
   to spot this kind of bug next time.
5. Retro asks what kind of bug this was and what check would catch that kind
   next time.
