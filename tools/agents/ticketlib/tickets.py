from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import mirror

from .model import (
    parent_of,
    CLOSE_ON_MAIN, ContractError, KW_LADDER, NOTE_KEYWORDS, RESERVED, add_blocker_line,
    blocked_by_line, first_line, format_comment, is_wayfinder, keyword_comments, label_names,
    label_problems, lint_handoff, lint_pr, lint_ticket, status_of, ticket_type, worktree_path,
)
from .github import Runner, file_ticket, read_config, read_file, report
from .claims import cmd_claim


def current_branch() -> str | None:
    """The cwd's branch, or None on a detached HEAD or when git can't say."""
    try:
        code, out, _ = Runner(Path.cwd()).run_result(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    except OSError:
        return None
    branch = out.strip()
    return branch if code == 0 and branch and branch != "HEAD" else None


def project_main() -> str:
    """The project's main branch from the nearest docs/agents, or "main" outside a project."""
    try:
        from .cli import find_root
        return read_config(find_root(Path.cwd().resolve()), "project.json").get("main_branch", "main")
    except (ContractError, OSError):
        return "main"


def cmd_lint(ctx, a):
    text = read_file(a.file)
    if a.kind == "pr":
        problems = lint_pr(text, a.head if a.head is not None else current_branch(), base=a.base, main=project_main())
    elif a.kind == "ticket":
        problems = lint_ticket(text, ctx.project.get("ticket_limits") if ctx else None)
    else:
        problems = lint_handoff(text)
    report(problems, f"{a.kind} {a.file}")
    return 1 if problems else 0


def cmd_new(ctx, a):
    body = read_file(a.file)
    if a.label and not a.label.startswith("wayfinder:"):
        raise ContractError("--label is only for wayfinder:* labels; statuses come from check --promote")
    problems = [] if a.label else lint_ticket(body, ctx.project.get("ticket_limits"))
    if problems:
        report(problems, a.file)
        raise ContractError("Ticket body doesn't match its template; not filed")
    if a.parent is not None and not a.label and parent_of(body) != a.parent:
        raise ContractError(f"--parent {a.parent} but the body's `Part of:` says "
                            f"{('#%d' % parent_of(body)) if parent_of(body) else 'none'}; make them agree")
    parent = a.parent if a.parent is not None else parent_of(body)
    if parent is not None and not a.label and (ctx.issue(parent).get("state") or "").upper() == "CLOSED":
        small = ctx.project.get("small_fixes_spec")
        has_small = isinstance(small, int) and not isinstance(small, bool)
        raise ContractError(f"#{parent} is closed; a new ticket can't be Part of it. " + (
            f"#{parent} is the Small fixes spec, which should never be closed: reopen it or ask the owner."
            if has_small and small == parent else
            f"File it under the Small fixes spec: --parent {small} and `Part of: #{small}`." if has_small
            else "Reopen #%d or pick an open parent." % parent))
    url = file_ticket(ctx, a.title, body, a.parent, a.blocked_by, a.label, a.from_issue)
    if url and not a.label and ticket_type(body) != "spec":
        print(f"Next: `ticket.py check {url.rstrip('/').split('/')[-1]} --promote` to make it ready")
    return 0


def cmd_quick(ctx, a):
    """File a small fix and make it startable at once; the body is valid by construction."""
    ctx.need_sig()
    parent = a.parent if a.parent is not None else ctx.project.get("small_fixes_spec")
    if parent is not None and not isinstance(parent, int):
        raise ContractError("project.json small_fixes_spec must be an issue number or null")
    verify = a.verify.strip()
    if not verify or "`" in verify or "\n" in verify:
        raise ContractError("--verify must be one command, without backticks or newlines")
    extras = [x.strip() for x in (a.acceptance or []) + (a.out_of_scope or []) + (a.touches or [])]
    if any(not x or "\n" in x for x in extras):
        raise ContractError("--acceptance, --out-of-scope and --touches take one non-empty line each")
    criteria = "".join(f"- [ ] {x.strip()}\n" for x in a.acceptance or [])
    scope = "".join(f"- {x.strip()}\n" for x in a.out_of_scope or []) or \
        "Anything beyond What and why; file a new ticket.\n"
    touches = f"\n## Touches\n{', '.join(x.strip() for x in a.touches)}\n" if a.touches else ""
    body = (f"Type: fix\nPart of: {'#' + str(parent) if parent else 'none'}\nBlocked by: none\n\n"
            f"## What and why\n{a.what.strip()}\n\n## Verify\n`{verify}`\n\n"
            f"## Acceptance criteria\n- [ ] `{verify}` passes\n{criteria}\n"
            f"## Out of scope\n{scope}{touches}")
    problems = lint_ticket(body, ctx.project.get("ticket_limits"))
    if problems:
        report(problems, "quick ticket")
        raise ContractError("The quick ticket doesn't match its template; not filed")
    url = file_ticket(ctx, a.title, body, parent)
    if not url:
        return 0                                        # dry run
    num = int(url.rstrip("/").split("/")[-1])
    issue = ctx.issue(num)
    ctx.transition(issue, "ready-for-agent", "Ready", "Quick fix; its body matches the template by construction.")
    if ctx.role() == "implementer":
        a.number = num
        return cmd_claim(ctx, a)
    print(f"#{num} is ready; the implementer picks it up with `next --role implementer`.")
    return 0


def blocked_mismatch(ctx, issue: dict) -> list[str]:
    """Native blocked-by edges the body's `Blocked by:` line doesn't name, and
    open blockers the body names that have no edge. Empty if the API can't say.
    (An edge is removed when its blocker lands, so a landed blocker isn't a mismatch.)"""
    n = issue["number"]
    try:
        edges = {int(d["number"]) for d in
                 ctx.r.json(["gh", "api", f"repos/{ctx.repo()}/issues/{n}/dependencies/blocked_by"]) or []}
    except (ContractError, TypeError, KeyError, ValueError):
        return []
    body = set(blocked_by_line(issue["body"]))
    out = []
    if edges - body:
        out.append("GitHub says blocked by " + ", ".join(f"#{b}" for b in sorted(edges - body)) +
                   ", but the body's 'Blocked by:' line doesn't name it; `ticket.py block` updates both")
    stale = []
    for b in sorted(body - edges):
        other = ctx.issue(b)
        if other["state"] == "OPEN" and "landed-on-integration" not in label_names(other["labels"]):
            stale.append(b)
    if stale:
        out.append("the body's 'Blocked by:' names " + ", ".join(f"#{b}" for b in stale) +
                   ", but GitHub has no blocking edge for it; `ticket.py block` adds it")
    return out


def cmd_check(ctx, a):
    issue = ctx.issue(a.number)
    names = label_names(issue["labels"])
    # No status yet is normal for a new ticket: it waits for --promote.
    problems = label_problems(names, ctx.labels, issue["state"], require_status=False)
    exempt = "needs-triage" in names or is_wayfinder(names)
    if not exempt:
        problems = lint_ticket(issue["body"], ctx.project.get("ticket_limits")) + blocked_mismatch(ctx, issue) + problems
    report(problems, f"#{a.number}")
    if problems or not a.promote:
        return 1 if problems else 0
    ctx.need_role("orchestrator", "promote a ticket to ready-for-agent")
    if ticket_type(issue["body"]) == "spec":
        raise ContractError("A spec is never promoted; it carries 'spec' only")
    if ctx.status(issue):
        raise ContractError(f"#{a.number} already has status '{ctx.status(issue)}'")
    if ticket_type(issue["body"]) == "decision":
        # Agents never claim a decision; it waits on the owner.
        ctx.transition(issue, "needs-info", "Ready", "Matches its template; waiting on the owner's decision.")
    else:
        ctx.transition(issue, "ready-for-agent", "Ready", "Matches its template; startable once no open blockers.")
    return 0


def cmd_block(ctx, a):
    """Add a native blocking edge after both issues exist: <n> is blocked by --by."""
    ctx.need_sig()
    ctx.r.run(["gh", "issue", "edit", str(a.number), "--add-blocked-by", str(a.by)], write=True)
    # The Blocked by line is what the Touches clash check reads, so keep it in step.
    body = ctx.issue(a.number)["body"]
    new = add_blocker_line(body, a.by)
    if new != body:
        ctx.r.run(["gh", "issue", "edit", str(a.number), "--body-file", "-"], write=True, input=new)
    ctx.comment("issue", a.number, "Blocked", f"Blocked by #{a.by}.")
    return 0


def cmd_note(ctx, a):
    """A signed comment with a free-form keyword: reports, notes, ladder starts."""
    if a.keyword in RESERVED:
        raise ContractError(f"'{a.keyword}' is written only by its own ticket.py command")
    who = NOTE_KEYWORDS.get(a.keyword)
    if who is None:
        raise ContractError(f"Unknown note keyword '{a.keyword}'; use one of {sorted(NOTE_KEYWORDS)}")
    if who != "any":
        ctx.need_role(who, f"post a '{a.keyword}' note")
    body = read_file(a.file)
    if not body.strip():
        raise ContractError("A note needs --file with its text")
    if a.keyword == KW_LADDER:
        issue = ctx.issue(a.number)
        limit = int(ctx.project.get("ladders_per_ticket", 2))
        used = len(keyword_comments(issue["comments"], KW_LADDER))
        if used >= limit:
            raise ContractError(f"#{a.number} has used its {limit} failure ladders; hand off stuck")
        body = f"Ladder {used + 1} of {limit}.\n\n{body}"
    url = ctx.comment("issue", a.number, a.keyword, body)
    print(f"Posted {a.keyword} note on #{a.number}" + (f": {url}" if url else ""))
    return 0


def cmd_labels(ctx, a):
    want = {l["name"]: l for l in ctx.labels["status"] + ctx.labels["other"]}
    have = {l["name"]: l for l in ctx.r.json(["gh", "label", "list", "--limit", "200",
                                               "--json", "name,color,description"]) or []}
    diffs = []
    for name, l in want.items():
        h = have.get(name)
        if not h:
            diffs.append((name, "missing"))
        elif h["color"].lower() != l["color"].lower() or (h.get("description") or "") != l["description"]:
            diffs.append((name, "differs"))
    for name, why in diffs:
        print(f"{why:8} {name}")
        if a.apply:
            l = want[name]
            ctx.r.run(["gh", "label", "create", name, "--color", l["color"],
                       "--description", l["description"], "--force"], write=True)
    if not diffs:
        print("Labels match docs/agents/labels.json.")
    return 1 if diffs and not a.apply else 0


def cmd_worktree(ctx, a):
    """Print the worktree path for a branch; with --create, make the worktree,
    reusing the branch if it already exists locally or on origin."""
    path = worktree_path(ctx.root, a.branch)
    print(path)
    if not a.create:
        return 0
    if path.exists():
        raise ContractError(f"{path} already exists; work there")
    path.parent.mkdir(parents=True, exist_ok=True)
    ctx.r.run(["git", "fetch", "--quiet", "origin"], check=False)
    local = ctx.r.ok(["git", "rev-parse", "--verify", "--quiet", f"refs/heads/{a.branch}"])
    remote = ctx.r.ok(["git", "rev-parse", "--verify", "--quiet", f"refs/remotes/origin/{a.branch}"])
    if local:
        ctx.r.run(["git", "worktree", "add", str(path), a.branch], write=True)
    elif remote:
        ctx.r.run(["git", "worktree", "add", "--track", "-b", a.branch, str(path), f"origin/{a.branch}"], write=True)
    else:
        if not a.base:
            raise ContractError("New branch: pass --base (the Base line `claim` printed)")
        ctx.r.run(["git", "worktree", "add", "-b", a.branch, str(path), f"origin/{a.base}"], write=True)
    return 0


def cmd_lint_event(ctx, a):
    """For the GitHub Action: check the issue or PR that triggered the event."""
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    name = os.environ.get("GITHUB_EVENT_NAME", "")
    sig = "Contract check · GitHub Action"
    problems, num, kind = [], None, "issue"
    if name == "issues":
        issue, action = event["issue"], event.get("action")
        num, names = issue["number"], label_names(issue.get("labels"))
        if issue.get("pull_request"):
            return 0
        body = issue.get("body") or ""
        if action == "closed":
            ttype = ticket_type(body)
            if ttype in CLOSE_ON_MAIN and issue.get("state_reason") == "completed":
                # GitHub closes a 'Closes #n' ticket the moment its PR merges into main,
                # just before ticket.py posts 'Completed in <sha>'. Wait for it.
                waits = int(os.environ.get("TICKET_EVENT_RETRIES", "6"))
                pause = float(os.environ.get("TICKET_EVENT_RETRY_SECONDS", "20"))
                ok = False
                for attempt in range(waits + 1):
                    comments = ctx.r.json(["gh", "issue", "view", str(num), "--json", "comments"])["comments"]
                    done = [c for c in comments if first_line(c["body"]) in ("Completed", "Closed")]
                    m = re.search(r"Completed in ([0-9a-f]{7,40})", done[-1]["body"]) if done else None
                    if m and ctx.on_branch(m.group(1), ctx.main):
                        ok = True
                        break
                    if attempt < waits:
                        time.sleep(pause)
                if not ok:
                    problems.append(f"A {ttype} was closed as completed without its commit on {ctx.main}")
                    if a.act:
                        args = ["gh", "issue", "edit", str(num), "--add-label", "needs-info"]
                        for s in status_of(names, ctx.labels):
                            if s != "needs-info":
                                args += ["--remove-label", s]
                        ctx.r.run(["gh", "issue", "reopen", str(num)], write=True)
                        ctx.r.run(args, write=True)
        elif not ticket_type(body) and not names:
            # A raw issue (the owner's or an outsider's): mark it for triage, don't scold it.
            if a.act:
                ctx.r.run(["gh", "issue", "edit", str(num), "--add-label", "needs-triage"], write=True)
            report([], f"issue #{num} (raw; marked needs-triage)")
            return 0
        else:
            exempt = "needs-triage" in names or is_wayfinder(names)
            if not exempt:
                problems += lint_ticket(body)
            # New tickets wait for `check --promote` with no status; don't flag that.
            problems += label_problems(names, ctx.labels, "OPEN", require_status=False)
    elif name == "pull_request":
        p = event["pull_request"]
        kind, num = "pr", p["number"]
        problems += lint_pr(p.get("body") or "", (p.get("head") or {}).get("ref"),
                             base=(p.get("base") or {}).get("ref"), main=ctx.main)
    report(problems, f"{kind} #{num}")
    if problems and a.act and num:
        text = format_comment("Contract check failed", "\n".join(f"- {p}" for p in problems), sig)
        prev = ctx.r.json(["gh", kind, "view", str(num), "--json", "comments"])["comments"]
        if not prev or prev[-1]["body"].strip() != text.strip():
            ctx.r.run(["gh", kind, "comment", str(num), "--body-file", "-"], write=True, input=text)
    return 1 if problems else 0


def cmd_sync(ctx, a):
    """Refresh, rebuild or describe the disposable local tracker copy."""
    if a.status:
        mirror.print_status(ctx.root)
        return 0
    m = mirror.rebuild(ctx.r, ctx.repo(), root=ctx.root) if a.rebuild \
        else mirror.sync(ctx.r, ctx.repo(), root=ctx.root)
    s = m.stats()
    print(f"Tracker: {s['issues']} issues, {s['comments']} comments, {s['pulls']} PRs; "
          f"last sync {s['last_sync']}")
    return 0
