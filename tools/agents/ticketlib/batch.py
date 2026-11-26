from __future__ import annotations

import argparse
import json
import re
import sys

from .model import (
    ContractError, KW_BATCH, KW_BATCH_END, KW_INTEGRATION, active_batch, active_claim,
    batch_branch_has_commits, batch_pr_heads, ended_batch_targets, integration_branch, label_names,
    lint_ticket, now, parent_of, slug, touch_clashes,
)
from .github import file_ticket, report
from .claims import batch_active


def cmd_integration(ctx, a):
    """Create the spec's integration branch from main and record it on the spec."""
    ctx.need_role("orchestrator", "create an integration branch")
    spec = ctx.issue(a.spec)
    if "spec" not in label_names(spec["labels"]):
        raise ContractError(f"#{a.spec} isn't a spec")
    existing = integration_branch(spec["comments"])
    if existing:
        raise ContractError(f"#{a.spec} already has integration branch {existing}")
    branch = f"spec/{a.spec}-{slug(spec['title'])}"
    ctx.create_branch(branch, ctx.main)
    ctx.comment("issue", a.spec, KW_INTEGRATION, f"Branch: {branch}\nTickets in this spec are cut from it.")
    print(branch)
    return 0


SMALL_FIXES_SPEC = """Type: spec
Part of: none
Blocked by: none

## Problem Statement
Small fixes (`ticket.py quick`) need somewhere to land other than `main` one at a time.

## Solution
This standing spec's integration branch collects them. They ship to `main` together, with one owner go-ahead, through the normal ship flow.

## User Stories
1. As the owner, I approve small fixes together, not one merge each.

## Implementation Decisions
`small_fixes_spec` in `docs/agents/project.json` names this spec; `quick` files under it by default.

## Testing Decisions
Each ticket's own Verify command.

## Children
Pending to-tickets.

## Acceptance criteria
- [ ] `ticket.py status` shows no unshipped small fixes after a ship

## Out of scope
Anything that needs its own spec.
"""


def cmd_small_fixes(ctx, a):
    """Set up the standing "Small fixes" spec and its integration branch; record it in project.json."""
    ctx.need_role("orchestrator", "set up the Small fixes spec")
    existing = ctx.project.get("small_fixes_spec")
    if isinstance(existing, int):
        branch = integration_branch(ctx.issue(existing)["comments"])
        if branch:
            print(f"The Small fixes spec is #{existing} ({branch}); nothing to do.")
            return 0
        return cmd_integration(ctx, argparse.Namespace(spec=existing))
    url = file_ticket(ctx, "Small fixes", SMALL_FIXES_SPEC)
    if not url:
        return 0                                        # dry run
    n = int(url.rstrip("/").split("/")[-1])
    cmd_integration(ctx, argparse.Namespace(spec=n))
    pj = ctx.root / "docs/agents/project.json"
    cfg = json.loads(pj.read_text()) if pj.exists() else {}
    cfg["small_fixes_spec"] = n
    pj.write_text(json.dumps(cfg, indent=2) + "\n")
    print(f"Recorded small_fixes_spec = {n} in docs/agents/project.json; commit it with the setup files.")
    return 0


def standing_branch(ctx) -> str | None:
    """The Small fixes spec's integration branch: it outlives each ship, so merge keeps it."""
    n = ctx.project.get("small_fixes_spec")
    return integration_branch(ctx.issue(n)["comments"]) if isinstance(n, int) else None


def cmd_batch_next(ctx, a):
    """Frontier tickets of a batch and how many implementer slots are free. Read-only."""
    spec = a.spec or a.spec_pos
    if spec is None:
        raise ContractError("batch next needs a spec number: `ticket.py batch next <spec>`")
    issues = ctx.mirror_or_gh(lambda m: m.issues("open", limit=300),
                              ["gh", "issue", "list", "--state", "open", "--limit", "300",
                               "--json", "number,title,body,labels,comments,state"])
    members = [i for i in issues if parent_of(i["body"]) == spec and active_batch(i["comments"], ctx.orch)]
    if not members:
        raise ContractError(f"#{spec} has no active batch")
    target = active_batch(members[0]["comments"], ctx.orch)
    for i in sorted(members, key=lambda i: i["number"]):
        if active_batch(i["comments"], ctx.orch) == target and ctx.status(i) == "ready-for-agent" \
                and not ctx.open_blockers(i) and not active_claim(i["comments"]):
            print(f"#{i['number']} {i['title']}")
    cap = int(ctx.project.get("max_parallel_implementers", 3))
    print(f"free slots: {cap - batch_active(ctx, target, issues)}")
    return 0


def cmd_batch(ctx, a):
    if a.action == "next":
        return cmd_batch_next(ctx, a)
    if not a.tickets or a.spec is None:
        raise ContractError("batch start/end needs --tickets <list> and --spec <spec>")
    ctx.need_role("orchestrator", "start or end a batch")
    nums = [int(x) for x in a.tickets.split(",") if x.strip()]
    spec = ctx.issue(a.spec)
    integ = integration_branch(spec["comments"])
    if not integ:
        raise ContractError(f"Spec #{a.spec} has no integration branch; run `ticket.py integration --spec {a.spec}`")
    issues = [ctx.issue(n) for n in nums]
    if a.action == "start":
        for i in issues:
            problems = lint_ticket(i["body"], ctx.project.get("ticket_limits"))
            if problems:
                report(problems, f"#{i['number']}")
                raise ContractError(f"#{i['number']} isn't batch-ready")
            if parent_of(i["body"]) != a.spec:
                raise ContractError(f"#{i['number']} isn't part of spec #{a.spec}")
            if active_batch(i["comments"], ctx.orch):
                raise ContractError(f"#{i['number']} is already in batch {active_batch(i['comments'], ctx.orch)}")
        clashes = touch_clashes({i["number"]: i["body"] for i in issues})
        if clashes:
            a1, b1, shared = clashes[0]
            raise ContractError(f"#{a1} and #{b1} are both unblocked and both touch {', '.join(sorted(shared))}; "
                                f"add a blocking edge (`ticket.py block`) so one waits for the other")
        target = f"batch/{a.spec}-{now().strftime('%Y%m%d%H%M')}"
        ctx.create_branch(target, integ)
        listing = ", ".join(f"#{n}" for n in nums)
        for n in nums:
            ctx.comment("issue", n, KW_BATCH, f"Target: {target}\nTickets: {listing}")
        ctx.comment("issue", a.spec, "Report", f"Batch started on {target}: {listing}.")
        cap = ctx.project.get("max_parallel_implementers", 3)
        print(target)
        print(f"Run at most {cap} implementers at once (max_parallel_implementers).", file=sys.stderr)
        return 0
    targets = {active_batch(i["comments"], ctx.orch) for i in issues} - {None}
    if not targets:
        # A rerun after Batch ended was posted but the PR couldn't be created.
        # Keep the target even when the PR now exists, so the notes still post.
        targets = {t for i in issues for t in ended_batch_targets(i["comments"], ctx.orch)}
    if len(targets) != 1:
        raise ContractError(f"Tickets aren't in one active batch: {targets or 'none'}")
    if not a.probes or not re.search(r"\b(green|red)\b", a.probes, re.I):
        raise ContractError("batch end needs --probes '<command> green|red ...' for the batch PR")
    target = targets.pop()
    landed = [f"#{i['number']}" for i in issues if ctx.status(i) == "landed-on-integration"]
    stuck = [f"#{i['number']}" for i in issues if ctx.status(i) != "landed-on-integration"]
    count = f"{len(landed)}/{len(issues)}"
    probes = re.sub(r"\s+\d+/\d+\s*$", "", a.probes.strip()) + " " + count
    body = (f"Part of #{a.spec}\nProbes: {probes}\n\n## Summary\nBatch {target}: landed "
            f"{', '.join(landed) or 'none'}; not landed {', '.join(stuck) or 'none'}.\n\n## Evidence\n"
            f"Each ticket's PR carries its own Probes line; this PR's: {probes}.\n\n## Merge Danger\n"
            f"Two-way door: a merge commit into {integ}, revertible. Reaches every ticket listed above.\n\n"
            f"— {ctx.need_sig()}")
    if target in batch_pr_heads(ctx):
        print(f"Batch PR for {target} already exists; reusing it.")
    elif not batch_branch_has_commits(ctx, target, integ):
        print("Nothing landed in the batch; no PR was opened.")
    else:
        out = ctx.r.run(["gh", "pr", "create", "--base", integ, "--head", target, "--title",
                         f"{target}: batch for #{a.spec}", "--body-file", "-"], write=True, input=body)
        print(out.strip() or "(dry run: batch PR not opened)")
    print(f"Probes count is now computed by ticket.py: {count}.")
    # Post only the notes this run still owes: a retry after a partial failure
    # must finish the job without adding a second note to every ticket.
    for i in issues:
        if target not in ended_batch_targets(i["comments"], ctx.orch):
            ctx.comment("issue", i["number"], KW_BATCH_END, (a.note or "Batch run finished.") + f" Landed {count}.")
    ctx.notify(f"{ctx.repo()} batch {target} ended: landed {', '.join(landed) or 'none'}; "
               f"not landed {', '.join(stuck) or 'none'}")
    return 0
