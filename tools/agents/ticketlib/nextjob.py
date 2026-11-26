from __future__ import annotations

import re
import sqlite3
import sys

import mirror

from .model import (
    COMMENT_URL, ContractError, IDENTITY, KW_APPROVED, KW_BATCH, KW_BATCH_END, KW_CHANGES,
    KW_HANDOFF, KW_HOUSEKEEPING, KW_RETRO, KW_SHIPPED, KW_SURVEY, LIST_COMMENTS_CAP, OWNER_STATES,
    UNCLAIMABLE, active_batch, active_claim, closing_refs, door_field, field, first_line,
    handoff_fields, identity_of, is_aggregate, is_wayfinder, keyword_comments, label_names,
    lint_ticket, live_claims, parent_of, parse_signature, role_of, status_of, strip_comments,
    ticket_type,
)
from .approval import owner_gate, valid_approval


def owner_answered(comments: list[dict]) -> bool:
    """An unsigned comment after the last signed one. Agents always sign
    (ticket.py does it), so on one shared account that's the owner."""
    last = max((c["createdAt"] for c in comments or [] if parse_signature(c.get("body"))), default="")
    return any(not parse_signature(c.get("body")) and c["createdAt"] > last for c in comments or [])


def answer_on_ticket(answer: str, comments: list[dict]) -> bool:
    """Is `answer` the URL of one of this ticket's own comments? Matched by the
    comment id GitHub puts after `#issuecomment-`, so a link to another
    ticket's comment (even with this ticket's number in the path) fails."""
    m = re.search(r"#issuecomment-(\d+)\s*$", answer or "")
    if not m:
        return False
    return any(re.search(rf"#issuecomment-{m.group(1)}$", c.get("url") or "") for c in comments or [])


def owner_answer_ok(answer: str, comments: list[dict], words: str | None = None) -> bool:
    """A one-way decision's --answer is a comment URL for the owner's word: the
    comment is unsigned, or the orchestrator quotes the owner with --owner."""
    if not COMMENT_URL.search(answer or ""):
        return False
    return bool(words and words.strip()) or owner_answered(comments)


def comments_truncated(issue: dict) -> bool:
    """Might a listed issue's comments be cut off? Only then is a `view` worth it."""
    return len(issue.get("comments") or []) >= LIST_COMMENTS_CAP


def full_comment_issues(ctx, issues: list[dict], by_n: dict | None = None) -> list[dict]:
    """Re-read only the listed issues whose comments decide a job. A gh list's
    `--json comments` holds the last 100, which can hide a claim or a Batch;
    the copy holds every comment, so this is for the fallback path only."""
    out = []
    for i in issues:
        statuses = status_of(i.get("labels"), ctx.labels)
        relevant = "spec" in label_names(i["labels"]) or any(
            s in OWNER_STATES or s in ("in-progress", "needs-review", "landed-on-integration")
            for s in statuses)
        if relevant and comments_truncated(i):
            try:
                i = ctx.issue(i["number"])
            except (ContractError, KeyError):        # a stale list row must not break `next`
                pass
            else:
                if by_n is not None:
                    by_n[i["number"]] = i
        out.append(i)
    return out


def next_job(ctx, role: str, info: dict | None = None, relay: bool = False) -> str | None:
    """The one job that is `role`'s turn, as an instruction any agent can follow.
    `info`, if given, is filled in for the orchestrator with what is still in
    flight and what waits on the owner (see `idle_note`). `relay` is set only by
    relay.py: its session runs a whole batch itself, so a batch's tickets are
    never offered to it as separate jobs. Interactive implementers keep being
    offered each ready batch ticket, and the batch job only while nobody holds
    a claim in it."""
    issues = sorted(ctx.mirror_or_gh(lambda m: m.issues("open", limit=300),
                                     ["gh", "issue", "list", "--state", "open", "--limit", "300", "--json",
                                      "number,title,body,labels,comments,state,createdAt"]),
                    key=lambda i: i["number"])
    by_n = {i["number"]: i for i in issues}
    if not ctx.using_copy():
        issues = full_comment_issues(ctx, issues, by_n)

    def st(i):
        s = status_of(i.get("labels"), ctx.labels)
        return s[0] if len(s) == 1 else ""

    if role == "owner":
        waiting = [f"#{i['number']} waits on you ({st(i)}): {i['title']}" for i in issues if st(i) in OWNER_STATES]
        return "\n".join(waiting) or None
    prs = sorted(ctx.mirror_or_gh(lambda m: m.prs("open", limit=300),
                                  ["gh", "pr", "list", "--state", "open", "--limit", "300", "--json",
                                   "number,title,body,comments,headRefName,headRefOid,baseRefName,state"]),
                 key=lambda p: p["number"])

    def ready_for_review(p):
        refs = closing_refs(p["body"])
        return bool(refs) and all(st(by_n.get(r, {})) == "needs-review" for r in refs)

    def handed_off_done(issue):
        notes = keyword_comments(issue.get("comments"), KW_HANDOFF)
        return bool(notes) and handoff_fields(notes[-1]["body"]).get("Status", "").lower() == "done"

    if role == "implementer":
        me = ctx.identity() if role_of(ctx.sig) == "implementer" and IDENTITY.match(identity_of(ctx.sig)) else "implementer"
        runs = batch_runs(ctx, issues, by_n)
        in_batch = {i["number"] for r in runs for i in r["members"]} if relay else set()
        batch_job = None                                # one session runs the whole batch
        for r in runs:
            held = [i for i in r["members"] if st(i) == "in-progress" and active_claim(i["comments"])]
            if r["open"] and (relay or not held):       # interactive: only while nobody is running it
                batch_job = (f"Run the batch on spec #{r['spec']} (target {r['target']}): "
                             f"bt-work → bt-implement-spec (steps/batch.md).")
                break
        if batch_job and relay:                         # a relay session does it all, so this comes first
            return batch_job
        for i in issues:
            if i["number"] in in_batch:
                continue
            c = active_claim(i["comments"]) if st(i) == "in-progress" else None
            if c and identity_of(parse_signature(c["body"])) == me:
                return f"Resume #{i['number']} ({i['title']}): you hold its claim. bt-work → steps/build.md."
        def mine(p):                                    # merge your own ticket's PR, never another implementer's
            refs = closing_refs(p["body"])
            held = [live_claims(by_n.get(r, {}).get("comments")) for r in refs]
            return bool(refs) and all(c and identity_of(parse_signature(c[-1]["body"])) == me for c in held)

        for p in prs:                                   # batch run: the implementer merges into batch/*
            if p["baseRefName"].startswith("batch/") and ready_for_review(p) and mine(p) \
                    and all(handed_off_done(by_n.get(r, {})) for r in closing_refs(p["body"])):
                return f"Merge PR #{p['number']} into {p['baseRefName']}: steps/batch.md step 3."
        if batch_job:                                   # interactive: after your own resume and merge
            return batch_job
        for i in issues:
            if i["number"] in in_batch:                 # the batch session builds these
                continue
            if st(i) != "ready-for-agent" or is_wayfinder(i["labels"]) or ticket_type(i["body"]) in UNCLAIMABLE:
                continue
            if not ctx.open_blockers(i):
                return f"Build #{i['number']} ({i['title']}): `ticket.py claim {i['number']}`, then steps/build.md."
        return None
    if info is not None:
        info.update(in_flight_and_owner(ctx, issues, prs))
    closed_specs = agent_closed_specs(ctx)
    issues_and_shipped = issues + shipped_closed_specs(ctx, issues, closed_specs)     # closing a spec must not lose its duties
    duty = housekeeping_due(ctx, issues_and_shipped)
    if duty:                                        # first: it unblocks stale claims
        return duty
    job = batch_end_job(ctx, issues, by_n)
    if job:                                             # ends the batch, which opens the PR to review
        return job
    for p in prs:                                       # orchestrator
        if p["baseRefName"] == ctx.main or p["baseRefName"].startswith("batch/"):
            continue                                    # main waits for "ship it"; batch/* is the implementer's
        if not (is_aggregate(p["headRefName"]) or ready_for_review(p)):
            continue
        try:
            _, _, approved = owner_gate(ctx, p)
        except ContractError:                       # an unreadable gate is not a merge job
            approved = False
        if not approved:
            if info is not None:
                info["owner"] = sorted(set(info["owner"] + [f"PR #{p['number']}"]))
            continue                                 # only the owner can approve it; do the next job
        if valid_approval(p, author_may_approve=is_aggregate(p["headRefName"])):
            return f"Merge PR #{p['number']}: `ticket.py merge {p['number']}` (steps/review.md)."
        return f"Review PR #{p['number']} ({p['title']}): steps/review.md."
    for i in issues:
        if ticket_type(i["body"]) == "decision" and door_field(i["body"]) == "two-way":
            return (f"Decide #{i['number']} ({i['title']}): steps/decisions.md, then "
                    f"`ticket.py decide {i['number']} --file <choice, evidence, undo>`.")
    for i in issues:
        if st(i) in OWNER_STATES and owner_answered(i["comments"]):
            return f"#{i['number']} has an unsigned reply, likely the owner's: steps/decisions.md."
    for i in issues:
        names = label_names(i["labels"])
        if "needs-triage" in names:
            return f"Triage #{i['number']} ({i['title']}): steps/bugs.md."
        if not st(i) and "spec" not in names and not is_wayfinder(names) and ticket_type(i["body"]) \
                and not lint_ticket(i["body"], ctx.project.get("ticket_limits")):
            return f"Promote #{i['number']}: `ticket.py check {i['number']} --promote`."
    survey = survey_due(ctx)
    if survey:
        return survey
    return retro_due(ctx, issues_and_shipped) or checkpoint_due(ctx, issues_and_shipped, closed_specs)


def agent_closed_specs(ctx) -> list[dict]:
    """Closed specs the orchestrator signed a Closed note on (so not those the owner closed earlier)."""
    rows = ctx.mirror_or_gh(lambda m: m.issues("closed", label="spec", limit=100),
                            ["gh", "issue", "list", "--state", "closed", "--label", "spec", "--limit", "100",
                             "--json", "number,title,body,labels,comments,state,createdAt"])
    return [r for r in rows if keyword_comments(r["comments"], "Closed", by=ctx.orch)]


def shipped_closed_specs(ctx, issues: list[dict], rows: list[dict]) -> list[dict]:
    """Of the specs `ticket.py` closed, those with a duty still due: their last Shipped note has
    no later Retro, or is newer than the latest Housekeeping note."""
    if not rows:
        return []
    housekept = max((c["createdAt"] for i in issues + rows for c in
                     keyword_comments(i["comments"], KW_HOUSEKEEPING, by=ctx.orch)), default="")
    out = []
    for r in rows:
        shipped = keyword_comments(r["comments"], KW_SHIPPED)
        retros = keyword_comments(r["comments"], KW_RETRO)
        if shipped and (not retros or retros[-1]["createdAt"] <= shipped[-1]["createdAt"]
                        or shipped[-1]["createdAt"] > housekept):
            out.append(r)
    return sorted(out, key=lambda i: i["number"])


def housekeeping_due(ctx, issues: list[dict]) -> str | None:
    """A Shipped note or an ended batch with no later Housekeeping note on the
    Small fixes spec (or the open spec) leaves stale claims to clear. With no
    note at all, housekeeping is due once there is a spec to record it on."""
    specs = [i for i in issues if "spec" in label_names(i["labels"])]
    if not specs:
        return None
    want = ctx.project.get("small_fixes_spec")
    target = next((i for i in specs if i["number"] == want), specs[0])
    notes = keyword_comments(target["comments"], KW_HOUSEKEEPING, by=ctx.orch)
    activity = [c["createdAt"] for i in issues for c in i["comments"]
                if first_line(c["body"]) in (KW_SHIPPED, KW_BATCH_END)]
    if not notes or (activity and max(n["createdAt"] for n in notes) <= max(activity)):
        return (f"Housekeeping due: docs/agents/steps/housekeeping.md, then "
                f"ticket.py note {target['number']} --keyword Housekeeping")
    return None


def retro_due(ctx, issues: list[dict]) -> str | None:
    """A spec that shipped with no Retro note since it names the retro job."""
    for i in issues:
        if "spec" not in label_names(i["labels"]):
            continue
        shipped = keyword_comments(i["comments"], KW_SHIPPED)
        if not shipped:
            continue
        retros = keyword_comments(i["comments"], KW_RETRO)
        if retros and retros[-1]["createdAt"] > shipped[-1]["createdAt"]:
            continue
        return (f"Retro due on spec #{i['number']}: run bt-retro in a fresh sub-agent, "
                f"then ticket.py note {i['number']} --keyword Retro")
    return None


def checkpoint_due(ctx, issues: list[dict], closed_specs: list[dict] = ()) -> str | None:
    """After this many merges and review verdicts on open specs since the
    orchestrator's last Report note, post a Report and keep working. Counted from
    GitHub activity, not from a model's guess at how full its context is.
    `restart_after_jobs` is the old name of the setting; existing projects still have it."""
    every = int(ctx.project.get("checkpoint_after_jobs", ctx.project.get("restart_after_jobs", 8)))
    if every < 1:
        return None
    spec_issues = [i for i in issues if "spec" in label_names(i["labels"])]
    if not spec_issues:
        return None
    specs = {i["number"] for i in spec_issues}
    reports = [c["createdAt"] for i in spec_issues
               for c in keyword_comments(i["comments"], "Report", by=ctx.orch)]
    reports += [c["createdAt"] for i in closed_specs                # a Report on a spec closed since still counts
                for c in keyword_comments(i["comments"], "Report", by=ctx.orch)]
    since = max(reports, default="")
    prs = ctx.mirror_or_gh(lambda m: m.prs("all", limit=100),
                           ["gh", "pr", "list", "--state", "all", "--limit", "100", "--json",
                            "number,body,comments,headRefName,baseRefName,state,mergedAt"])
    events = []
    for p in prs:
        m = re.search(r"^\s*Part of\s+#(\d+)", strip_comments(p.get("body") or ""), re.M | re.I)
        if not m or int(m.group(1)) not in specs:
            continue
        if (p.get("mergedAt") or "") > since and not (p.get("baseRefName") or "").startswith("batch/"):
            events.append(p["mergedAt"])            # the orchestrator's merge
        for kw in (KW_APPROVED, KW_CHANGES):
            events += [c["createdAt"] for c in keyword_comments(p.get("comments"), kw, by=ctx.orch)
                       if c["createdAt"] > since]
    if len(events) >= every:
        return "Checkpoint due: post your Report (docs/agents/templates/report.md) and keep working"
    return None


def batch_runs(ctx, issues: list[dict], by_n: dict) -> list[dict]:
    """Active batches (an orchestrator `Batch` start with no `Batch ended` after it), by target:
    {target, spec, members (open tickets), reported (an implementer `Batch report` on the spec
    after the start), open (not reported, and some member is neither landed nor waiting on
    the owner: there is still work for a batch session)}."""
    batches: dict[str, list[dict]] = {}
    for i in issues:
        target = active_batch(i["comments"], ctx.orch)
        if target:
            batches.setdefault(target, []).append(i)
    out = []
    for target, members in sorted(batches.items()):
        spec = parent_of(members[0]["body"])
        started = max(c["createdAt"] for i in members
                      for c in keyword_comments(i["comments"], KW_BATCH, by=ctx.orch) if field(c["body"], "Target") == target)
        reports = keyword_comments(by_n.get(spec, {}).get("comments", []), "Batch report", by="implementer")
        reported = any(c["createdAt"] > started for c in reports)
        todo = [i for i in members if (status_of(i["labels"], ctx.labels) or [""])[0]
                not in ({"landed-on-integration"} | OWNER_STATES)]
        out.append({"target": target, "spec": spec, "members": members, "reported": reported,
                    "open": spec is not None and not reported and bool(todo)})
    return out


def batch_end_job(ctx, issues: list[dict], by_n: dict) -> str | None:
    """A batch whose implementer has posted the `Batch report` and which the
    orchestrator hasn't ended: `batch end` is the orchestrator's turn."""
    for run in batch_runs(ctx, issues, by_n):
        target, spec, members = run["target"], run["spec"], run["members"]
        if spec is None or not run["reported"]:
            continue
        listed = [c for c in keyword_comments(members[0]["comments"], KW_BATCH, by=ctx.orch)
                  if field(c["body"], "Target") == target]
        m = re.search(r"^Tickets:\s*(.+)$", listed[-1]["body"], re.M)
        nums = ",".join(re.findall(r"\d+", m.group(1))) if m else ",".join(str(i["number"]) for i in members)
        return (f"End batch on spec #{spec}: `ticket.py batch end --tickets {nums} --spec {spec} "
                f"--probes \"<command> green N/N\"`, then steps/batch.md (Orchestrator, at the end).")
    return None


def in_flight_and_owner(ctx, issues: list[dict], prs: list[dict]) -> dict:
    """What keeps the orchestrator working (in-progress or needs-review tickets,
    a running batch) and what only the owner can move (owner states; PRs into main)."""
    into_main: set[int] = set()
    for p in prs:
        if p["baseRefName"] == ctx.main:
            into_main |= set(closing_refs(p["body"]))
    flight, owner = [], []
    for i in issues:
        names = label_names(i["labels"])
        s = status_of(names, ctx.labels)
        s = s[0] if len(s) == 1 else ""
        if "spec" in names:
            continue
        if s in OWNER_STATES or (s == "needs-review" and i["number"] in into_main):
            owner.append(f"#{i['number']}")
        elif s in ("in-progress", "needs-review") or active_batch(i["comments"], ctx.orch):
            flight.append(f"#{i['number']} {s or 'in a batch'}")
    for i in issues:
        if ticket_type(i["body"]) == "decision" and door_field(i["body"]) == "one-way":
            owner.append(f"#{i['number']}")
    owner += [f"PR #{p['number']} (into {ctx.main})" for p in prs if p["baseRefName"] == ctx.main]
    return {"flight": flight, "owner": sorted(set(owner))}


def idle_note(info: dict) -> str:
    """The sentence after "Nothing for the orchestrator": keep going, or stop."""
    if info["flight"]:
        return (f" Work is still in flight ({', '.join(info['flight'])}). Don't end your turn: "
                f"`ticket.py next --role orchestrator --wait 4h`, in the background if you can."
                + (f" Only the owner can unblock what is left: {', '.join(info['owner'])}."
                   if info["owner"] else ""))
    if info["owner"]:
        return f" Only the owner can unblock what is left: {', '.join(info['owner'])}. Report and stop."
    return " Nothing is left."


def survey_due(ctx) -> str | None:
    """Architecture survey due once survey_every_merged_tickets ticket PRs (not
    spec/batch merges) have merged since the last signed Survey note. 0 turns it off."""
    every = int(ctx.project.get("survey_every_merged_tickets", 10))
    if every < 1:
        return None
    prs = ctx.mirror_or_gh(lambda m: m.prs("merged", limit=300),
                           ["gh", "pr", "list", "--state", "merged", "--limit", "300", "--json",
                            "number,body,headRefName,mergedAt"])
    # The note can be on any spec, not just one a merged PR happens to name.
    rows = ctx.mirror_or_gh(lambda m: m.issues("all", label="spec", limit=100),
                            ["gh", "issue", "list", "--label", "spec", "--state", "all", "--limit", "100",
                             "--json", "number,comments"])
    notes = [c for row in rows for c in keyword_comments(row.get("comments"), KW_SURVEY, by=ctx.orch)]
    last = max((c["createdAt"] for c in notes), default="")
    merged = [p for p in prs if p.get("mergedAt", "") > last and not is_aggregate(p["headRefName"])]
    if len(merged) >= every:
        return (f"Architecture survey due: {len(merged)} ticket PRs merged since the last Survey note "
                f"(every {every}). Propose it to the owner: steps/architecture.md.")
    return None


def latest_update(ctx):
    """(number, updated_at) of the repo's most recently updated issue or PR,
    mirror.UNCHANGED on a 304, or None if the probe can't be read. One conditional
    request, shared with `sync`'s stored tag, keeps idle polls free of GraphQL."""
    try:
        p = mirror.probe(ctx.r, ctx.repo(), root=ctx.root, local=True)
        if p.stamp != mirror.UNCHANGED:
            ctx.refresh_tracker()          # the copy is stale: re-sync on the full check
        return p.stamp
    except (mirror.MirrorError, ContractError, sqlite3.Error, OSError, ValueError) as e:
        print(f"note: tracker probe failed ({e}); checking in full", file=sys.stderr)
        ctx.refresh_tracker()              # a failed probe must never reuse an old snapshot
        return None
