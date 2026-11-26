from __future__ import annotations

import datetime as dt
import json
import re
import shlex
from pathlib import Path

from .model import (
    ContractError, KW_BASE_MERGED, KW_CLEANUP, KW_LANDED, SETUP_PREFIX, active_batch, closing_refs,
    is_aggregate, keyword_comments, label_names, lint_pr, strip_comments,
)
from .approval import owner_gate, owner_gate_refusal, pr_files, valid_approval
from .github import report
from .verify import passing_receipt, scratch_worktree, verify_for_merge, verify_hint, write_receipt
from .batch import standing_branch
from .decisions import (
    close_landed, close_landed_on_main, close_spec_if_done, open_tickets_under, unblock_dependants,
)


def landing_recorded(issue: dict, n: int) -> bool:
    """Does the ticket already carry the Landed/Completed note for PR #n?"""
    return any(re.search(rf"PR #{n} merged", c.get("body", ""))
               for kw in (KW_LANDED, "Completed") for c in keyword_comments(issue["comments"], kw))


def delete_remote_head(ctx, head: str):
    """Delete the merged PR's branch on GitHub. Best effort: local branches and
    worktrees are left to steps/after.md, and a failure here is only a note."""
    try:
        ctx.r.run(["gh", "api", "--method", "DELETE", f"repos/{ctx.repo()}/git/refs/heads/{head}"], write=True)
    except (ContractError, OSError) as e:
        print(f"note: couldn't delete the remote branch '{head}' ({e}); delete it on GitHub if it's still there")


def spec_branch_in_use(ctx, branch: str, spec: int | None) -> str:
    """Why a just-merged spec branch is still needed, or '' if it can go. An
    open PR may still target it, and open children are still cut from it."""
    prs = ctx.mirror_or_gh(lambda m: m.prs("open", limit=300),
                           ["gh", "pr", "list", "--state", "open", "--limit", "300", "--json", "baseRefName"])
    if any(p.get("baseRefName") == branch for p in prs):
        return "open PRs still use it as their base"
    if open_tickets_under(ctx, branch, spec):
        return f"spec #{spec} still has open tickets" if spec else "open tickets still use it"
    return ""


def patch_id(r, wt: Path, a: str, b: str) -> str:
    """The stable patch-id of `git diff a..b`: the same change, wherever it sits on the base."""
    diff = r.run(["git", "-C", str(wt), "diff", f"{a}..{b}"])
    out = r.run(["git", "patch-id", "--stable"], input=diff).split()
    if not out:
        raise ContractError(f"The diff {a}..{b} is empty; nothing to compare")
    return out[0]


def own_change_ids(r, wt: Path, old: str, new: str, base_tip: str) -> tuple[str, str]:
    """The PR's own change before and after a base merge: the patch-id of merge-base(old, base_tip)..old
    and of base_tip..new. Equal means the merge left the reviewed diff alone. `base_tip` is the base
    commit merged in: origin/<base> when merging, the merge commit's second parent when auditing.
    The one comparison both merge_base_in and the audit make."""
    old_base = r.run(["git", "-C", str(wt), "merge-base", old, base_tip]).strip()
    return patch_id(r, wt, old_base, old), patch_id(r, wt, base_tip, new)


def merge_base_in(ctx, pr: dict) -> tuple[str, str]:
    """Merge the PR's base into its branch in a scratch worktree (never the implementer's),
    and push the merge commit. Refuses on any conflict, if the PR's own change differs
    after the merge (patch-id of merge-base..head before and after), or if the project's
    verify command fails on the merged result. Returns (new head, patch-id)."""
    n, base, head, old = pr["number"], pr["baseRefName"], pr["headRefName"], pr["headRefOid"]
    verify = (ctx.project.get("verify_command") or "").strip()   # cmd_merge refuses an empty one
    r = ctx.r
    wt = ctx.root / ".work" / "tmp" / f"merge-pr{n}"
    wt.parent.mkdir(parents=True, exist_ok=True)
    r.run(["git", "worktree", "remove", "--force", str(wt)], check=False)
    r.run(["git", "worktree", "add", "--detach", str(wt), f"origin/{head}"])
    try:
        if not r.ok(["git", "-C", str(wt), "merge", "--no-edit", f"origin/{base}"]):
            r.run(["git", "-C", str(wt), "merge", "--abort"], check=False)
            how = (f"merge origin/{base} into {head} in its worktree, fix the conflicts, verify, push, then get a fresh review"
                   if is_aggregate(head) else
                   "send the ticket back so its implementer merges it in: `ticket.py set <n> ready-for-agent --note ...`")
            raise ContractError(f"Merging '{base}' into '{head}' conflicts; {how}")
        new = r.run(["git", "-C", str(wt), "rev-parse", "HEAD"]).strip()
        before, after = own_change_ids(r, wt, old, new, f"origin/{base}")
        if before != after:
            raise ContractError(f"After merging '{base}', PR #{n}'s own change is no longer the approved diff "
                                f"(patch-id {before} → {after}); it needs a new review")
        try:
            r.run(["sh", "-c", f"cd {shlex.quote(str(wt))} && {verify}"])
        except ContractError as e:
            raise ContractError(f"Verify fails on '{head}' with '{base}' merged in; not merged: "
                                f"{str(e)[-500:]}\n{verify_hint()}")
        r.run(["git", "-C", str(wt), "push", "origin", f"HEAD:refs/heads/{head}"], write=True)
        write_receipt(ctx.root, {"sha": new, "command": verify, "exit": 0, "dirty": False,
                                 "finished": dt.datetime.now(dt.timezone.utc).isoformat(),
                                 "last_line": f"verify passed with '{base}' merged in", "worktree": str(ctx.root)})
        return new, after
    finally:
        r.run(["git", "worktree", "remove", "--force", str(wt)], check=False)


def minor_sync(ctx, pr: dict) -> str:
    """'a.b → a.c' when this `setup/sync-*` PR moves the contract forward within one MAJOR version,
    read from both branches' contract.md on origin; '' otherwise, or if anything can't be read.
    A MINOR sync is routine (one line in the next report); a MAJOR one needs the owner."""
    head, base = pr["headRefName"], pr["baseRefName"]
    if not head.startswith(SETUP_PREFIX + "sync-"):
        return ""
    if ctx.r.run_result(["git", "fetch", "--quiet", "origin", base, head])[0]:
        return ""
    vers = []
    for ref in (base, head):
        code, out, _ = ctx.r.run_result(["git", "show", f"origin/{ref}:docs/agents/contract.md"])
        m = re.search(r"^Contract-Version:\s*(\d+)\.(\d+)\s*$", out, re.M) if code == 0 else None
        if not m:
            return ""
        vers.append((int(m.group(1)), int(m.group(2))))
    (bM, bm), (hM, hm) = vers
    return f"{bM}.{bm} → {hM}.{hm}" if hM == bM and hm > bm else ""


def open_integration_branches(ctx) -> list[str]:
    """Every spec/* and batch/* branch that exists on origin."""
    out = ctx.r.run(["git", "ls-remote", "--heads", "origin", "spec/*", "batch/*"])
    names = [line.split("\trefs/heads/", 1)[1] for line in out.splitlines() if "\trefs/heads/" in line]
    return sorted(n for n in names if n.startswith(("spec/", "batch/")))


def merge_base_into_branch(ctx, b: str, base: str, pr: dict | None):
    """Bring `base` into the remote branch `b`, one result line. A branch that heads an open PR goes through
    `merge_base_in` and gets its `Base merged` note, so the PR's approval still covers the new head."""
    r = ctx.r
    code, _, err = r.run_result(["git", "fetch", "--quiet", "origin", base, b])
    if code:
        print(f"{b}: FAILED fetching ({err.strip()[-200:] or f'git exited {code}'}); nothing pushed. Merge {base} into it by hand")
        return
    if r.ok(["git", "merge-base", "--is-ancestor", f"origin/{base}", f"origin/{b}"]):
        print(f"{b}: already has {base}")
        return
    try:
        if pr:
            pr = dict(pr, headRefOid=r.run(["git", "rev-parse", f"origin/{b}"]).strip())
            new, pid = merge_base_in(ctx, pr)
            try:
                ctx.comment("pr", pr["number"], KW_BASE_MERGED,
                            f"From: {pr['headRefOid']}\nHead: {new}\nBase: {base}\nPatch-id: {pid}\nVerify: green")
            except (ContractError, OSError) as e:
                print(f"{b}: merged {base} and PUSHED {new[:7]}, but the Base merged note wasn't posted "
                      f"({' '.join(str(e).split())[-200:]}). PR #{pr['number']}'s approval needs that note and no "
                      f"ticket.py command posts it: ask for a fresh review of the new head")
                return
            print(f"{b}: merged {base} and pushed; PR #{pr['number']}'s approval still holds (Base merged noted)")
            return
        with scratch_worktree(ctx, "main-into-" + b.replace("/", "-"), f"origin/{b}") as wt:
            code, _, err = r.run_result(["git", "-C", str(wt), "merge", "--no-edit", f"origin/{base}"])
            if code:
                conflicted = r.run(["git", "-C", str(wt), "diff", "--name-only", "--diff-filter=U"], check=False).strip()
                r.run(["git", "-C", str(wt), "merge", "--abort"], check=False)
                if not conflicted:
                    print(f"{b}: FAILED merging {base} ({err.strip()[-300:] or f'git exited {code}'}); nothing pushed. "
                          f"Merge origin/{base} into it by hand")
                    return
                print(f"{b}: CONFLICT merging {base}; nothing pushed. Resolve it: merge origin/{base} "
                      f"into {b} in its worktree, fix the conflicts, verify, push")
                return
            r.run(["git", "-C", str(wt), "push", "origin", f"HEAD:refs/heads/{b}"], write=True)
        print(f"{b}: merged {base} and pushed")
    except ContractError as e:
        word = "CONFLICT" if "conflicts" in str(e) else "FAILED"
        print(f"{b}: {word} ({' '.join(str(e).split())[-300:]}); nothing pushed. Merge {base} into it by hand")


def closed_spec_of(ctx, b: str, pr: dict | None, seen: dict) -> int | None:
    """The number of the closed spec a spec/* or batch/* branch belongs to, else None. A batch's spec is its
    PR's `Part of`, else the number in its name. A spec whose state can't be read counts as open."""
    n = None
    if b.startswith("batch/") and pr:
        m = re.search(r"^\s*Part of\s+#(\d+)", strip_comments(pr.get("body") or ""), re.M | re.I)
        n = int(m.group(1)) if m else None
    if n is None:
        m = re.match(r"^(?:spec|batch)/(\d+)-", b)
        n = int(m.group(1)) if m else None
    if n is None:
        return None
    if n not in seen:
        try:
            seen[n] = str(ctx.issue(n).get("state", "")).upper() == "CLOSED"
        except (ContractError, OSError, ValueError):
            seen[n] = False
    return n if seen[n] else None


def main_into_open_branches(ctx):
    """After a setup PR lands: bring main into every spec/* branch whose spec is open, then each batch/* branch gets its own
    base (its PR's base, else its spec branch, which now has main), so no batch ends up with two merge-bases.
    A branch that heads an open PR keeps its approval (see `merge_base_into_branch`). A conflict aborts that
    branch (it is named for a human or agent to resolve) and the others carry on. One line per branch."""
    r, main = ctx.r, ctx.main
    if r.dry_run:
        print(f"DRY-RUN: would merge origin/{main} into every open spec/* branch, then each batch/* branch's base, and push each")
        return
    try:
        branches = open_integration_branches(ctx)
    except ContractError as e:
        print(f"{main} into open branches: FAILED, couldn't list the branches ({' '.join(str(e).split())[-300:]}); "
              f"merge {main} into each spec/* and batch/* branch by hand")
        return
    if not branches:
        print(f"{main} into open branches: no open spec/* or batch/* branches")
        return
    code, _, err = r.run_result(["git", "fetch", "--quiet", "origin", main, *branches])
    if code:
        print(f"{main} into open branches: FAILED, fetching from origin failed ({err.strip() or f'git exited {code}'}); "
              f"merge {main} into each spec/* and batch/* branch by hand")
        return
    try:
        prs = ctx.mirror_or_gh(lambda m: m.prs("open", limit=300),
                               ["gh", "pr", "list", "--state", "open", "--limit", "300", "--json",
                                "number,headRefName,headRefOid,baseRefName,body"])
    except (ContractError, OSError, ValueError) as e:
        print(f"{main} into open branches: FAILED, couldn't list the open PRs ({' '.join(str(e).split())[-300:]}); "
              f"merge {main} into each spec/* and batch/* branch by hand")
        return
    by_head = {p["headRefName"]: p for p in prs}
    specs = [b for b in branches if b.startswith("spec/")]
    closed: dict = {}
    for b in specs + [b for b in branches if b.startswith("batch/")]:
        pr = by_head.get(b)
        n = closed_spec_of(ctx, b, pr, closed)
        if n is not None:
            print(f"{b}: skipped, spec #{n} is closed")
            continue
        base = pr["baseRefName"] if pr else main
        if not pr and b.startswith("batch/"):
            mine = [s for s in specs if s.startswith(f"spec/{b.split('/', 1)[1].split('-', 1)[0]}-")]
            base = mine[0] if len(mine) == 1 else main
        merge_base_into_branch(ctx, b, base, pr)


def cmd_merge(ctx, a):
    pr = ctx.pr(a.number)
    if not (ctx.project.get("verify_command") or "").strip():
        raise ContractError("set verify_command in docs/agents/project.json; merge needs it to prove the head")
    if pr["state"] not in ("OPEN", "MERGED"):
        raise ContractError(f"PR #{a.number} isn't open: it was closed without merging")
    # MERGED: an earlier run merged on GitHub but stopped before the bookkeeping.
    done = pr["state"] == "MERGED"
    base_merged = ""
    base, head = pr["baseRefName"], pr["headRefName"]
    files = pr_files(ctx, pr)
    if not done:
        problems = lint_pr(pr["body"], head, files, base, ctx.main)
        if problems:
            report(problems, f"PR #{a.number}")
            raise ContractError("PR body doesn't match the contract")
    refs = closing_refs(pr["body"])
    issues = [ctx.issue(n) for n in refs]
    # A spec/* head may merge into an integration branch, not just main: bind it
    # before the base-specific rules so the later bookkeeping can always use it.
    spec = re.search(r"^\s*Part of\s+#(\d+)", strip_comments(pr["body"] or ""), re.M | re.I)
    for issue in issues:
        if "spec" in label_names(issue["labels"]):
            raise ContractError(f"PR #{a.number} would close spec #{issue['number']}; use 'Part of', never 'Closes', for a spec")
    if base == ctx.main:
        ctx.need_role("orchestrator", "merge into main")
        sync = "" if a.owner_go_ahead else minor_sync(ctx, pr)
        if not a.owner_go_ahead and not sync:
            raise ContractError("Merging into main needs --owner-go-ahead '<the owner's words>' "
                                "(only a MINOR contract sync, setup/sync-*, merges without it)")
        if head.startswith("spec/") and spec and not keyword_comments(ctx.issue(int(spec.group(1)))["comments"], KW_CLEANUP):
            raise ContractError(f"Spec #{spec.group(1)} has no Cleanup note: after the final review, "
                                "`ticket.py note <spec> --keyword Cleanup --file f` listing the cleanup "
                                "tickets filed, or 'none found'")
    # The resume path (MERGED) gets every gate that doesn't need an open PR: a PR merged raw
    # on GitHub must not become Landed/Completed without the approval, owner gate and receipt.
    matched, manifests, approved = owner_gate(ctx, pr)
    if not approved:
        raise ContractError(owner_gate_refusal(a.number, matched, manifests))
    if a.batch:
        if not base.startswith("batch/"):
            raise ContractError(f"Batch merges go into a batch/* branch only, not '{base}'")
        targets = {active_batch(i["comments"], ctx.orch) for i in issues}
        if not issues or targets != {base}:
            raise ContractError(f"Batch merge only into the batch's target; PR base is '{base}', "
                                f"tickets' batch targets (set by the orchestrator) {targets or '{}'}")
    else:
        ctx.need_role("orchestrator", "merge outside a batch run")
        author_may = is_aggregate(head)
        if not valid_approval(pr, author_may_approve=author_may):
            raise ContractError("No valid Approved: it must be the latest review, after any Changes requested, "
                                "for the PR's current head commit"
                                + ("" if author_may else ", from a different role than the author"))
    if head.startswith(SETUP_PREFIX) and base != ctx.main:
        raise ContractError(f"A setup/* PR merges into {ctx.main} only, not '{base}'")
    if not is_aggregate(head) and not head.startswith(SETUP_PREFIX) and not refs:
        raise ContractError("A ticket PR must say 'Closes #<n>'")
    if done:
        issues = [i for i in issues if not landing_recorded(i, a.number)]
        if not issues and base != ctx.main:
            raise ContractError(f"PR #{a.number} is already merged and its tickets are recorded; nothing to do")
    for issue in issues:
        # Resuming, the ticket may already be where this merge leaves it: transition moves the label
        # before it posts Landed, and GitHub closes a ticket merged into main. Only ticket.py moves
        # status labels, so that state can't be set by hand to skip the review.
        already = done and (issue["state"] == "CLOSED" if base == ctx.main
                            else ctx.status(issue) == "landed-on-integration")
        if ctx.status(issue) != "needs-review" and not already:
            raise ContractError(f"#{issue['number']} is '{ctx.status(issue) or 'no status'}', not needs-review; "
                                "finish the handoff (or review round) first")
        expected = ctx.spec_branch(issue)
        if not is_aggregate(head) and base != expected:
            raise ContractError(f"PR #{a.number} targets '{base}', but #{issue['number']}'s base is '{expected}' "
                                "(the Base line `claim` printed); retarget the PR")
        if base != ctx.main:
            ctx.check_move(issue, "landed-on-integration")
    if done:
        if not passing_receipt(ctx.root, pr["headRefOid"]):
            raise ContractError(f"PR #{a.number} was merged without verify passing on its head "
                                f"{(pr['headRefOid'] or '')[:7]}: no passing verify receipt here, so it isn't recorded "
                                f"as landed.\n{verify_hint()}")
        print(f"finishing bookkeeping for already-merged PR #{a.number}")
    else:
        failing = failing_checks(ctx, a.number)
        if failing:
            raise ContractError(f"PR #{a.number} has checks that aren't green: {', '.join(failing)}")
        code, _, err = ctx.r.run_result(["git", "fetch", "--quiet", "origin", base, head])
        if code:
            detail = err.strip() or f"git exited {code}"
            raise ContractError(f"PR #{a.number}: fetching '{base}' and '{head}' from origin failed: {detail}. "
                                "Fix git credentials and rerun.")
        if not ctx.r.ok(["git", "merge-base", "--is-ancestor", f"origin/{base}", f"origin/{head}"]):
            if ctx.r.dry_run:
                print(f"DRY-RUN: would merge origin/{base} into {head}, compare patch-ids, verify, push")
            else:
                old = pr["headRefOid"]
                new, pid = merge_base_in(ctx, pr)
                ctx.comment("pr", a.number, KW_BASE_MERGED,
                            f"From: {old}\nHead: {new}\nBase: {base}\nPatch-id: {pid}\nVerify: green")
                pr = ctx.pr(a.number)                   # the new head, for --match-head-commit
                pr["headRefOid"] = new                  # GitHub can lag a moment behind the push
                if not is_aggregate(head) and not a.batch and not valid_approval(pr, False):
                    raise ContractError(f"PR #{a.number}'s approval doesn't cover the merged head")
                base_merged = (f"\nBase merged by ticket.py; approved diff unchanged (patch-id {pid}); "
                               "verify green.")
    # No receipt for the exact head (including a new one from a base merge) means
    # verify never passed on this machine: run it now, or refuse. The Probes line
    # is only a PR field, never a gate.
    verify_note = ""
    if not done and (ctx.project.get("verify_command") or "").strip():
        last_line = verify_for_merge(ctx, pr["headRefOid"])
        verify_note = f" Verify: pass on {pr['headRefOid'][:7]} ({last_line})"
    m = re.search(r"^\s*Probes:.*$", pr["body"] or "", re.M | re.I)
    probes = m.group(0).strip() if m else ""
    probes_note = re.sub(r"^Probes:", "Probes (from PR body):", probes, flags=re.I)
    if not done:
        # Every check has passed: now write. --match-head-commit: a push after these
        # checks makes GitHub refuse the merge. No --delete-branch: gh would also delete
        # the local branch, which fails while the ticket's worktree has it checked out.
        try:
            ctx.r.run(["gh", "pr", "merge", str(a.number), "--merge", "--subject", pr["title"],
                       "--body", probes, "--match-head-commit", pr["headRefOid"]], write=True)
        except ContractError as e:
            if "head branch was modified" in str(e).lower():
                raise ContractError(f"PR #{a.number}: its head changed after the checks, so GitHub refused the "
                                    "merge. Re-verify (`git fetch`, merge origin/" + base + ", verify, push), "
                                    f"then retry. ({e})")
            raise
        merged = {"mergeCommit": {"oid": "<merge-commit>"}} if ctx.r.dry_run else ctx.pr(a.number)
        keep = (spec_branch_in_use(ctx, head, int(spec.group(1)) if spec else None)
                if head.startswith("spec/") else "")
        if head == standing_branch(ctx) or keep:
            if keep:
                print(f"note: kept remote branch '{head}': {keep}")
        else:
            delete_remote_head(ctx, head)
    else:
        merged = pr
    sha = (merged.get("mergeCommit") or {}).get("oid")
    if not sha:
        raise ContractError(f"PR #{a.number} is merged but GitHub gave no merge commit; can't record it")
    note = f"PR #{a.number} merged into {base} as {sha}. {probes_note}{verify_note}{base_merged}"
    if a.owner_go_ahead:
        note += f"\nOwner go-ahead: \"{a.owner_go_ahead}\""
    elif base == ctx.main and sync:
        note += f"\nMINOR contract sync {sync}: no owner go-ahead needed; one line in the next report."
    for issue in issues:
        if base == ctx.main:
            ctx.comment("issue", issue["number"], "Completed", f"Completed in {sha} on {ctx.main}. {note}")
        else:
            ctx.transition(issue, "landed-on-integration", KW_LANDED, note)
            unblock_dependants(ctx, issue["number"])
    if base == ctx.main:
        close_landed(ctx)
        close_landed_on_main(ctx, refs, sha)
        if spec and head.startswith("spec/"):
            close_spec_if_done(ctx, int(spec.group(1)), pr)
    print(note)
    if head.startswith(SETUP_PREFIX):
        main_into_open_branches(ctx)
    return 0


def failing_checks(ctx, n: int) -> list[str]:
    """CI checks on the PR that failed, were cancelled or are still running.
    gh exits 1 when a check failed and 8 while checks are pending, still
    printing the JSON, so the JSON decides whatever the exit code. Only gh's
    'no checks reported' message counts as no checks: a failed call or
    unreadable output must never be mistaken for green."""
    code, out, err = ctx.r.run_result(["gh", "pr", "checks", str(n), "--json", "name,bucket"])
    try:
        checks = json.loads(out) if out.strip() else None
    except ValueError:
        checks = None
    if isinstance(checks, list):
        return [f"{c.get('name')} ({c.get('bucket')})" for c in checks
                if c.get("bucket") in ("fail", "pending", "cancel")]
    if "no checks reported" in f"{err} {out}".lower():
        return []
    reason = err.strip() or out.strip() or f"gh exited {code}"
    raise ContractError(f"couldn't read CI checks for PR #{n}: {reason}. Fix gh auth or the network, then rerun.")
