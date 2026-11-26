from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
import time

import mirror

from .model import (
    ContractError, KW_BATCH_END, KW_CLAIMED, KW_DECIDED, KW_HANDOFF, KW_LANDED, OWNER_STATES,
    active_batch, active_claim, blocked_by_line, door_field, first_line, handoff_fields,
    hours_since, identity_of, keyword_comments, label_names, now, parent_of, parse_duration,
    parse_signature, status_of, strip_comments, ticket_type, to_time,
)
from .approval import owner_gate
from .claims import batch_active, cmd_release
from .nextjob import comments_truncated, idle_note, latest_update, next_job


def cmd_next(ctx, a):
    """Print the job that is this role's turn; print nothing if none. Read-only.
    With --wait, poll until one appears or the time is up. A poll is one cheap
    call; the full check runs again only when something in the repo changed."""
    deadline = now() + dt.timedelta(seconds=parse_duration(a.wait, "--wait")) if a.wait else None
    seen, checked, info = None, False, {}
    while True:
        stamp = latest_update(ctx) if deadline else None
        if not checked or stamp is None or (stamp != mirror.UNCHANGED and stamp != seen):
            info = {}
            job = next_job(ctx, a.role, info)
            seen, checked = stamp, True
            if job:
                print(job)
                return 0
        note = idle_note(info) if a.role == "orchestrator" else ""
        if deadline is None:
            print(f"Nothing for the {a.role} right now.{note}", file=sys.stderr)
            return 0
        if now() >= deadline:
            print(f"Nothing for the {a.role} after {a.wait}.{note}", file=sys.stderr)
            return 0
        if a.role == "orchestrator" and not info["flight"]:
            print(f"Nothing for the orchestrator.{note}", file=sys.stderr)
            return 0
        time.sleep(max(1.0, a.every))


def cmd_status(ctx, a):
    issues = ctx.mirror_or_gh(lambda m: m.issues("open", limit=300),
                              ["gh", "issue", "list", "--state", "open", "--limit", "300",
                               "--json", "number,title,body,labels,comments,updatedAt"])
    holding = {i["number"] for i in issues if "landed-on-integration" not in label_names(i["labels"])}
    groups: dict[str, list] = {}
    for i in issues:
        names = label_names(i["labels"])
        key = "spec" if "spec" in names else (status_of(names, ctx.labels) or ["needs-triage" if "needs-triage" in names else "no status"])[0]
        groups.setdefault(key, []).append(i)
    order = ["needs-info", "ready-for-human", "in-progress", "needs-review",
             "ready-for-agent", "landed-on-integration", "needs-triage", "no status", "spec"]
    for key in order + [k for k in groups if k not in order]:
        if key not in groups:
            continue
        print(f"{key} ({len(groups[key])})")
        for i in sorted(groups[key], key=lambda i: i["updatedAt"]):
            extra = ""
            if key == "in-progress":
                c = active_claim(i["comments"])
                extra = f" · claimed by {parse_signature(c['body'])}" if c else " · no signed claim"
            if key in ("needs-info", "ready-for-human"):
                extra = f" · last update {hours_since(i['updatedAt']):.0f} h ago"
            waiting = [b for b in blocked_by_line(i.get("body", "")) if b in holding]
            if waiting:
                extra += " (blocked by " + ", ".join(f"#{b}" for b in waiting) + ")"
            print(f"  #{i['number']} {i['title']}{extra}")
    return 0


def full_listed_issues(ctx, rows: list[dict], copy: bool) -> list[dict]:
    """On the gh-list fallback, re-read only rows whose comments may be cut off.
    The copy holds every comment, so it never needs this safety net."""
    if copy:
        return rows
    out = []
    for row in rows:
        if comments_truncated(row):
            try:
                row = ctx.issue(row["number"])
            except (ContractError, KeyError):    # a stale list row must not break a report
                pass
        out.append(row)
    return out


def report_last(ctx, spec: int | None) -> str:
    """Time of the orchestrator's last Report note, on the spec or anywhere."""
    copy = ctx.using_copy()
    rows = ctx.mirror_or_gh(lambda m: m.issues("all", limit=300),
                            ["gh", "issue", "list", "--state", "all", "--limit", "300",
                             "--json", "number,comments"])
    rows = full_listed_issues(ctx, rows, copy)
    times = []
    for row in rows:
        n = row.get("number")
        if not isinstance(n, int) or spec and n != spec:
            continue
        times += [c["createdAt"] for c in keyword_comments(row.get("comments"), "Report", by=ctx.orch)]
    return max(times, default="")


def verify_receipt_line(body: str) -> str:
    """The verify line a Landed or Completed note carries, if any."""
    m = re.search(r"(Verify: pass[^\n]*|verify passed with[^\n]*)", body or "")
    return m.group(1).strip() if m else ""


def report_merged(ctx, since: str, spec: int | None, repo: str):
    """Merged PRs since the last Report, with each verify receipt from its ticket."""
    print("## Merged since the last Report")
    copy = ctx.using_copy()
    prs = ctx.mirror_or_gh(lambda m: m.prs("merged", limit=300),
                           ["gh", "pr", "list", "--state", "merged", "--limit", "300", "--json",
                            "number,title,body,comments,headRefName,mergedAt"])
    issues = full_listed_issues(ctx, ctx.mirror_or_gh(
        lambda m: m.issues("all", limit=300),
        ["gh", "issue", "list", "--state", "all", "--limit", "300", "--json", "number,comments"]), copy)
    receipts = {}
    for i in issues:
        for kw in (KW_LANDED, "Completed"):
            for c in keyword_comments(i["comments"], kw):
                m = re.search(r"PR #(\d+) merged", c["body"])
                line = verify_receipt_line(c["body"])
                if m and line:
                    receipts[int(m.group(1))] = line
    for p in sorted(prs, key=lambda p: p.get("mergedAt") or ""):
        if (p.get("mergedAt") or "") <= since or spec and not re.search(
                rf"^\s*Part of\s+#{spec}\b", strip_comments(p.get("body") or ""), re.M | re.I):
            continue
        print(f"- PR #{p['number']} {p['title']} — {repo}/pull/{p['number']}")
        line = verify_receipt_line(" ".join(c["body"] for c in p.get("comments") or [])) \
            or receipts.get(p["number"], "")
        if line:
            print(f"  {line}")


def report_open(ctx, spec: int | None) -> list[dict]:
    """Open work grouped by status; the same list feeds 'waiting on you'."""
    copy = ctx.using_copy()
    issues = ctx.mirror_or_gh(lambda m: m.issues("open", limit=300),
                              ["gh", "issue", "list", "--state", "open", "--limit", "300", "--json",
                               "number,title,body,labels,comments,state,createdAt"])
    issues = full_listed_issues(ctx, issues, copy)
    if spec:
        issues = [i for i in issues if i["number"] == spec or parent_of(i["body"]) == spec]
    print("\n## Open work")
    groups: dict[str, list[str]] = {}
    for i in issues:
        names = label_names(i["labels"])
        key = "spec" if "spec" in names else (status_of(names, ctx.labels) or ["no status"])[0]
        groups.setdefault(key, []).append(f"#{i['number']}")
    for key in sorted(groups):
        print(f"{key} ({len(groups[key])}): {', '.join(groups[key])}")
    return issues


def report_waiting(ctx, issues: list[dict]):
    """One-way decisions, owner-review PRs and stuck tickets: only the owner moves them."""
    print("\n## Waiting on you")
    waiting = []
    for i in issues:
        statuses = status_of(i["labels"], ctx.labels)
        if ticket_type(i["body"]) == "decision" and door_field(i["body"]) == "one-way":
            waiting.append(f"#{i['number']} one-way decision: {i['title']}")
        elif any(s in OWNER_STATES for s in statuses):
            waiting.append(f"#{i['number']} stuck ({statuses[0]}): {i['title']}")
        for c in keyword_comments(i.get("comments"), KW_HANDOFF):
            m = re.search(r"^No red proof:\s*(.+)$", c["body"], re.M | re.I)
            if m:
                waiting.append(f"#{i['number']} handed off without red proof: {m.group(1).strip()}")
    prs = ctx.mirror_or_gh(lambda m: m.prs("open", limit=300),
                           ["gh", "pr", "list", "--state", "open", "--limit", "300", "--json",
                            "number,title,body,comments,headRefName,headRefOid,baseRefName,state"])
    for p in prs:
        try:
            matched, manifests, approved = owner_gate(ctx, p)
        except ContractError:                   # an unreadable gate is reported, not silently passed
            matched, manifests, approved = [], [], False
        if (matched or manifests) and not approved:
            waiting.append(f"PR #{p['number']} waits on approval: {', '.join(matched + manifests)}")
    print("\n".join(f"- {w}" for w in waiting) or "- none")


def report_decided(ctx, since: str, spec: int | None, repo: str):
    """Two-way decisions the orchestrator made since the last Report."""
    print("\n## Decided without you")
    copy = ctx.using_copy()
    listed = full_listed_issues(ctx, ctx.mirror_or_gh(
        lambda m: m.issues("all", limit=300),
        ["gh", "issue", "list", "--state", "all", "--limit", "300", "--json",
         "number,body,comments"]), copy)
    rows = []
    for i in listed:
        if spec and parent_of(i["body"]) != spec or door_field(i["body"]) != "two-way":
            continue
        for c in keyword_comments(i["comments"], KW_DECIDED, by=ctx.orch):
            if c["createdAt"] <= since:
                continue
            choice = next((l.strip() for l in c["body"].splitlines()
                           if re.match(r"^\s*Choice:\s*\S", l, re.I)), first_line(c["body"]))
            rows.append((c["createdAt"], f"- {choice} — {repo}/issues/{i['number']}"))
    for _, line in sorted(rows):
        print(line)
    if not rows:
        print("- none")


def cmd_report(ctx, a):
    """The factual part of a report from GitHub; the agent adds only the narrative."""
    ctx.need_role("orchestrator", "report")
    spec, since, repo = a.spec, report_last(ctx, a.spec), ctx.repo()
    report_merged(ctx, since, spec, repo)
    report_waiting(ctx, report_open(ctx, spec))
    report_decided(ctx, since, spec, repo)
    return 0


RELAY_NOTES = ("Relay session ended without progress", "Relay halted")   # relay.py's signed Notes


def is_relay_note(c: dict) -> bool:
    """A signed Note whose text starts with one of RELAY_NOTES: the relay ended its work here."""
    if first_line(c.get("body", "")) != "Note" or not parse_signature(c.get("body")):
        return False
    lines = [l.strip() for l in c["body"].splitlines() if l.strip()]
    return len(lines) > 1 and lines[1].startswith(RELAY_NOTES)


def stale_reason(issue: dict, claim: dict, others: list[dict], last_commit: dt.datetime | None,
                 orchestrator: str | None) -> str | None:
    """Why `claim` on an in-progress ticket is stale, or None. Activity, never elapsed time:
    (a) its batch ended and the ticket is still in progress with no handoff;
    (b) the relay that held it halted, or its session ended without progress (a signed relay
        Note after the claim), and nothing by the claimant or on the branch since;
    (c) the claimant moved on (a done or stuck handoff, or a claim, on another ticket) and has
        made no signed comment or commit here since. Not applied inside an active batch."""
    comments, at = issue["comments"], claim["createdAt"]
    who = identity_of(parse_signature(claim["body"]))
    batch_active = bool(active_batch(comments, orchestrator))
    if not batch_active and any(e["createdAt"] > at for e in keyword_comments(comments, KW_BATCH_END, by=orchestrator)):
        return "(a) its batch ended and it is still in progress with no handoff"
    mine = [c["createdAt"] for c in comments if parse_signature(c.get("body"))
            and identity_of(parse_signature(c["body"])) == who and c["createdAt"] > at]
    halts = [c for c in comments if is_relay_note(c) and c["createdAt"] > at]
    if halts:
        halted = to_time(halts[-1]["createdAt"])
        if not any(to_time(t) > halted for t in mine) and not (last_commit and last_commit > halted):
            return "(b) the relay that held it halted or ended its session without progress"
    if batch_active:
        return None
    moved = []
    for j in others:
        if j["number"] == issue["number"]:
            continue
        for c in keyword_comments(j["comments"], KW_CLAIMED) + keyword_comments(j["comments"], KW_HANDOFF):
            if identity_of(parse_signature(c["body"])) != who or c["createdAt"] <= at:
                continue
            if first_line(c["body"]) == KW_HANDOFF and (handoff_fields(c["body"]).get("Status") or "").lower() not in ("done", "stuck"):
                continue
            moved.append(to_time(c["createdAt"]))
    if moved:
        since = min(moved)
        if not any(to_time(t) > since for t in mine) and not (last_commit and last_commit > since):
            return "(c) the claimant moved on to other work and has been silent here since"
    return None


def cmd_stale(ctx, a):
    # No label filter: rule (c) reads claims and handoffs on other tickets too.
    listed = ctx.mirror_or_gh(lambda m: m.issues("open", limit=300),
                              ["gh", "issue", "list", "--state", "open", "--limit", "300",
                               "--json", "number,title,labels,comments,state"])
    # A done handoff may sit on a ticket that has since closed; rule (c) still
    # needs to see it, so read the most recently updated closed tickets as well.
    closed = ctx.mirror_or_gh(lambda m: m.issues("closed", order="updated", limit=100),
                              ["gh", "issue", "list", "--state", "closed", "--limit", "100",
                               "--json", "number,comments", "--search", "sort:updated-desc"])
    issues = listed
    others = issues + closed
    heads = [l.split("\t")[-1].removeprefix("refs/heads/") for l in
             ctx.r.run(["git", "ls-remote", "--heads", "origin"], check=False).splitlines() if "\t" in l]
    stale = []
    for i in issues:
        if i.get("state", "OPEN") != "OPEN" or "in-progress" not in label_names(i["labels"]):
            continue
        claim = active_claim(i["comments"])
        if not claim:
            print(f"#{i['number']} {i['title']} · in-progress with no active claim (skipped; audit flags it)")
            continue
        times = []
        for branch in [h for h in heads if h.startswith(f"ticket/{i['number']}-")]:
            ctx.r.run(["git", "fetch", "--quiet", "origin", branch], check=False)
            ct = ctx.r.run(["git", "log", "-1", "--format=%cI", "FETCH_HEAD"], check=False).strip()
            if ct:
                times.append(to_time(ct))
        why = stale_reason(i, claim, others, max(times, default=None), ctx.orch)
        if why:
            stale.append((i, why))
    for i, why in stale:
        print(f"#{i['number']} {i['title']} · stale {why}")
        if a.release:
            try:
                cmd_release(ctx, argparse.Namespace(number=i["number"], reason=f"Stale claim: {why}."))
            except ContractError as e:
                print(f"  not released: {e}")
    if not stale:
        print("No stale claims.")
    return 0
