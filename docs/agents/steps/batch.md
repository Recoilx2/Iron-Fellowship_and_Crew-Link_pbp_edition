# Batch run

The owner approved a batch proposal, so they can leave until the end.

**Orchestrator:** `ticket.py batch start --tickets N,M,… --spec <spec>`. It
creates the batch branch (`batch/<spec>-<time>`) from the spec's integration
branch, records it on each ticket, and prints it. In two-harness mode, start
the implementer's session for it: `python3 tools/agents/relay.py start
--detach --as implementer#1` (one relay per batch; one
line comes back, and the owner's approval of the batch is the go-ahead). Never
read its logs: the owner is told if it halts (below), and a session over its
`--limit` (default 8h) is killed and counts as failed. Then keep following
`orchestrator.md` step 4: wait while implementers run. When the implementer's
`Batch report` arrives, `next` names the end step below.

**Implementer** (a relay session gets the job "Run the batch on spec #n"):

1. Follow `bt-implement-spec`: one ticket per worktree, frontier first.
   `ticket.py batch next <spec>` lists the frontier (tickets with no open
   blockers) and the free slots; start only what it lists. `claim` enforces
   the parallel cap, so don't estimate it yourself.
2. For each ticket: `steps/build.md` steps 1–10, with the batch branch as
   Base and as the PR's base.
3. When verify has passed on the PR's head (a passing `job.py` receipt;
   `Probes:` is required by lint, not a merge gate), merge
   your own ticket's PR
   (never another implementer's) with `ticket.py merge <pr> --batch`.
   `merge --batch` runs verify itself: it brings the batch branch in only when
   the merge is clean, the diff is unchanged and verify is green. If it
   refuses (conflict, changed diff or failing verify): `git fetch`,
   `git merge origin/<batch>`, resolve, re-verify, push, update the PR body's
   `Probes:` line, and run `merge` again. After any fix, verify again.
   If `merge` stops after GitHub merged the PR, run it again; it finishes the
   bookkeeping.
4. A stuck ticket stops only its dependants; carry on with the rest. A
   dependant of a ticket still in review unblocks when that blocker lands on
   the batch branch (`merge --batch` removes the edge). Until then `status`
   may list it as ready-for-agent, with "(blocked by #n)" beside it; don't
   start it.
5. At the end: merged tickets already have their `done` handoff, and a
   ticket that hit the failure ladder already has its `stuck` one. Post a
   handoff only on tickets still `in-progress`. Then tell the orchestrator with
   `ticket.py note <spec> --keyword "Batch report" --file <report>`: what landed,
   what is stuck, the batch branch, and every ticket's handoff **Decisions**
   entry with what it costs if wrong.

**No sub-agents in this harness:** build the frontier tickets one at a time,
not in parallel. The relay starts a fresh session for each `Build #n` job it
gets from `next`, with its own `AGENT_SIGNATURE`; each session does one ticket
through `steps/build.md` and merges its own PR. Never carry several tickets in
one context.

**Single-session mode:** the orchestrator hands the batch to one implementer
sub-agent, signed `implementer#1`. It builds the frontier tickets one at a
time through `batch next` and each one's own PR (`bt-implement-spec`, "No
sub-agents available"), then posts the `Batch report`. A sub-agent never
starts sub-agents.

**Orchestrator, at the end:**

1. `ticket.py batch end --tickets … --spec <spec> --probes "<command> green
   N/N"` (its count is ignored; `batch end` computes N/N). It ends the batch
   and opens the batch PR (batch branch into the integration branch).
2. Review the whole batch diff on that PR (`steps/review.md`), then
   `ticket.py merge <batch PR>`.
3. Report to the owner: batch landed, or what's stuck. List every
   handoff's **Decisions** entry, each with what it costs if wrong; that
   list is the only place the agents' decisions reach the owner.

**Relay halts.** `relay.py` exits 3 and notifies the owner when a session ends
with no progress or two sessions in a row fail. Then a fresh sub-agent reads
`relay.py log --tail 100` and returns a short summary (as in failure-ladder
step 2); you relay it and follow `steps/decisions.md`. Housekeeping releases
the halted relay's claims (`ticket.py stale --release`, rule b).

The owner hears from a batch three times: the proposal, a stuck ticket
(dependants only), and the end report.
