# GitHub contract

Contract-Version: 7.6

The same in every repo; don't edit it here. Project-specific settings and rules
go in `docs/agents/project.json` and `docs/agents/project.md`. Every action
below goes through `python3 tools/agents/ticket.py`, so label, comment and
signature always happen together, the same way in every harness.

## Identity

- One shared GitHub account. Sign every comment and PR body with a last line
  `— <role>`, where the role is `orchestrator` or `implementer` (`ticket.py`
  adds it; pass `--as` or set `AGENT_SIGNATURE`). Old long forms
  `— <role> · <harness> · <model>` still parse, but new comments carry only
  the identity (`implementer#2` for a tagged sub-agent). Roles aren't tied to
  harnesses: any harness and model can play either, and one session can play
  both by running the implementer as sub-agents.
- Instance tag: a role may carry a tag, `implementer#2` (letters, digits, `_`,
  `-`), so implementers working tickets in parallel stay apart. Every role
  rule (who reviews, merges, releases) uses the role alone; `implementer#1`
  cannot review `implementer#2`'s PR. A claim records the full identity, and
  `next`, `handoff` and `set needs-info` need an exact match: an untagged
  implementer does not take over a tagged claim, or the reverse. Only the
  orchestrator's `release` ends a claim held by another identity. No tag
  behaves as before.
- Keywords are the first line of a signed comment: `Claimed`,
  `Claim released`, `Claim retracted`, `Handoff`, `Reviewing`, `Approved`,
  `Changes requested`, `Batch`, `Batch ended`, `Landed`, `Tried`,
  `Integration`, `Base merged`, `Paid run`, `Completed`, `Closed`, `Ready`,
  `Status`, `Filed`, `Blocked`, `Resolved`, and the note keywords below. Comments
  go through `ticket.py note`.
- `AGENT_SIGNATURE` is per session and per sub-agent, set at launch or
  passed as `--as`; it isn't a fixed project setting. `ticket.py` refuses an
  `--as` whose identity differs from it. An orchestrator that spawns
  implementer sub-agents gives each its own signature (`implementer#<n>`), set
  as that sub-agent's `AGENT_SIGNATURE` (or `--as`, with the variable unset or
  equal); a sub-agent never inherits the orchestrator's. Shell state doesn't
  persist between tool calls, so a sub-agent exports it in every shell command.
- Which harness, model and effort plays each role lives in `project.json`'s
  `roles` table: `harness`, free-text `model` and `effort` (`default` means the
  harness default), and optional `model_args` (the argv words proved by setup)
  and `agent_file`. `setup.py check --quick` prints one Roles line, so every
  session tells the owner which models are in use. The code reads that table;
  models never appear in signatures.
- **Raw `gh` writes:** four, and only these: `gh pr create` (`bt-pr`);
  `gh pr edit` for the PR body (its `Probes:` line);
  `gh issue edit` for a ticket's body or `needs-triage`; `gh issue create -R
  <master_repo>` for a Baton candidate from `bt-retro`. Every other write goes
  through `ticket.py`: comments (`ticket.py note <n> --file f`), status,
  merge, close, labels. Reads use `gh`.
- Reviews are signed PR comments. Never `gh pr review --approve`: GitHub
  rejects self-approval on one account (HTTP 422).
- Repos are private by default. Still never post secrets, tokens, `.env`
  contents or raw logs in issues, PRs or comments. Evidence (test runs, revert
  proofs) goes in the PR body's Evidence section, or a signed comment for long
  output, with secrets redacted; it's committed to a branch only if
  `project.json` sets `evidence_dir`.

## Labels

Defined in `docs/agents/labels.json`; apply with `ticket.py labels --apply`.

| Status (exactly one) | Meaning |
|---|---|
| `ready-for-agent` | Matches its template; startable once no open blockers |
| `in-progress` | Claimed |
| `needs-review` | PR open; the other role reviews |
| `needs-info` | Waiting on an owner decision |
| `ready-for-human` | Agents stop; the owner decides |
| `landed-on-integration` | Merged into an integration branch; open until `main` |

- `spec` parents carry `spec` only. `needs-triage` means no status yet.
- `wayfinder:*` issues are exempt from the status count.
- `bug` / `enhancement` are triage categories for raw issues only; filed
  tickets use their `Type:` line.
- Blocked is never a label: use GitHub's native dependencies.

Allowed moves (anything else is refused):

| From | To |
|---|---|
| no status | `ready-for-agent` (`check --promote`; a decision goes to `needs-info`), `needs-info`, `ready-for-human` |
| `ready-for-agent` | `in-progress` (`claim`), `needs-info`, `ready-for-human` |
| `in-progress` | `needs-review` / `ready-for-agent` / `needs-info` (`handoff` done / partial / stuck) |
| `needs-review` | `ready-for-agent` (changes), `landed-on-integration` (`merge`), `needs-info` (review limit) |
| `needs-info` | `ready-for-agent`, `ready-for-human`, `needs-review` (owner accepts as is) (`set`, with the owner's answer) |
| `ready-for-human` | `ready-for-agent`, `needs-info` |

## Commands

| Do | Command |
|---|---|
| Check a draft offline | `ticket.py lint ticket\|pr\|handoff <file>` |
| File a ticket | `ticket.py new --title T --file body.md [--parent P] [--blocked-by N,M] [--from N]` |
| Small fix, no spec | `ticket.py quick --title T --what W --verify CMD [--parent P]` (files a `fix`, makes it ready; the implementer also claims it) |
| Wayfinder map or ticket | `ticket.py new --title T --file body.md --label wayfinder:<type>` (no template; never a status) |
| Add a blocking edge later | `ticket.py block <n> --by <m>` |
| Check / promote | `ticket.py check <n> [--promote]` (promote: orchestrator) |
| Claim | `ticket.py claim <n>` |
| Hand off (claimant only) | `ticket.py handoff <n> --file handoff.md` |
| Tried (claimant only) | `ticket.py tried <n> --file <f>` (counts fix attempts; a `Ladder` note restarts the count) |
| Other status moves | `ticket.py set <n> <status> --note "<why>" [--owner "<owner's words>"]` |
| Review | `ticket.py review <pr> start`, then `approved --head <sha> --file evidence.md` or `changes --file findings.md` (`--head` is the commit you read, 7+ characters) |
| Merge | `ticket.py merge <pr> [--batch] [--owner-go-ahead "<owner's words>"]` (after a `setup/*` PR it also merges `main` into every open `spec/*` and `batch/*` branch and pushes each) |
| Revert check | `ticket.py revert-check <pr>` or `revert-check --base <ref> --head <ref>` (`<pr>` reads GitHub; `--base/--head` uses git and verify only; verify on the head with its non-test files put back as on the base; prints the `Revert check:` line, exits 1 when it can't prove it: FAILED, verify failing on the head, or a command that can't run; the two "no test files" and "no non-test files" results exit 0; `review approved` refuses the three) |
| Close | `ticket.py close <n> --reason completed\|not-planned\|duplicate\|wontfix [...]` |
| Decide a two-way ticket (orchestrator) | `ticket.py decide <n> --file f` (`Choice:`, `Evidence:`, `Undo:`; posts `Decided` and closes; see `steps/decisions.md`) |
| Integration branch | `ticket.py integration --spec <n>` (orchestrator) |
| Batch run | `ticket.py batch start --tickets N,M --spec <n>` / `batch end --tickets N,M --spec <n> --probes "…"` |
| Batch frontier | `ticket.py batch next <spec>` (read-only: free frontier tickets and free slots) |
| Signed note | `ticket.py note <n> --keyword Note\|Resolution\|"Batch report"\|Ladder\|Report\|Decided\|Cleanup\|Survey\|Housekeeping\|Retro\|Shipped --file f` |
| Audit | `ticket.py audit [--timeline]` |
| Status | `ticket.py status` |
| Whose turn | `ticket.py next --role implementer\|orchestrator\|owner [--wait 4h]` (prints nothing if none; for the orchestrator a stderr line says whether work is in flight or only the owner can unblock; `--wait` keeps checking every `--every` seconds, default 120, with one cheap call per check and a full check only when the repo changed; run it in the background, because tool calls time out) |
| Stale claims | `ticket.py stale [--release]` (activity-based; see Claims) |
| Long command | `job.py run --name <n> -- <cmd>`, `job.py wait <n> --max 9m`, `job.py tail <n> -n 20`, `job.py status`: detached, with a safety `--limit` (project.json `job_limit`); every output is one line or a capped tail |
| Verify receipt | `job.py verify` (runs the project's verify command and records the receipt) |
| Paid run (orchestrator) | `ticket.py paid-run <decision> -- <command>` (needs the owner's approval on that ticket; once per approval; the only way to set the paid switch) |
| Wait for verify | `job.py wait verify --max 9m` (repeat while it says "running") |
| Relay (two-harness mode) | `relay.py start --as implementer#<n> [--detach] [--once] [--max-jobs N]`, `stop`, `status`, `log --tail N` (orchestrator only) |
| Worktree | `ticket.py worktree <branch> [--create --base <branch>]` |
| Tidy | `ticket.py tidy [--dry-run]` (removes worktrees of merged branches, never forced and never the current one, and only when nothing in them is lost: untracked and ignored files other than closed tickets' `.work/tickets/<n>/`, `.work/jobs/` and bytecode keep the worktree, and paid-run logs move to the main worktree first; `.work/tickets/<n>/` of closed tickets; receipts of commits no ref or worktree HEAD reaches; relay logs beyond the newest `keep_session_logs`; paid-run logs stay) |

Put `--dry-run` before the subcommand to print the `gh` calls instead of making
them: `ticket.py --dry-run merge <pr>`.

## Tickets

- Templates: `docs/agents/templates/<type>.md`. Types: `slice`, `bug`,
  `decision`, `spec`, `cleanup`, `research`, `fix`.
- Every ticket has `Type:`, `Part of:` and `Blocked by:` lines, the type's
  sections, `## Acceptance criteria` (checkboxes, each naming its proof:
  command, probe or test) and `## Out of scope`. No `TBD`, `TODO` or `<...>`.
- Sub-issues for parents (`--parent`); native dependencies for blocking
  (`--blocked-by`), also written in the `Blocked by:` line.
- Small fixes ship together under one owner go-ahead: setup files a standing
  spec "Small fixes" with its integration branch and records its number as
  `small_fixes_spec` in `project.json`; `quick` files under it by default
  (`--parent` overrides), and it ships like any spec. Set it to null to make
  `quick` tickets land on `main` one by one.
- Bugs found anywhere are filed on the bug template (`new --from <n>`), never
  left as a comment.

## Close rules (orchestrator)

| Type | Closes as completed when |
|---|---|
| slice, bug, cleanup | Its commit is on `main` (`--commit <sha>`) |
| decision | The owner has answered (`--answer <comment URL>`) |
| research | The findings are linked (`--findings <link>`) |
| spec | Its ship PR has merged and no ticket under it is open: `merge` closes it, else `close <spec> --reason completed`. Never the standing Small fixes spec; any other reason is the owner's |
| wayfinder ticket | Its answer is posted (`--answer <comment URL>`, or `--findings`) |

Not-planned, duplicate and wontfix closes need `--note` with the reason, and close the ticket's open PR (not for a duplicate).
Merging into `main` closes its tickets and any landed tickets now on `main`.

## Status moves

- `in-progress` comes only from `claim`; `landed-on-integration` only from
  `merge`; `needs-review` from a `done` handoff (or, from `needs-info`, when
  the owner accepts the work as it is).
- `handoff` moves only the claimant's own `in-progress` ticket. On a
  `needs-info` ticket it may only be `stuck`, which records state and keeps
  the ticket waiting on the owner.
- The handoff's State commit must be on GitHub (on `origin/<branch>`, with a
  clean worktree), and for `done` it must be the PR's head. `stuck` only
  gets a note.
- The implementer's only `set` is its own in-progress ticket to `needs-info`
  (a question for the owner). Every other `set` is the orchestrator's.
- Leaving `needs-info` or `ready-for-human` needs `--owner` with the owner's
  words.
- Notes: `Decided`, `Report`, `Cleanup`, `Survey`, `Housekeeping`, `Retro` and
  `Shipped` are the orchestrator's; `Ladder` and `Batch report` the
  implementer's. Contract keywords (`Claimed`, `Batch`, `Approved`, …) are
  written only by their own commands.
- Specs and decision tickets are never claimed.

## Branches and merges

- Names: `ticket/<n>-<slug>`; `spec/<n>-<slug>` (integration, made by
  `ticket.py integration`); `batch/<spec>-<time>` (made by `batch start`);
  `prototype/<name>` and `research/<name>` (never merged; deleted when their
  ticket closes).
- A ticket's base is its active batch's branch, else its spec's integration
  branch, else `main`; `claim` prints it. Commit messages include `#<n>`.
- The setup PR that installs baton is merged by the owner on GitHub; it's the
  one PR before the contract applies. Later `setup/*` PRs merge into `main`
  through `merge`: a fresh reviewer's `Approved`, verify, and the owner's
  go-ahead, except a MINOR contract sync (`setup/sync-*`; `merge` reads both
  versions), which is reported instead.
- Worktrees: the path `ticket.py worktree <branch>` prints
  (`<workspace>/.worktrees/<repo>/<branch>`). Remove only after merge, with
  `ticket.py tidy`.
- One session pushes a branch. Bring the base in with `git merge
  origin/<base>`, never a rebase or force-push of a pushed branch. Push fixes
  to the open PR's branch; one PR per ticket.
- The orchestrator merges (in a batch, the implementer merges its own PR), with
  a merge commit, the PR title as subject and the `Probes:` line as body.
  `merge` checks everything before it writes:
  - the head has a passing verify receipt, or `merge` runs verify itself;
  - the branch contains the base's latest commit. If it doesn't, `merge`
    brings the base in itself (below) instead of refusing;
  - every `Closes` ticket is `needs-review`, and none is a spec;
  - the latest review is `Approved`, after any `Changes requested`, for the
    PR's current head commit (`approved --head <sha>` names the commit the
    reviewer read, 7+ characters; it refuses if the head moved, and a later
    push needs a new approval).
- **Approval survives a clean base merge.** When the PR's branch is behind its
  base, `merge` (any PR: integration branch, batch branch or `main`) merges the
  base into the branch in a scratch worktree, never the implementer's. It
  refuses on any conflict; refuses unless the PR's own change is unchanged
  (`git patch-id --stable` of `merge-base..head` equal before and after);
  refuses if `verify_command` fails on the merged result. Then it pushes the
  merge commit, posts a `Base merged` note (`From:` the approved head, `Head:`
  the new one) and merges.
  - The approval stays valid for exactly the heads such notes chain to. Any
    other push, including an agent's own base merge, needs a new approval.
  - `main` still needs the owner's go-ahead.
  - `ticket.py audit` re-checks every `Base merged` note (check
    `base-merged-unverified`): signed; Head a merge of From; patch-id
    recomputed; commits fetchable.
- Who approves:
  - Ticket PRs: the other role than the author's (a tag doesn't make a
    different role). The same harness and model may play both roles; the
    approval then says so.
  - Integration and batch PRs (`spec/*`, `batch/*` heads): a fresh reviewer
    sub-agent's findings; the orchestrator posts the verdict, since they only
    carry already-handled tickets.
  - Into `main`: also the owner's go-ahead in that session. An integration
    PR also needs a `Cleanup` note on its spec (the final review's cleanup
    tickets, or "none found").
  - Batch run: the implementer merges ticket PRs into the `batch/*` branch
    the orchestrator set, after a passing verify receipt for the head, or
    `merge` runs verify itself. Those ticket PRs get no review: no `Approved`
    needed in a batch. The batch PR does (above). `batch end` opens it; the
    orchestrator reviews and merges it.
- The implementer never merges into a shared branch outside a batch run.

## PR body

Template: `docs/agents/templates/pr.md`. `Closes #<n>`, `Part of #<p>`, a
`Probes: <command> <green|red + reason>` line, then `## Summary`,
`## Evidence`, `## Merge Danger`, then the signature line.

## Claims

- `claim` refuses if another signed claim is active or the ticket has open
  blockers.
- A claim is stale by activity, never by elapsed time, when any of these holds:
  - (a) its batch has `Batch ended` and the ticket is still `in-progress`
    with no handoff;
  - (b) the relay that held it halted, or its session ended without progress
    (the relay's signed `Note`, "Relay halted…" or "Relay session ended
    without progress…"), and the claimant has made no signed comment or commit
    since;
  - (c) the claimant moved on (a `done` or `stuck` handoff, or a claim, on
    another ticket) and has made no signed comment or commit on this one since.
    Not applied inside an active batch, where one session works several tickets.

  Housekeeping releases them with `ticket.py stale --release`; branch and work
  are kept.
- `next --role implementer` offers "Run the batch on spec #n (target batch/…)"
  while a batch is active, has no `Batch report` and still has a ticket that
  hasn't landed or gone to the owner. A relay is offered only that job for the
  batch's tickets (never "Build #n"); an interactive implementer sees it only
  while nobody holds a claim in the batch, and keeps its "Build #n" jobs.

## Enforcement

- `merge` also refuses a ticket PR whose base isn't the ticket's Base, and a
  PR with failing or pending CI checks, and merges only the head it checked.
  A `.github/workflows/verify.yml` runs the verify command on every PR; with it
  present, that remote run is the independent proof of the head the receipt backs.
- Entering `needs-info` or `ready-for-human`, and `batch end`, run
  `notify_command` from `project.json`, whichever role made the move. It runs
  without a shell; `{message}` is replaced in one argument and the message is
  also passed as `BATON_MESSAGE`. A shell wrapper should read `$BATON_MESSAGE`
  instead of using `{message}`, so a ticket title can't run as shell code.
- Git hooks (`core.hooksPath=tools/agents/hooks`, enabled by setup) refuse
  pushes to `main`, force-pushes, deleting `main`, `spec/*` or `batch/*`, and
  commits that add obvious keys; the guard refuses `--no-verify`.
- The gh guard allows reads and the raw writes listed under Identity, and
  refuses every other gh write, naming the `ticket.py` command to use. The route that works in every harness, with no
  hooks, is `tools/agents/guard` first on the harness's PATH (recorded in
  `project.md`; for Claude Code, `setup.py check --fix` sets it in
  `.claude/settings.local.json`). Claude Code's PreToolUse hook
  (`.claude/settings.json`, gh and git) is optional: managed-hooks-only
  policies never run it. Either route leaves a marker in the git common dir,
  and `setup.py check` warns when the guard has not been seen.
- `.github/workflows/agents-contract.yml` checks every issue and PR on open
  and edit, comments when one breaks the contract, and reopens a slice, bug
  or cleanup closed without its commit on `main`.
