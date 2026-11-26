from __future__ import annotations

import argparse
import datetime as dt
import re

from .model import (
    CLOSE_ON_MAIN, ContractError, KW_DECIDED, KW_LANDED, KW_PAID_RUN, active_claim,
    decision_note_problems, door_field, identity_of, is_wayfinder, keyword_comments, label_names,
    children_of, integration_branch, parent_of, parse_signature, strip_comments, ticket_type,
)
from .github import read_file, report
from .nextjob import answer_on_ticket, owner_answer_ok


# Moves made only by their own commands, never by `set`.
OWN_COMMAND = {"in-progress": "claim", "landed-on-integration": "merge"}


def cmd_set(ctx, a):
    if not a.note:
        raise ContractError("--note is required: a label change always comes with its reason")
    issue = ctx.issue(a.number)
    src, dst = ctx.status(issue), a.status
    if dst in OWN_COMMAND:
        raise ContractError(f"'{dst}' is set by `ticket.py {OWN_COMMAND[dst]}`, never by `set`")
    role = ctx.role()
    if role == "implementer":
        claim = active_claim(issue["comments"])
        if not (src == "in-progress" and dst == "needs-info" and claim
                and identity_of(parse_signature(claim["body"])) == ctx.identity()):
            raise ContractError("The implementer may only move its own in-progress ticket to needs-info "
                                "(a question for the owner); other moves are the orchestrator's")
    if src in ("needs-info", "ready-for-human") and not a.owner:
        raise ContractError(f"Leaving '{src}' needs the owner's answer: --owner \"<their words>\"")
    if dst == "needs-review" and src != "needs-info":
        raise ContractError("needs-review comes from a done handoff; `set` reaches it only when the "
                            "owner accepts work as it is (from needs-info)")
    note = f"→ {dst}: {a.note}" + (f"\nOwner: \"{a.owner}\"" if a.owner else "")
    ctx.transition(issue, dst, "Status", note)
    print(f"#{a.number} → {dst}")
    return 0


def unblock_dependants(ctx, n: int):
    """A landed ticket stays open, so remove its edges onto tickets it blocks."""
    try:
        blocker_id = ctx.r.json(["gh", "api", f"repos/{ctx.repo()}/issues/{n}", "--jq", "{id: .id}"])["id"]
        deps = ctx.r.json(["gh", "api", f"repos/{ctx.repo()}/issues/{n}/dependencies/blocking"]) or []
    except (ContractError, TypeError, KeyError):
        print(f"note: couldn't list issues blocked by #{n}; remove those edges by hand")
        return
    for d in deps:
        ctx.r.run(["gh", "api", "--method", "DELETE",
                   f"repos/{ctx.repo()}/issues/{d['number']}/dependencies/blocked_by/{blocker_id}"],
                  write=True, check=False)


def close_landed(ctx):
    """After a merge into main, close landed tickets whose commit is now on main."""
    issues = ctx.mirror_or_gh(lambda m: m.issues("open", label="landed-on-integration", limit=200),
                              ["gh", "issue", "list", "--state", "open", "--label",
                               "landed-on-integration", "--json", "number,comments", "--limit", "200"])
    for i in issues:
        landed = keyword_comments(i["comments"], KW_LANDED)
        m = re.search(r"as ([0-9a-f]{7,40})", landed[-1]["body"]) if landed else None
        if m and ctx.on_branch(m.group(1), ctx.main):
            ctx.comment("issue", i["number"], "Completed", f"Completed in {m.group(1)}, now on {ctx.main}.")
            ctx.r.run(["gh", "issue", "close", str(i["number"]), "--reason", "completed"], write=True)


def cmd_close(ctx, a):
    ctx.need_role("orchestrator", "close tickets")
    issue = ctx.issue(a.number)
    ttype = ticket_type(issue["body"])
    spec_pr = None
    if "spec" in label_names(issue["labels"]):
        if a.reason != "completed":
            raise ContractError("Agents close a spec only as completed, when it is done; any other close is the owner's")
        if ctx.project.get("small_fixes_spec") == a.number:
            raise ContractError(f"#{a.number} is the standing Small fixes spec: a queue reused across ships, never closed")
        given = getattr(a, "ship_pr", None)           # merge hands over the PR it just merged
        spec_pr, still_open = spec_state(ctx, issue, [given] if given else None)
        if not spec_pr:
            raise ContractError(f"Spec #{a.number} isn't done: its ship PR (Part of #{a.number}, into {ctx.main}) hasn't merged")
        if still_open:
            raise ContractError(f"Spec #{a.number} isn't done: still open under it: {', '.join(f'#{n}' for n in still_open)}")
        note = f"Completed: ship PR #{spec_pr['number']} merged into {ctx.main}; no ticket under it is open."
    elif a.reason == "completed" and is_wayfinder(issue["labels"]) and ttype is None:
        if not (a.answer or a.findings):
            raise ContractError("A wayfinder ticket resolves on its answer: --answer <comment URL> "
                                "(or --findings for research)")
        note = f"Resolved: {a.answer or a.findings}"
    elif a.reason == "completed":
        if ttype in CLOSE_ON_MAIN:
            if not a.commit or not ctx.on_branch(a.commit, ctx.main):
                raise ContractError(f"A {ttype} closes as completed only when --commit is on {ctx.main}")
            note = f"Completed in {a.commit} on {ctx.main}."
        elif ttype == "decision":
            if not a.answer:
                raise ContractError("A decision closes on the owner's answer: --answer <comment URL>")
            words = getattr(a, "owner", None)
            if not answer_on_ticket(a.answer, issue["comments"]):
                raise ContractError(f"--answer must link a comment on #{a.number} itself (its `#issuecomment-` URL): "
                                    "the owner's comment there, or the Decided note you posted there with "
                                    f"`ticket.py note {a.number} --keyword Decided --file <f>`")
            if door_field(issue["body"]) == "one-way" and not owner_answer_ok(a.answer, issue["comments"], words):
                raise ContractError("A one-way decision needs the owner's answer: --answer <comment URL> "
                                    "for an unsigned comment, or --owner \"<their words>\"")
            note = f"Decided: {a.answer}" + (f"\nOwner: \"{words}\"" if words else "")
        elif ttype == "research":
            if not a.findings:
                raise ContractError("Research closes on its findings: --findings <link>")
            note = f"Findings: {a.findings}"
        else:
            raise ContractError(f"Unknown ticket type '{ttype}'")
    else:
        if not a.note:
            raise ContractError(f"Closing as {a.reason} needs --note with the reason and what it points at")
        note = f"Closed as {a.reason}: {a.note}"
    if not getattr(a, "skip_note", False):          # merge already posted Completed; don't say it twice
        ctx.comment("issue", a.number, "Closed", note)
    gh_reason = "completed" if a.reason == "completed" else "not planned"
    ctx.r.run(["gh", "issue", "close", str(a.number), "--reason", gh_reason], write=True)
    if a.reason != "completed":
        close_open_pr(ctx, a.number, a.reason)
    return 0


def close_open_pr(ctx, n: int, reason: str = "not-planned"):
    """A ticket closed as not planned or wontfix leaves no open PR behind: agents can't close a PR
    themselves, so this is the one route. A duplicate's PR may hold the work, so it stays open."""
    prs = ctx.mirror_or_gh(lambda m: m.prs("open", limit=300),
                           ["gh", "pr", "list", "--state", "open", "--limit", "300", "--json", "number,headRefName"])
    for p in prs:
        if (p.get("headRefName") or "").startswith(f"ticket/{n}-"):
            if reason == "duplicate":
                print(f"left PR #{p['number']} open: the work may live in it; close it yourself if not")
                continue
            ctx.comment("pr", p["number"], "Closed", f"Ticket #{n} was closed; see its Closed note. This PR will not merge.")
            ctx.r.run(["gh", "pr", "close", str(p["number"])], write=True)
            print(f"closed PR #{p['number']} with ticket #{n}")


def open_tickets_under(ctx, branch: str | None, spec: int | None, fresh: bool = False,
                       listed: set[int] = frozenset()) -> list[int]:
    """Numbers of open tickets under a spec: cut from its integration `branch`, `Part of` the spec,
    or among the `listed` entries of its Children section.
    `fresh` reads GitHub itself, for a check made right after this process closed tickets."""
    args = ["gh", "issue", "list", "--state", "open", "--limit", "300", "--json", "number,body,labels,comments"]
    issues = ctx.r.json(args) or [] if fresh else ctx.mirror_or_gh(lambda m: m.issues("open", limit=300), args)
    return sorted(i["number"] for i in issues if "spec" not in label_names(i["labels"])
                  and ((branch and ctx.spec_branch(i) == branch) or (spec and parent_of(i["body"]) == spec) or i["number"] in listed))


def spec_state(ctx, spec: dict, prs: list[dict] | None = None) -> tuple[dict | None, list[int]]:
    """(the spec's merged ship PR or None, open tickets under it). A ship PR has head `spec/<n>-...`
    or the spec's integration branch, base main, and `Part of #<n>`. A spec is done when it has
    one and nothing under it is open."""
    n, integ = spec["number"], integration_branch(spec["comments"])
    prs = prs if prs is not None else ctx.mirror_or_gh(
        lambda m: m.prs("merged", limit=300),
        ["gh", "pr", "list", "--state", "merged", "--limit", "300", "--json", "number,body,headRefName,baseRefName"])
    ship = next((p for p in prs if p.get("baseRefName") == ctx.main
                 and ((p.get("headRefName") or "").startswith(f"spec/{n}-") or p.get("headRefName") == integ)
                 and re.search(rf"^\s*Part of\s+#{n}\b", strip_comments(p.get("body") or ""), re.M | re.I)), None)
    return ship, (open_tickets_under(ctx, integ, n, fresh=True, listed=children_of(spec)) if ship else [])


def close_spec_if_done(ctx, n: int, pr: dict):
    """After a ship PR merges into main: close its spec when done, else say what keeps it open.
    The standing Small fixes spec is a queue reused across ships and never closes."""
    spec = ctx.issue(n)
    if ("spec" not in label_names(spec["labels"]) or spec["state"] != "OPEN"
            or ctx.project.get("small_fixes_spec") == n):
        return
    ship, still_open = spec_state(ctx, spec, [pr])
    if not ship:
        return                                       # a batch or other PR that names the spec, not its ship
    if still_open:
        print(f"Spec #{n} stays open: {', '.join(f'#{t}' for t in still_open)} still open under it; "
              f"close it with `ticket.py close {n} --reason completed` once they are done")
    elif ctx.r.dry_run:
        print(f"DRY-RUN: would close spec #{n} as completed")
    else:
        cmd_close(ctx, argparse.Namespace(number=n, reason="completed", commit=None, answer=None,
                                          findings=None, note=None, owner=None, skip_note=False,
                                          ship_pr=pr))
        print(f"Closed spec #{n}: ship PR #{pr['number']} merged and nothing under it is open")


def cmd_decide(ctx, a):
    """A two-way decision: the orchestrator records its reasoning and closes the ticket."""
    ctx.need_role("orchestrator", "decide")
    issue = ctx.issue(a.number)
    if issue["state"] != "OPEN":
        raise ContractError(f"#{a.number} isn't open")
    if ticket_type(issue["body"]) != "decision":
        raise ContractError(f"#{a.number} isn't a decision ticket")
    if door_field(issue["body"]) != "two-way":
        raise ContractError(f"#{a.number} is one-way: only the owner's answer closes it")
    body = read_file(a.file)
    problems = decision_note_problems(body)
    if problems:
        report(problems, f"Decided note for #{a.number}")
        raise ContractError("A two-way decision needs its choice, evidence and how to undo it")
    url = ctx.comment("issue", a.number, KW_DECIDED, body)
    cmd_close(ctx, argparse.Namespace(number=a.number, reason="completed", commit=None,
                                      answer=url, findings=None, note=None,
                                      owner=None, skip_note=False))
    print(f"Decided #{a.number} and closed it")
    return 0


OWNER_LINE = re.compile(r'^Owner: "(.*\S.*)"[ \t]*$', re.M)         # the line ticket.py writes
APPROVED_COMMENT = re.compile(r"\s*approved\b(?!\s*\?)", re.I)     # "Approved? Not yet" is a question


def paid_run_approval(comments: list[dict]) -> str | None:
    """Where the owner's approval sits: an orchestrator's Decided note with the exact `Owner: "<words>"`
    line ticket.py writes (that passes close's one-way owner-answer test), else an unsigned owner
    comment that starts with "Approved". None when neither: a comment that says anything else,
    or a Decided note with no owner words, is no approval."""
    for c in reversed(keyword_comments(comments, KW_DECIDED, by="orchestrator")):
        words = OWNER_LINE.search(c["body"])
        if words and owner_answer_ok(c.get("url") or "", comments, words.group(1)):
            return "the Decided note above"
    owner = any(not parse_signature(c.get("body")) and APPROVED_COMMENT.match(c.get("body") or "")
                for c in comments or [])
    return "the owner's comment above" if owner else None


def cmd_paid_run(ctx, a):
    """Run an owner-approved paid run: the one route that sets the paid switch.
    Code checks what the model can't be trusted to: the owner approved on this
    decision ticket, the approval hasn't been used, and the worktree is clean
    (paid runs never share a branch with code changes)."""
    ctx.need_role("orchestrator", "start a paid run")
    switch = (ctx.project.get("paid_run_switch") or "").strip()
    if not switch:
        raise ContractError("set paid_run_switch in docs/agents/project.json (the variable that turns paid calls on)")
    command = list(a.command or [])
    if command[:1] == ["--"]:
        command = command[1:]
    if not command:
        raise ContractError("give the command after --: ticket.py paid-run <n> -- <command...>")
    issue = ctx.issue(a.number)
    if ticket_type(issue["body"]) != "decision":
        raise ContractError(f"#{a.number} isn't a decision ticket: ask for the paid run with one "
                            "(templates/report.md, paid-run request), and run it once the owner approves there")
    if keyword_comments(issue["comments"], KW_PAID_RUN):
        raise ContractError(f"#{a.number}'s approval was already used: one paid run per approval. "
                            "Ask the owner again on a new decision ticket")
    if issue["state"] != "OPEN":
        raise ContractError(f"#{a.number} isn't open: a decision the orchestrator already closed is no approval. "
                            "Ask the owner again on a new decision ticket")
    # The approval must already be on this ticket: the owner's own comment, or the orchestrator's Decided
    # note written in the session where the owner gave it. No words on the command line: a later session
    # could only copy them from somewhere else (the 6.9 pilot copied another ticket's approval).
    approval = paid_run_approval(issue["comments"])
    if not approval:
        raise ContractError(f"#{a.number} has no owner approval on it: the owner's comment there, or, when they "
                            f"approved in your session, `ticket.py note {a.number} --keyword Decided --file <f>` "
                            "quoting their words (an `Owner: \"...\"` line) for this run. Never reuse an approval "
                            "from another ticket or an earlier session; with none, leave it under Waiting on you")
    dirty = [l[3:] for l in ctx.r.run(["git", "status", "--porcelain"], check=False).splitlines()
             if l.strip() and not l[3:].startswith(".work/")]
    if dirty:
        raise ContractError("the worktree has changes (" + ", ".join(dirty[:5]) + "): paid runs never share a "
                            "branch with code changes; run from a clean checkout")
    if ctx.r.dry_run:
        print(f"DRY-RUN: would run {' '.join(command)} with {switch}=1 and record it on #{a.number}")
        return 0
    # TICKET_CONTRACT_CALL=0: the product's own gh calls, if any, still go through the guard.
    code, out, err = ctx.r.run_result(command, env_extra={switch: "1", "TICKET_CONTRACT_CALL": "0"})
    log_dir = ctx.root / ".work" / "paid-runs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log = log_dir / f"{a.number}-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.log"
    log.write_text(f"$ {switch}=1 {' '.join(command)}\nexit {code}\n--- stdout\n{out}\n--- stderr\n{err}\n")
    tail = "\n".join((out + err).strip().splitlines()[-10:]) or "(no output)"
    approval = f"Approval: {approval}"
    ctx.comment("issue", a.number, KW_PAID_RUN,
                f"Ran: `{switch}=1 {' '.join(command)}`\nExit: {code}\nLog: {log.relative_to(ctx.root)}\n"
                f"{approval}\n\nLast lines:\n```\n{tail}\n```\n\nCost and result: report them from the log "
                "(steps/paid-run.md). This approval is now used.")
    print(f"paid run on #{a.number}: exit {code}; log {log}")
    return 0 if code == 0 else 1


def close_landed_on_main(ctx, refs: list[int], sha: str):
    """Make a merge into main close its Closes tickets even where GitHub's
    auto-close didn't. `merge` already posted Completed, so cmd_close only does
    the close itself here; skips tickets GitHub already closed."""
    for n in refs:
        issue = ctx.issue(n)
        if issue["state"] != "OPEN" or ticket_type(issue["body"]) not in CLOSE_ON_MAIN:
            continue
        if ctx.r.dry_run:
            print(f"DRY-RUN: would close #{n} as completed")
            continue
        cmd_close(ctx, argparse.Namespace(number=n, reason="completed", commit=sha,
                                          answer=None, findings=None, note=None, skip_note=True))
