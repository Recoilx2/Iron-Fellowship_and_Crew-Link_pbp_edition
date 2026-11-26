from __future__ import annotations

import re

from .model import (
    ContractError, KW_APPROVED, KW_BASE_MERGED, KW_CHANGES, KW_HANDOFF, closing_refs, field, first_line,
    handoff_fields, keyword_comments, parse_signature, review_file_groups, role_of,
)


def pr_author_role(pr: dict) -> str | None:
    return role_of(parse_signature(pr.get("body", "")))


def approved_heads(approval: dict, comments: list[dict] | None) -> set[str | None]:
    """The commits an approval covers: the head it names, plus each head `merge` made
    afterwards by merging the base into an approved head (a `Base merged` note whose
    From is already covered). Only ticket.py writes that note."""
    heads = {field(approval["body"], "Head")}
    for c in keyword_comments(comments, KW_BASE_MERGED):
        if c["createdAt"] >= approval["createdAt"] and field(c["body"], "From") in heads:
            heads.add(field(c["body"], "Head"))
    return heads


def valid_approval(pr: dict, author_may_approve: bool) -> dict | None:
    """The approval a merge relies on: the latest Approved, after any later
    Changes requested, for the PR's current head commit, and (unless the
    author may approve) from a role other than the PR's author's."""
    approvals = keyword_comments(pr.get("comments"), KW_APPROVED)
    changes = keyword_comments(pr.get("comments"), KW_CHANGES)
    if not approvals:
        return None
    last = approvals[-1]
    if changes and changes[-1]["createdAt"] > last["createdAt"]:
        return None
    if pr.get("headRefOid") not in approved_heads(last, pr.get("comments")):
        return None
    if not author_may_approve and role_of(parse_signature(last["body"])) == pr_author_role(pr):
        return None
    return last


def covered_heads(pr: dict) -> set[str | None]:
    """The PR's current head, plus every earlier head it came from by `Base merged` notes
    (ticket.py attests the approved diff is unchanged across each)."""
    heads = {pr.get("headRefOid")}
    notes = keyword_comments(pr.get("comments"), KW_BASE_MERGED)
    grew = True
    while grew:
        grew = False
        for c in notes:
            if field(c["body"], "Head") in heads and field(c["body"], "From") not in heads:
                heads.add(field(c["body"], "From"))
                grew = True
    return heads


def head_anchor(pr: dict, handoffs: list[dict] | None = None) -> str | None:
    """When ticket.py first wrote down the PR's current head: the earliest server-stamped note that
    names it. That is a reviewer's `Approved` (Head: line) on the PR, or the implementer's `Status: done`
    `Handoff` (State: branch X @ <commit>) on the ticket the PR closes; a batch PR gets no review,
    so the handoff is its anchor. None when nothing names the head."""
    heads = {h for h in covered_heads(pr) if h}
    times = [c["createdAt"] for c in keyword_comments(pr.get("comments"), KW_APPROVED)
             if field(c["body"], "Head") in heads]
    for c in keyword_comments(handoffs, KW_HANDOFF):
        fields = handoff_fields(c["body"])
        if fields.get("Status", "").lower() != "done":
            continue                                    # a stuck handoff may name a commit never pushed
        m = re.search(r"branch\s+\S+\s+@\s+([0-9a-f]{7,40})", fields.get("State", ""))
        if m and any(h.startswith(m.group(1)) for h in heads):
            times.append(c["createdAt"])
    return min(times) if times else None


def owner_approval(pr: dict, handoffs: list[dict] | None = None) -> dict | None:
    """An owner approval of the PR's current head: an unsigned 'Approved' line posted after the
    earliest ticket.py note that names that head (see head_anchor), or an orchestrator's Approved
    note quoting --owner. `handoffs` are the comments of the tickets the PR closes.

    The anchor is a ticket.py note, not the head commit's date: GitHub stamps the note, while a
    committer picks the commit date (and can backdate it). A push leaves no note naming the new
    head, so an older owner comment can't carry over to it. The earliest note counts, so a second
    review of the same head doesn't cancel an owner approval already given."""
    comments = pr.get("comments") or []
    changes = keyword_comments(comments, KW_CHANGES)
    anchor = head_anchor(pr, handoffs)
    for c in comments:
        if parse_signature(c.get("body")):
            continue
        if first_line(c.get("body", "")).lower() not in ("approved", "approved."):
            continue
        if not anchor or c["createdAt"] <= anchor \
                or (changes and changes[-1]["createdAt"] > c["createdAt"]):
            continue
        return c
    note = valid_approval(pr, author_may_approve=False)
    if not note or role_of(parse_signature(note["body"])) != "orchestrator":
        return None
    return note if re.search(r"^Owner:\s*\S", note["body"], re.M | re.I) else None


def pr_files(ctx, pr: dict) -> list[str]:
    """Every changed path: `gh pr diff --name-only` has no 100-file cap, unlike
    `pr view`'s files field, which can hide an owner-review file."""
    out = ctx.r.run(["gh", "pr", "diff", str(pr["number"]), "--name-only"])
    return [line.strip() for line in out.splitlines() if line.strip()]


def owner_gate(ctx, pr: dict) -> tuple[list[str], list[str], bool]:
    """Owner-review files and whether the head is approved for them. Used by
    merge and by `next`, so a PR the merge would refuse is never offered."""
    matched, manifests = review_file_groups(ctx, pr_files(ctx, pr))
    if not (matched or manifests):
        return matched, manifests, True
    handoffs = []
    for n in closing_refs(pr.get("body") or ""):
        try:
            handoffs += ctx.issue(n)["comments"]
        except ContractError:
            pass                                        # no ticket to read: that anchor is simply missing
    return matched, manifests, bool(owner_approval(pr, handoffs))


def owner_gate_refusal(n: int, matched: list[str], manifests: list[str]) -> str:
    """Where the owner, not an agent, must supply an approval."""
    names = ", ".join(sorted(set(matched + manifests)))
    return (f"PR #{n} changes owner-review files ({names}): ask the owner to approve it on GitHub "
            "(a comment `Approved` on the PR page: after the reviewer's Approved for its current head, or, in a "
            "batch, where there is no review, after the implementer's done handoff naming that head), "
            "or record their words with "
            "`ticket.py review <pr> approved --head <sha> --owner '<their words>'` as the orchestrator.")
