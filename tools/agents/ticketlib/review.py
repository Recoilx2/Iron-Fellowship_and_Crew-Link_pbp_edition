from __future__ import annotations

import re

from .model import (
    ContractError, KW_APPROVED, KW_CHANGES, KW_DECIDED, KW_REVIEWING, closing_refs, is_aggregate,
    keyword_comments, parse_signature, role_of,
)
from .approval import pr_author_role
from .github import read_file


def review_rounds(pr: dict, since: str = "") -> int:
    """Changes requested on the PR since the owner last decided."""
    return len([c for c in keyword_comments(pr["comments"], KW_CHANGES) if c["createdAt"] > since])


def last_decided(ctx, refs: list[int]) -> str:
    times = [c["createdAt"] for n in refs
             for c in keyword_comments(ctx.issue(n)["comments"], KW_DECIDED, by=ctx.orch)]
    return max(times, default="")


def reviewer_allowed(ctx, pr: dict) -> bool:
    """A different role reviews. The orchestrator may also review its own
    PR when it only aggregates already-handled tickets (spec/* or batch/*)."""
    me, author = ctx.role(), pr_author_role(pr)
    if author is None:
        raise ContractError(f"PR #{pr['number']} body has no signature line ('— <role>')")
    return author != me or (is_aggregate(pr["headRefName"]) and ctx.role() == "orchestrator")


def plain_line(line: str) -> str:
    """The line without a markdown list marker, emphasis or backticks."""
    return re.sub(r"[*`_]", "", re.sub(r"^\s*(?:[-*+>]|\d+[.)])\s+", "", line))


def revert_check_proved_nothing(line: str) -> bool:
    """Does a `Revert check:` line say the check proved nothing? Judged on the result, not the whole line, after
    markdown markers are stripped and either apostrophe is accepted: it starts FAILED, says verify failed on the
    head or can't run, or says it passes with the change reverted; else the text after its last arrow must not
    start with "still green" or "pass"."""
    text = plain_line(line).replace("’", "'").strip().lower()
    if not re.match(r"\W*revert check:", text):
        return False
    if re.match(r"\W*revert check:\s*failed", text) or any(
            say in text for say in ("verify fails on the head", "verify can't run", "passes with the change reverted")):
        return True
    if "→" in text or "->" in text:
        return bool(re.match(r"(still green|pass)", re.split(r"→|->", text)[-1].strip()))
    return False


def cmd_review(ctx, a):
    pr = ctx.pr(a.number)
    if pr["state"] != "OPEN":
        raise ContractError(f"PR #{a.number} isn't open")
    if not reviewer_allowed(ctx, pr):
        raise ContractError(f"PR #{a.number} was opened by {pr_author_role(pr)}; a different role reviews")
    me = ctx.role()
    reviewing = keyword_comments(pr["comments"], KW_REVIEWING)
    refs = closing_refs(pr["body"])
    since = last_decided(ctx, refs)
    if a.action == "start":
        others = [c for c in reviewing if role_of(parse_signature(c["body"])) != me]
        if others:
            raise ContractError(f"Already being reviewed by {parse_signature(others[-1]['body'])}; back off")
        ctx.comment("pr", a.number, KW_REVIEWING, f"Round {review_rounds(pr, since) + 1}.")
        print(f"Started review of PR #{a.number} (round {review_rounds(pr, since) + 1})")
        return 0
    if not [c for c in reviewing if role_of(parse_signature(c["body"])) == me]:
        raise ContractError("Post `review <pr> start` first")
    if a.action == "approved":
        given = a.head
        if not given or len(given) < 7:
            raise ContractError("`review <pr> approved` needs --head <sha>: the commit you read (7+ characters)")
        if not pr["headRefOid"].startswith(given):
            raise ContractError(f"PR #{a.number} head moved to {pr['headRefOid'][:7]} since {given}; "
                                "review the new commit")
        body = read_file(a.file)
        if not any(re.match(r"\W*Revert check:\s*\S", plain_line(l), re.I) for l in body.splitlines()):
            raise ContractError("The approval evidence needs a `Revert check:` line (bt-code-review, Proof): the "
                                "new or changed tests run against the base's source files and fail, with the command "
                                "and result; or `Revert check: n/a (<why: no tests, docs only>)`")
        if any(revert_check_proved_nothing(line) for line in body.splitlines()):
            raise ContractError("The `Revert check:` line says the check didn't prove the tests: FAILED, still green, or "
                                "verify failing on the head or unable to run. Fix that (the tests must fail with the change reverted) "
                                "and run `ticket.py revert-check` again before approving")
        if a.owner:
            ctx.need_role("orchestrator", "record the owner's words on a review")
            body = f"{body}\n\nOwner: \"{a.owner}\""
        ctx.comment("pr", a.number, KW_APPROVED, f"Head: {pr['headRefOid']}\n\n{body}")
        print(f"Approved PR #{a.number} at {pr['headRefOid'][:7]}")
        return 0
    body = read_file(a.file)
    if not body.strip():
        raise ContractError("Changes requested needs --file with the cited findings")
    rounds = review_rounds(pr, since) + 1
    limit = int(ctx.project.get("review_rounds", 2))
    dst = "needs-info" if rounds >= limit else "ready-for-agent"
    issues = [ctx.issue(n) for n in refs]
    for issue in issues:
        ctx.check_move(issue, dst)
    ctx.comment("pr", a.number, KW_CHANGES, f"Round {rounds}.\n\n{body}")
    for issue in issues:
        why = (f"→ needs-info: review hit {rounds} rounds on PR #{a.number}; owner decides." if dst == "needs-info"
               else f"→ ready-for-agent: changes requested on PR #{a.number} (round {rounds}).")
        ctx.transition(issue, dst, "Status", why)
    print(f"Requested changes on PR #{a.number} (round {rounds}); "
          + ", ".join(f"#{i['number']} → {dst}" for i in issues))
    return 0
