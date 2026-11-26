"""ticket.py: the GitHub contract as one command.

Every label change, claim, handoff, review, merge and close goes through this
script, so every harness does them the same way. Standard library only; it
shells out to `gh` and `git`. Run `ticket.py -h` for the commands.

Signature: pass --as "<role>" or set AGENT_SIGNATURE (role may carry an
instance tag, implementer#2, for parallel sub-agents). Old long signatures
("<role> · <harness> · <model>") still parse; writing uses the role alone.
Role: orchestrator or implementer. Roles aren't tied to harnesses: which
harness and model plays a role is recorded in project.json's `roles` table.
Every command checks everything first and writes only when all checks pass.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .model import ContractError, identity_of
from .github import Ctx, Runner
from .claims import cmd_claim, cmd_handoff, cmd_release, cmd_tried
from .batch import cmd_batch, cmd_integration, cmd_small_fixes
from .decisions import cmd_close, cmd_decide, cmd_paid_run, cmd_set
from .review import cmd_review
from .merge import cmd_merge
from .revert import cmd_revert_check
from .tickets import (
    cmd_block, cmd_check, cmd_labels, cmd_lint, cmd_lint_event, cmd_new, cmd_note, cmd_quick,
    cmd_sync, cmd_worktree,
)
from .reports import cmd_next, cmd_report, cmd_stale, cmd_status
from .audit import cmd_audit
from .tidy import cmd_tidy


def find_root(start: Path) -> Path:
    for q in [start, *start.parents]:
        if (q / "docs/agents/labels.json").exists():
            return q
    raise ContractError("No docs/agents/labels.json found here or above; run from a set-up project")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="ticket.py", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--as", dest="sig", help='identity "<role>", e.g. implementer#2 (or AGENT_SIGNATURE)')
    p.add_argument("--dry-run", action="store_true", help="print write commands instead of running them")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("lint", help="check a draft body file offline")
    s.add_argument("kind", choices=["ticket", "pr", "handoff"]); s.add_argument("file")
    s.add_argument("--head", help="for a PR: its head branch (spec/* and batch/* use 'Part of'); default: the current branch")
    s.add_argument("--base", help="for a PR: its base branch (default: the project's main branch); "
                   "a spec/* PR into a batch base may close its tickets")
    s.set_defaults(fn=cmd_lint)

    s = sub.add_parser("new", help="file a ticket from a body file (linted first)")
    s.add_argument("--title", required=True); s.add_argument("--file", required=True)
    s.add_argument("--parent", type=int); s.add_argument("--blocked-by")
    s.add_argument("--from", dest="from_issue", type=int, help="ticket or PR where it was found")
    s.add_argument("--label", help="wayfinder:* only (maps and their tickets skip the template check)")
    s.set_defaults(fn=cmd_new)

    s = sub.add_parser("quick", help="file a small fix and make it ready (claimed too, if you are the implementer)")
    s.add_argument("--title", required=True); s.add_argument("--what", required=True)
    s.add_argument("--verify", required=True, help="the command that proves it")
    s.add_argument("--parent", type=int, help="default: project.json small_fixes_spec (the Small fixes spec), else none")
    s.add_argument("--acceptance", action="append", help="an extra criterion naming its proof (repeatable)")
    s.add_argument("--out-of-scope", action="append", help="something this must not touch (repeatable)")
    s.add_argument("--touches", action="append", help="a file or module it touches (repeatable, or comma-separated)")
    s.set_defaults(fn=cmd_quick)

    s = sub.add_parser("check", help="check a ticket against its template and labels")
    s.add_argument("number", type=int); s.add_argument("--promote", action="store_true")
    s.set_defaults(fn=cmd_check)

    s = sub.add_parser("claim", help="claim a ready ticket"); s.add_argument("number", type=int)
    s.set_defaults(fn=cmd_claim)

    s = sub.add_parser("handoff", help="post a handoff (claimant only) and set the label from its Status")
    s.add_argument("number", type=int); s.add_argument("--file", required=True)
    s.add_argument("--no-red-proof", help="bug handoff whose test and fix share a commit; the owner sees why")
    s.set_defaults(fn=cmd_handoff)

    s = sub.add_parser("release", help="release a stale claim (orchestrator)")
    s.add_argument("number", type=int); s.add_argument("--reason")
    s.set_defaults(fn=cmd_release)

    s = sub.add_parser("set", help="move a ticket to another status, with a reason")
    s.add_argument("number", type=int); s.add_argument("status"); s.add_argument("--note")
    s.add_argument("--owner", help="the owner's words, needed to leave needs-info or ready-for-human")
    s.set_defaults(fn=cmd_set)

    s = sub.add_parser("review", help="review a PR: start, approved, or changes")
    s.add_argument("number", type=int); s.add_argument("action", choices=["start", "approved", "changes"])
    s.add_argument("--file")
    s.add_argument("--head", help="for approved: the commit SHA you read (7+ characters)")
    s.add_argument("--owner", help="for approved on an owner-review PR: the owner's words")
    s.set_defaults(fn=cmd_review)

    s = sub.add_parser("merge", help="merge a PR under the contract's rules")
    s.add_argument("number", type=int); s.add_argument("--batch", action="store_true")
    s.add_argument("--owner-go-ahead"); s.set_defaults(fn=cmd_merge)

    s = sub.add_parser("revert-check", help="prove a PR's tests fail without its fix; prints the `Revert check:` line")
    s.add_argument("number", type=int, nargs="?")
    s.add_argument("--base", help="without a PR: the ref the change branched from (git and verify only, no GitHub)")
    s.add_argument("--head", help="without a PR: the ref with the change")
    s.set_defaults(fn=cmd_revert_check)

    s = sub.add_parser("close", help="close a ticket under its type's close rule (orchestrator)")
    s.add_argument("number", type=int)
    s.add_argument("--reason", required=True, choices=["completed", "not-planned", "duplicate", "wontfix"])
    s.add_argument("--commit"); s.add_argument("--answer"); s.add_argument("--findings"); s.add_argument("--note")
    s.add_argument("--owner", help="the owner's words, when closing a one-way decision")
    s.set_defaults(fn=cmd_close)

    s = sub.add_parser("decide", help="orchestrator decides a two-way ticket and closes it")
    s.add_argument("number", type=int); s.add_argument("--file", required=True)
    s.set_defaults(fn=cmd_decide)

    s = sub.add_parser("paid-run", help="run an owner-approved paid run once, with the paid switch on (orchestrator)")
    s.add_argument("number", type=int, help="the decision ticket the owner approved it on")
    s.add_argument("command", nargs="*", help="-- then the command")
    s.set_defaults(fn=cmd_paid_run)

    s = sub.add_parser("note", help="post a signed note (reports, decisions, ladder starts)")
    s.add_argument("number", type=int); s.add_argument("--keyword", default="Note")
    s.add_argument("--file", required=True); s.set_defaults(fn=cmd_note)

    s = sub.add_parser("tried", help="post a numbered fix attempt (claimant only)")
    s.add_argument("number", type=int); s.add_argument("--file", required=True)
    s.set_defaults(fn=cmd_tried)

    s = sub.add_parser("block", help="add a blocking edge: <n> is blocked by --by")
    s.add_argument("number", type=int); s.add_argument("--by", type=int, required=True)
    s.set_defaults(fn=cmd_block)

    s = sub.add_parser("integration", help="create a spec's integration branch (orchestrator)")
    s.add_argument("--spec", type=int, required=True); s.set_defaults(fn=cmd_integration)

    s = sub.add_parser("small-fixes", help="create the standing Small fixes spec and its branch (orchestrator)")
    s.set_defaults(fn=cmd_small_fixes)

    s = sub.add_parser("batch", help="start a batch, end it, or list its frontier")
    s.add_argument("action", choices=["start", "end", "next"]); s.add_argument("spec_pos", nargs="?", type=int)
    s.add_argument("--tickets"); s.add_argument("--spec", type=int); s.add_argument("--probes")
    s.add_argument("--note"); s.set_defaults(fn=cmd_batch)

    s = sub.add_parser("status", help="open tickets grouped by status"); s.set_defaults(fn=cmd_status)

    s = sub.add_parser("report", help="print the factual part of a report from GitHub")
    s.add_argument("--spec", type=int, help="limit to one spec's tickets and PRs")
    s.set_defaults(fn=cmd_report)

    s = sub.add_parser("next", help="the one job that is this role's turn (prints nothing if none)")
    s.add_argument("--role", required=True, choices=["implementer", "orchestrator", "owner"])
    s.add_argument("--wait", help="keep checking for this long (90s, 30m, 4h or seconds)")
    s.add_argument("--every", type=float, default=120, help="seconds between checks with --wait (default 120)")
    s.set_defaults(fn=cmd_next)

    s = sub.add_parser("stale", help="list (and optionally release) stale claims: activity, not time")
    s.add_argument("--release", action="store_true")
    s.set_defaults(fn=cmd_stale)

    s = sub.add_parser("labels", help="compare repo labels with labels.json")
    s.add_argument("--apply", action="store_true"); s.set_defaults(fn=cmd_labels)

    s = sub.add_parser("worktree", help="print (or create) the worktree path for a branch")
    s.add_argument("branch"); s.add_argument("--create", action="store_true"); s.add_argument("--base")
    s.set_defaults(fn=cmd_worktree)

    s = sub.add_parser("tidy", help="remove merged worktrees, closed tickets' .work dirs, stale receipts and old relay logs")
    s.add_argument("--dry-run", dest="tidy_dry", action="store_true", help="print what would be removed")
    s.set_defaults(fn=cmd_tidy)

    s = sub.add_parser("sync", help="refresh the local tracker copy (a disposable GitHub cache)")
    s.add_argument("--rebuild", action="store_true", help="delete the copy and fetch everything again")
    s.add_argument("--status", action="store_true", help="print counts, last sync and file size; no network")
    s.set_defaults(fn=cmd_sync)

    s = sub.add_parser("audit", help="count contract violations in this repo's history")
    s.add_argument("--limit", type=int, default=200)
    s.add_argument("--timeline", action="store_true", help="also check label changes (one API call per issue)")
    s.set_defaults(fn=cmd_audit)

    s = sub.add_parser("lint-event", help="GitHub Action entry point")
    s.add_argument("--act", action="store_true"); s.set_defaults(fn=cmd_lint_event)
    return p


def main(argv: list[str] | None = None, runner_factory=Runner) -> int:
    if os.environ.get("BATON_SMOKE_MARK"):                  # setup.py smoke's proof that ticket.py ran
        Path(os.environ["BATON_SMOKE_MARK"]).touch()
    a = build_parser().parse_args(argv)
    try:
        if a.cmd == "lint":
            return cmd_lint(None, a)
        env_sig = os.environ.get("AGENT_SIGNATURE")
        if a.sig and env_sig and identity_of(a.sig) != identity_of(env_sig):
            raise ContractError(f"--as says '{a.sig}' but this session is '{env_sig}' (AGENT_SIGNATURE); "
                                "sign as the role you are")
        root = find_root(Path.cwd().resolve())
        ctx = Ctx(root, runner_factory(root, a.dry_run), a.sig or env_sig)
        return a.fn(ctx, a) or 0
    except ContractError as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2

