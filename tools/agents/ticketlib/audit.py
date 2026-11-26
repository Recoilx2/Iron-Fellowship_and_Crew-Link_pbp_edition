from __future__ import annotations

import datetime as dt
import re

from .model import (
    CLOSE_ON_MAIN, ContractError, KW_APPROVED, KW_BASE_MERGED, KW_BATCH, KW_CHANGES, NOTE_KEYWORDS,
    RESERVED, SETUP_PREFIX, active_claim, batch_target_before, closing_refs, field, first_line,
    is_aggregate, is_wayfinder, keyword_comments, label_names, lint_pr, lint_ticket, now,
    children_of, parent_of, parse_signature, role_of, status_of, ticket_type, to_time,
)
from .approval import approved_heads, pr_author_role
from .merge import own_change_ids


LABEL_COMMENT_WINDOW_MIN = 5  # a status change and its signed comment land together


def audit_issue(issue: dict, cfg: dict, at: dt.datetime,
                events: list[dict] | None = None, orchestrator: str | None = None) -> list[tuple[str, str]]:
    """Contract violations on one issue, as (check, detail) pairs."""
    out, n = [], issue["number"]
    names = label_names(issue.get("labels"))
    statuses = status_of(names, cfg)
    comments = issue.get("comments") or []
    body = issue.get("body", "")
    open_ = issue.get("state", "OPEN").upper() == "OPEN"
    exempt = "needs-triage" in names or is_wayfinder(names)
    if open_:
        if len(statuses) > 1:
            out.append(("two-statuses", f"#{n} has {statuses}"))
        if "spec" in names and statuses:
            out.append(("spec-with-status", f"#{n} is a spec with {statuses}"))
        if not exempt and "spec" not in names and not statuses:
            if lint_ticket(body):
                out.append(("no-status", f"#{n} has no status and doesn't pass its template"))
            else:
                out.append(("unpromoted", f"#{n} passes its template but has no status (not promoted yet)"))
        if not exempt and ticket_type(body) and lint_ticket(body):
            out.append(("template", f"#{n}: " + "; ".join(lint_ticket(body)[:2])))
        if "in-progress" in statuses and not active_claim(comments):
            out.append(("in-progress-unclaimed", f"#{n} is in-progress with no active signed claim"))
    for c in comments:
        if first_line(c.get("body", "")) in RESERVED | set(NOTE_KEYWORDS) and not parse_signature(c.get("body")):
            out.append(("unsigned", f"#{n}: '{first_line(c['body'])}' comment without a signature"))
    if orchestrator:
        for c in keyword_comments(comments, KW_BATCH):
            if role_of(parse_signature(c["body"])) != orchestrator:
                out.append(("batch-by-non-orchestrator", f"#{n}: a Batch comment not signed by {orchestrator}"))
    if not open_ and (issue.get("stateReason") or "").upper() == "COMPLETED" and ticket_type(body) in CLOSE_ON_MAIN:
        if not any(re.search(r"Completed in [0-9a-f]{7,40}", c.get("body", "")) for c in comments):
            out.append(("closed-without-commit", f"#{n} closed as completed with no 'Completed in <sha>'"))
    statusset = {x["name"] for x in cfg["status"]}
    signed_times = [to_time(c["createdAt"]) for c in comments if parse_signature(c.get("body"))]
    for e in events or []:
        if e.get("event") in ("labeled", "unlabeled") and (e.get("label") or {}).get("name") in statusset:
            when = to_time(e["created_at"])
            # ticket.py changes the label, then posts the signed comment.
            if not any(0 <= (t - when).total_seconds() <= LABEL_COMMENT_WINDOW_MIN * 60 for t in signed_times):
                out.append(("label-without-comment",
                            f"#{n}: '{e['label']['name']}' {e['event']} with no signed comment in the next "
                            f"{LABEL_COMMENT_WINDOW_MIN} min"))
    return out


FULL_SHA = re.compile(r"[0-9a-f]{40}")


def audit_base_merged(pr: dict, r) -> list[tuple[str, str]]:
    """Check every `Base merged` note on a PR is one `merge` wrote: signed, with From/Head/Base,
    Head a two-parent merge whose first parent is From, and the recorded patch-id equal to a
    recomputation, with the PR's own change the same before and after. Without it, anyone could
    post the note and stretch an approval to unreviewed commits. Git runs only for PRs with a note;
    commits that can't be fetched are reported as unverifiable. With r=None, only the checks that
    need no git run."""
    out, n = [], pr["number"]
    for c in pr.get("comments") or []:
        if first_line(c.get("body", "")) != KW_BASE_MERGED:
            continue
        body, label = c.get("body", ""), f"PR #{n}: '{KW_BASE_MERGED}' note of {c.get('createdAt', '?')}"

        def bad(reason, unverifiable=False):
            out.append(("base-merged-unverified",
                        f"{label} is unverifiable: {reason}" if unverifiable else f"{label} {reason}"))
        if not parse_signature(body):
            bad("is not signed")
            continue
        frm, head, base = field(body, "From"), field(body, "Head"), field(body, "Base")
        if not (frm and head and base):
            bad("lacks From, Head or Base")
            continue
        if r is None:
            continue
        if not (FULL_SHA.fullmatch(frm) and FULL_SHA.fullmatch(head)):
            bad("has a From or Head that isn't a full commit SHA")
            continue
        try:
            for sha in (head, frm):                 # Head first: fetching it brings From with it
                if not r.ok(["git", "cat-file", "-e", f"{sha}^{{commit}}"]):
                    r.ok(["git", "fetch", "--quiet", "origin", sha])
                    if not r.ok(["git", "cat-file", "-e", f"{sha}^{{commit}}"]):
                        raise ContractError(f"commit {sha[:12]} can't be fetched from origin")
            parents = r.run(["git", "rev-list", "--parents", "-n", "1", head]).split()[1:]
            if len(parents) != 2 or parents[0] != frm:
                bad(f"Head {head[:12]} isn't a merge commit whose first parent is From {frm[:12]}")
                continue
            before, after = own_change_ids(r, r.cwd, frm, head, parents[1])
        except (ContractError, OSError) as e:
            bad(str(e)[:200], unverifiable=True)
            continue
        recorded = field(body, "Patch-id")
        if before != after:
            bad(f"changes the PR's own diff (patch-id {before} before the merge, {after} after)")
        elif recorded != after:
            bad(f"records patch-id {recorded}, but recomputing gives {after}")
    return out


def audit_pr(pr: dict, issues_by_number: dict, main_branch: str = "main",
             orchestrator: str | None = None, runner=None) -> list[tuple[str, str]]:
    out, n = [], pr["number"]
    merged = bool(pr.get("mergedAt"))
    head = pr.get("headRefName")
    if (head or "").startswith(SETUP_PREFIX):       # no ticket; merge gates checked by `merge` itself
        return out
    if pr.get("state", "").upper() == "OPEN" or merged:
        problems = lint_pr(pr.get("body", ""), head, base=pr.get("baseRefName"), main=main_branch)
        if problems:
            out.append(("pr-body", f"PR #{n}: " + "; ".join(problems[:2])))
    for r in closing_refs(pr.get("body", "")):
        if "spec" in label_names((issues_by_number.get(r) or {}).get("labels")):
            out.append(("pr-closes-spec", f"PR #{n} says 'Closes' a spec (#{r})"))
    if merged:
        # Judge the merge by the rule that applied when it happened (cmd_merge).
        author = pr_author_role(pr)
        author_may = is_aggregate(head)
        approvals = [c for c in keyword_comments(pr.get("comments"), KW_APPROVED)
                     if c["createdAt"] <= pr["mergedAt"]]
        changes = [c for c in keyword_comments(pr.get("comments"), KW_CHANGES) if c["createdAt"] <= pr["mergedAt"]]
        good = bool(approvals) and not (changes and changes[-1]["createdAt"] > approvals[-1]["createdAt"]) \
            and (author_may or role_of(parse_signature(approvals[-1]["body"])) != author)
        batch = pr.get("baseRefName", "").startswith("batch/") and any(
            pr.get("baseRefName") in batch_target_before((issues_by_number.get(r) or {}).get("comments", []),
                                                         orchestrator, pr["mergedAt"])
            for r in closing_refs(pr.get("body", "")))
        if not good and not batch:
            out.append(("merged-without-approval", f"PR #{n} merged without a valid signed Approved "
                        "and not in an orchestrator's batch run"))
        if approvals and good and not batch:
            covered = set()
            for ap in approvals:
                covered |= approved_heads(ap, pr.get("comments"))
            final = pr.get("headRefOid") or "?"
            if final not in covered:
                out.append(("approval-stale", f"PR #{n} merged with final head {final[:7]}, "
                            "not among its approved heads"))
    return out + audit_base_merged(pr, runner)


def audit_closed_specs(issues: list[dict]) -> list[tuple[str, str]]:
    """A spec closed as completed with a ticket still open under it: it closes when done, not before."""
    out = []
    for spec in issues:
        if "spec" not in label_names(spec.get("labels")) or spec.get("state", "OPEN").upper() == "OPEN" \
                or (spec.get("stateReason") or "").upper() != "COMPLETED":
            continue
        open_ = [i["number"] for i in issues if i.get("state", "OPEN").upper() == "OPEN"
                 and "spec" not in label_names(i.get("labels")) and (parent_of(i.get("body", "")) == spec["number"] or i["number"] in children_of(spec))]
        if open_:
            out.append(("spec-closed-with-open-tickets",
                        f"spec #{spec['number']} is closed but #{', #'.join(map(str, open_))} still open under it"))
    return out


def summarise(violations: list[tuple[str, str]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for check, _ in violations:
        counts[check] = counts.get(check, 0) + 1
    return counts


def cmd_audit(ctx, a):
    issues = ctx.mirror_or_gh(lambda m: m.issues("all", limit=a.limit),
                              ["gh", "issue", "list", "--state", "all", "--limit", str(a.limit), "--json",
                               "number,title,body,labels,comments,state,stateReason,createdAt"])
    prs = ctx.mirror_or_gh(lambda m: m.prs("all", limit=a.limit),
                           ["gh", "pr", "list", "--state", "all", "--limit", str(a.limit), "--json",
                            "number,body,comments,state,baseRefName,headRefName,headRefOid,mergedAt"])
    by_number = {i["number"]: i for i in issues}
    at = now()
    found = []
    for i in issues:
        events = None
        if a.timeline:
            events = ctx.r.json(["gh", "api", f"repos/{ctx.repo()}/issues/{i['number']}/timeline",
                                 "--paginate"]) or []
        found += audit_issue(i, ctx.labels, at, events, ctx.orch)
    for p in prs:
        found += audit_pr(p, by_number, ctx.main, ctx.orch, ctx.r)
    found += audit_closed_specs(issues)
    counts = summarise(found)
    print(f"Audit of {len(issues)} issues and {len(prs)} PRs: {len(found)} violation(s)")
    for check, count in sorted(counts.items()):
        print(f"  {count:4}  {check}")
    for check, detail in found:
        print(f"    - [{check}] {detail}")
    if not a.timeline:
        print("  (label-without-comment not checked; add --timeline)")
    print("  (stale claims: see `ticket.py stale`, which also reads branch commits)")
    return 1 if found else 0
