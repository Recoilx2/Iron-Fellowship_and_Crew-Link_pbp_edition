from __future__ import annotations

import re

from .model import (
    ContractError, FAILURE_LADDER_DOC, HANDOFF_LABEL, KW_CLAIMED, KW_HANDOFF, KW_LADDER,
    KW_RELEASED, KW_RETRACTED, KW_TRIED, TRIED_LIMIT, UNCLAIMABLE, active_batch, active_claim,
    claim_race_loser, claimed_branch, closing_refs, field, handoff_fields, identity_of,
    is_wayfinder, keyword_comments, label_names, lint_handoff, parent_of, parse_signature, slug,
    ticket_type, worktree_path,
)
from .github import read_file, report
from .verify import failing_test_proof, passing_receipt, read_receipt, verify_hint


def batch_active(ctx, target: str, issues: list[dict]) -> int:
    """Tickets of `target` in progress under a live claim (the parallel cap's count)."""
    return len([i for i in issues if active_batch(i["comments"], ctx.orch) == target
                and ctx.status(i) == "in-progress" and active_claim(i["comments"])])


def cmd_claim(ctx, a):
    ctx.need_sig()
    issue = ctx.issue(a.number)
    names = label_names(issue["labels"])
    if issue["state"] != "OPEN":
        raise ContractError(f"#{a.number} is closed")
    ttype = ticket_type(issue["body"])
    if "spec" in names or ttype in UNCLAIMABLE:
        raise ContractError(f"A {'spec' if 'spec' in names else ttype} is never claimed")
    wayfinder = is_wayfinder(names)
    # A claim lasts while the ticket is in-progress; once the orchestrator moves
    # it back (an owner decision, a release), the old claim is over.
    holder = active_claim(issue["comments"]) if (wayfinder or ctx.status(issue) == "in-progress") else None
    if holder:
        raise ContractError(f"#{a.number} is already claimed by {parse_signature(holder['body'])}; back off")
    if not wayfinder and ctx.status(issue) != "ready-for-agent":
        raise ContractError(f"#{a.number} is '{ctx.status(issue) or 'no status'}', not ready-for-agent")
    blockers = ctx.open_blockers(issue)
    if blockers:
        raise ContractError(f"#{a.number} has {blockers} open blocker(s)")
    batch = active_batch(issue["comments"], ctx.orch)
    if batch:
        cap = int(ctx.project.get("max_parallel_implementers", 3))
        listed = ctx.mirror_or_gh(lambda m: m.issues("open", limit=300),
                                  ["gh", "issue", "list", "--state", "open", "--limit", "300",
                                   "--json", "number,body,labels,comments,state"])
        active = batch_active(ctx, batch, listed)
        if active >= cap:
            raise ContractError(f"Batch #{parent_of(issue['body'])} is at its parallel cap ({active}/{cap}). "
                                "Next: wait for a ticket to land (ticket.py next --role implementer --wait 4h)")
    branch = claimed_branch(issue["comments"]) or f"ticket/{a.number}-{slug(issue['title'])}"
    base = ctx.spec_branch(issue)
    lines = [f"Branch: {branch}", f"Base: {base}", f"Worktree: {worktree_path(ctx.root, branch)}"]
    if ctx.project.get("verify_command"):
        lines.append(f"Verify: {ctx.project['verify_command']}")
    handoffs = keyword_comments(issue["comments"], KW_HANDOFF)
    if handoffs:
        nxt = handoff_fields(handoffs[-1]["body"]).get("Next")
        lines.append(f"Resume from the last handoff. Next: {nxt}")
    note = "\n".join(lines)
    if wayfinder:
        ctx.comment("issue", a.number, KW_CLAIMED, note)  # wayfinder tickets never get a status label
    else:
        ctx.transition(issue, "in-progress", KW_CLAIMED, note)
    # Two claimants can pass the checks above together; the earlier claim comment wins.
    lost = claim_race_loser(ctx.issue(a.number)["comments"], ctx.identity())
    if lost:
        mine, first = lost
        winner = parse_signature(first["body"])
        ctx.comment("issue", a.number, KW_RETRACTED, f"Claim: {mine['createdAt']}\nClaimed first by {winner}.")
        raise ContractError(f"#{a.number} was claimed first by {winner}; run `ticket.py next` for another job")
    print(note)
    return 0


def cmd_handoff(ctx, a):
    text = read_file(a.file)
    problems = lint_handoff(text)
    if problems:
        report(problems, a.file)
        raise ContractError("Handoff incomplete; not posted")
    no_red = getattr(a, "no_red_proof", None)
    if no_red is not None and not no_red.strip():
        raise ContractError("--no-red-proof needs a reason: --no-red-proof '<why>'")
    status = handoff_fields(text)["Status"].lower()
    issue = ctx.issue(a.number)
    claim = active_claim(issue["comments"])
    if not claim:
        raise ContractError(f"#{a.number} has no active claim; claim it before handing off")
    if identity_of(parse_signature(claim["body"])) != ctx.identity():
        raise ContractError(f"#{a.number} is claimed by {parse_signature(claim['body'])}; only the claimant hands off")
    if is_wayfinder(issue["labels"]):
        ctx.comment("issue", a.number, KW_HANDOFF, text)
        return 0
    # A handoff moves the claimant's own in-progress ticket. After the claimant
    # asked the owner (`set needs-info`), only a stuck handoff may follow: it
    # records where things stand without leaving needs-info, which takes the owner.
    current = ctx.status(issue)
    if current == "needs-info" and status != "stuck":
        raise ContractError(f"#{a.number} is waiting on the owner (needs-info); hand off 'stuck', "
                            "or wait for the orchestrator to move it with the owner's answer")
    if current not in ("in-progress", "needs-info"):
        raise ContractError(f"#{a.number} is '{current or 'no status'}', not in-progress; nothing to hand off")
    if status == "done":
        # needs-review means there is something to review: an open PR that closes this ticket.
        m = re.search(r"PR #(\d+)", handoff_fields(text).get("Did", ""))
        try:
            pr = ctx.pr(int(m.group(1))) if m else None
        except ContractError:
            pr = None
        if not pr or pr["state"] != "OPEN" or a.number not in closing_refs(pr["body"]):
            raise ContractError(f"A done handoff names its open PR in **Did:** ('PR #<n>'), and that PR says "
                                f"'Closes #{a.number}'")
        verify = (ctx.project.get("verify_command") or "").strip()
        if not verify:
            raise ContractError("set verify_command in docs/agents/project.json; merge needs it to prove the head")
        if not passing_receipt(ctx.root, pr["headRefOid"]):
            short = pr["headRefOid"][:7]
            rec = read_receipt(ctx.root, pr["headRefOid"])
            if rec is None:
                why = f"no receipt for {short}"
            elif rec.get("dirty"):
                files = ", ".join(rec.get("dirty_files") or []) or "(none listed)"
                why = (f"worktree was dirty on {short} ({files}); commit them, delete them or add them to "
                       ".gitignore, then run `job.py verify` again")
            else:
                why = f"verify failed on {short}: {rec.get('last_line') or '(no output)'}"
            raise ContractError(f"#{a.number}: {why}.\n{verify_hint()}")
        if ticket_type(issue["body"]) == "bug" and not no_red:
            missing = failing_test_proof(ctx, a.number, pr, claim)
            if missing:
                base = field(claim["body"], "Base") or pr["baseRefName"]
                raise ContractError(f"#{a.number}: no failing-test proof on {pr['headRefName']} after {base}. "
                                    f"{missing}\n{verify_hint()}")
    # The handed-off commit must be on GitHub, where the next agent starts from.
    st = re.search(r"branch\s+(\S+)\s+@\s+([0-9a-f]{7,40})", handoff_fields(text).get("State", ""))
    if not st:
        raise ContractError("State must name `branch <name> @ <commit>`")
    branch, commit = st.groups()
    problems = []
    if not ctx.on_branch(commit, branch):
        problems.append(f"commit {commit} isn't on origin/{branch}; push it")
    elif status == "done" and not pr["headRefOid"].startswith(commit):
        problems.append(f"State commit {commit} isn't PR #{pr['number']}'s head ({pr['headRefOid'][:7]}); "
                        "the reviewer sees the head")
    wt = worktree_path(ctx.root, branch)
    if wt.exists() and ctx.r.run(["git", "-C", str(wt), "status", "--porcelain"], check=False).strip():
        problems.append(f"{wt} has uncommitted changes; commit and push them, or say so in Left")
    if problems and status == "stuck":
        print("Note: " + "; ".join(problems))
    elif problems:
        raise ContractError("; ".join(problems))
    if no_red:
        text += f"\nNo red proof: {no_red}\n"
    ctx.transition(issue, HANDOFF_LABEL[status], KW_HANDOFF, text)
    return 0


def cmd_tried(ctx, a):
    """A claimant's numbered fix attempt; the last ladder restarts the count."""
    ctx.need_sig()
    issue = ctx.issue(a.number)
    claim = active_claim(issue["comments"])
    if not claim:
        raise ContractError(f"#{a.number} has no active claim; claim it before posting a Tried")
    if identity_of(parse_signature(claim["body"])) != ctx.identity():
        raise ContractError(f"#{a.number} is claimed by {parse_signature(claim['body'])}; "
                            "only the claimant posts a Tried")
    body = read_file(a.file)
    if not body.strip():
        raise ContractError("A Tried needs --file with the hypothesis and result")
    me = ctx.identity()
    ladders = keyword_comments(issue["comments"], KW_LADDER)
    since = max([claim["createdAt"]] + [c["createdAt"] for c in ladders])
    used = [c for c in keyword_comments(issue["comments"], KW_TRIED)
            if c["createdAt"] > since and identity_of(parse_signature(c["body"])) == me]
    attempt = len(used) + 1
    stop = ("Three fixes have failed since the last ladder: climb the failure ladder "
            f"({FAILURE_LADDER_DOC}).")
    if attempt > TRIED_LIMIT:
        raise ContractError(stop)
    ctx.comment("issue", a.number, KW_TRIED, f"Attempt {attempt}.\n\n{body}")
    if attempt == TRIED_LIMIT:
        print(stop)
    return 0


def cmd_release(ctx, a):
    ctx.need_role("orchestrator", "release a claim")
    issue = ctx.issue(a.number)
    if not active_claim(issue["comments"]):
        raise ContractError(f"#{a.number} has no active claim")
    body = (a.reason or "Released by the orchestrator.") + \
        " Branch and work are kept; resume from the last handoff."
    if is_wayfinder(issue["labels"]):
        ctx.comment("issue", a.number, KW_RELEASED, body)
    else:
        ctx.transition(issue, "ready-for-agent", KW_RELEASED, body)
    return 0
