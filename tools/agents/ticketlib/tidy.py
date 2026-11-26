from __future__ import annotations

import re
import shutil
from pathlib import Path

from .model import ContractError
from .sessions import KEEP_SESSION_LOGS, prune_sessions
from .verify import receipts_dir

SHOWN = 4                       # paths named per skipped worktree


def _git(ctx, *args: str) -> tuple[int, str]:
    code, out, err = ctx.r.run_result(["git", *args])
    return code, (out if code == 0 else err or out)


def worktrees(ctx) -> list[dict]:
    """`git worktree list --porcelain` as dicts: path, head, branch (None when detached), prunable (git's reason, or "")."""
    code, out = _git(ctx, "worktree", "list", "--porcelain")
    if code:
        raise ContractError(f"git worktree list failed: {out.strip()}")
    found = []
    for block in out.strip().split("\n\n"):
        row = {"path": "", "head": "", "branch": None, "prunable": ""}
        for line in block.splitlines():
            key, _, val = line.partition(" ")
            if key == "worktree":
                row["path"] = val
            elif key == "HEAD":
                row["head"] = val
            elif key == "prunable":
                row["prunable"] = val or "its files are gone"
            elif key == "branch":
                row["branch"] = val.removeprefix("refs/heads/")
        if row["path"]:
            found.append(row)
    return found


def merged_pr_heads(ctx) -> dict[str, set[str]]:
    """Head branch -> the head commits of its merged PRs."""
    prs = ctx.mirror_or_gh(lambda m: m.prs("merged", limit=300),
                           ["gh", "pr", "list", "--state", "merged", "--limit", "300", "--json",
                            "headRefName,headRefOid"])
    heads: dict[str, set[str]] = {}
    for p in prs:
        heads.setdefault(p["headRefName"], set()).add(p.get("headRefOid") or "")
    return heads


def pr_states(ctx) -> dict[str, set[str]]:
    """Head branch -> the states (OPEN, MERGED, CLOSED) of every PR it has had."""
    prs = ctx.mirror_or_gh(lambda m: m.prs("all", limit=300),
                           ["gh", "pr", "list", "--state", "all", "--limit", "300", "--json", "headRefName,state"])
    states: dict[str, set[str]] = {}
    for p in prs:
        states.setdefault(p["headRefName"], set()).add((p.get("state") or "").upper())
    return states


def abandoned_reason(ctx, branch: str, states: dict[str, set[str]]) -> str | None:
    """A ticket branch whose ticket closed as not planned, and whose PRs (if any) all closed unmerged."""
    m = re.match(r"ticket/(\d+)-", branch)
    if not m or not states.get(branch, {"CLOSED"}) <= {"CLOSED"}:
        return None
    try:
        issue = ctx.issue(int(m.group(1)))
    except ContractError:
        return None
    if (issue.get("state") or "").upper() == "CLOSED" and (issue.get("stateReason") or "").upper() == "NOT_PLANNED":
        return f"ticket #{m.group(1)} was closed as not planned"
    return None


def base_branches(ctx, branch: str) -> list[str]:
    """main, plus the branch a ticket branch was cut from when its ticket says so."""
    bases = [ctx.main]
    m = re.match(r"ticket/(\d+)-", branch)
    if m:
        try:
            base = ctx.spec_branch(ctx.issue(int(m.group(1))))
        except ContractError:
            return bases
        if base not in bases:
            bases.append(base)
    return bases


def has_own_work(ctx, branch: str) -> bool:
    """A branch whose reflog says more than 'created' has been committed to or moved. A branch
    cut and never touched sits inside main's history too, so ancestry alone proves nothing for it."""
    code, out = _git(ctx, "reflog", "show", "--format=%H", f"refs/heads/{branch}")
    return code == 0 and len(out.split()) > 1


def merged_reason(ctx, row: dict, pr_heads: dict[str, set[str]]) -> str | None:
    branch, tip = row["branch"], row["head"]
    if tip in pr_heads.get(branch, ()):
        return "its PR merged"
    if has_own_work(ctx, branch):
        for base in base_branches(ctx, branch):
            if _git(ctx, "merge-base", "--is-ancestor", tip, f"origin/{base}")[0] == 0:
                return f"merged into {base}"
    return None


def _named(paths: list[str]) -> str:
    return ", ".join(paths[:SHOWN]) + (f" and {len(paths) - SHOWN} more" if len(paths) > SHOWN else "")


def leftovers(ctx, wt: str, main: str) -> dict | str:
    """What removing worktree `wt` would lose: {"move": [(src, dst)], "delete": [file]}, or the reason it
    must stay. Tidy never deletes a file it can't recreate: only closed tickets' `.work/tickets/<n>/`,
    `.work/jobs/` and bytecode are disposable; paid-run logs move to the main worktree; anything else
    untracked or ignored (or a change to a tracked file) keeps the worktree."""
    code, out = _git(ctx, "-C", wt, "ls-files", "-v", "-z")
    if code:
        return f"unreadable: {out.strip()}"
    hidden = [e[2:] for e in out.split("\0") if len(e) > 2 and (e[0] == "S" or e[0].islower())]
    if hidden:                                              # edits to these are invisible to status and to `worktree remove`
        return f"files hidden from git status (skip-worktree or assume-unchanged): {_named(hidden)}"
    code, out = _git(ctx, "-C", wt, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored")
    if code:
        return f"unreadable: {out.strip()}"
    fields, move, delete, keep, states = out.split("\0"), [], [], [], {}
    i = 0
    while i < len(fields):
        entry = fields[i]
        i += 1
        if len(entry) < 4:
            continue
        xy, rel = entry[:2], entry[3:]
        if xy[0] in "RC":
            i += 1                                          # the rename's source path
        if xy not in ("??", "!!"):
            return "uncommitted changes"
        if rel.endswith("/"):                               # a nested repo: git lists it as one entry
            keep.append(rel)
            continue
        parts = rel.split("/")
        m = re.fullmatch(r"\d+", parts[2]) if parts[:2] == [".work", "tickets"] and len(parts) > 3 else None
        if m:
            n = int(parts[2])
            if n not in states:
                try:
                    states[n] = (ctx.issue(n).get("state") or "").upper()
                except ContractError:
                    states[n] = ""
            (delete if states[n] == "CLOSED" else keep).append(rel)
        elif parts[:2] == [".work", "jobs"] or rel.endswith((".pyc", ".pyo")):
            delete.append(rel)
        elif len(parts) == 3 and parts[:2] == [".work", "paid-runs"]:
            move.append(rel)
        else:
            keep.append(rel)
    if keep:
        return f"untracked or ignored files it can't recreate: {_named(keep)}"
    root, dest = Path(wt), Path(main) / ".work" / "paid-runs"
    return {"move": [(root / r, dest / Path(r).name) for r in move], "delete": [root / r for r in delete]}


def tidy_worktrees(ctx, dry: bool) -> tuple[list[str], list[str], list[str]]:
    """(removed, skipped, detail lines). Never --force, never the current worktree."""
    ctx.r.run(["git", "fetch", "--quiet", "origin"], check=False)
    rows = worktrees(ctx)
    code, top = _git(ctx, "rev-parse", "--show-toplevel")
    here = Path(top.strip()).resolve() if code == 0 and top.strip() else Path(ctx.root).resolve()
    pr_heads, states = merged_pr_heads(ctx), pr_states(ctx)
    removed, skipped, lines = [], [], []

    def skip(row, why):
        skipped.append(row["path"])
        lines.append(f"  skipped {row['path']}: {why}")

    for row in rows[1:]:                                  # the first entry is the main checkout
        if Path(row["path"]).resolve() == here:
            skip(row, "the current worktree")
        elif row["prunable"]:                              # `git worktree prune` would delete its admin dir and reflog, the only record of a commit made there
            skip(row, f"prunable ({row['prunable']}); left for the owner: if nothing in it is needed, `git worktree remove --force {row['path']}`")
        elif not row["branch"]:
            skip(row, "detached HEAD, no branch to judge")
        elif row["branch"] == ctx.main:
            skip(row, f"it holds {ctx.main}")
        elif not (why := merged_reason(ctx, row, pr_heads) or abandoned_reason(ctx, row["branch"], states)):
            continue                                       # unmerged work: left alone, not news
        else:
            plan = leftovers(ctx, row["path"], rows[0]["path"])
            if isinstance(plan, str):
                skip(row, f"{plan} ({row['branch']}, {why})")
            elif dry:
                removed.append(row["path"])
                lines.append(f"  would remove {row['path']} ({row['branch']}: {why})")
            else:
                clash = [dst for _, dst in plan["move"] if dst.exists()]
                if clash:
                    skip(row, f"paid-run log already in the main worktree: {clash[0].name}")
                    continue
                moved = []
                try:
                    for src, dst in plan["move"]:
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(src), str(dst))
                        moved.append(dst.name)
                    for f in plan["delete"]:
                        f.unlink(missing_ok=True)
                except OSError as e:
                    done = f"; paid-run logs already moved to the main worktree: {', '.join(moved)}" if moved else ""
                    skip(row, f"clearing its files failed ({e}); kept{done}")
                    continue
                code, out = _git(ctx, "worktree", "remove", row["path"])     # no --force
                if code:
                    skip(row, f"git refused: {out.strip()}")
                else:
                    removed.append(row["path"])
                    lines.append(f"  removed {row['path']} ({row['branch']}: {why})")
                    if "not planned" in why:                   # git decides whether the unmerged branch may go
                        code, out = _git(ctx, "branch", "-d", row["branch"])
                        lines.append(f"  deleted branch {row['branch']}" if code == 0 else
                                     f"  kept branch {row['branch']}: git won't delete it safely ({out.strip().splitlines()[0]})")
    return removed, skipped, lines


def tidy_ticket_dirs(ctx, dry: bool) -> tuple[list[str], list[str], list[str]]:
    base = ctx.root / ".work" / "tickets"
    removed, kept, lines = [], [], []
    for d in sorted(base.iterdir()) if base.is_dir() else []:
        if not (d.is_dir() and d.name.isdigit()):
            continue
        try:
            state = (ctx.issue(int(d.name)).get("state") or "").upper()
        except ContractError as e:
            kept.append(d.name)
            lines.append(f"  skipped {d}: can't read #{d.name} ({e})")
            continue
        if state != "CLOSED":
            kept.append(d.name)
            continue
        removed.append(d.name)
        lines.append(f"  {'would remove' if dry else 'removed'} {d}")
        if not dry:
            shutil.rmtree(d)
    return removed, kept, lines


def tidy_receipts(ctx, dry: bool) -> tuple[list[str], list[str], list[str]]:
    removed, kept, lines = [], [], []
    reachable, failure = None, ""
    for p in sorted(receipts_dir(ctx.root).glob("*.json")):
        sha = p.stem
        if not re.fullmatch(r"[0-9a-f]{7,64}", sha):
            kept.append(sha)
            continue
        code, full = _git(ctx, "rev-parse", "--verify", "--quiet", f"{sha}^{{commit}}")
        if code == 0:                                       # the commit exists: keep it while any ref reaches it
            if reachable is None and not failure:
                code, out = _git(ctx, "rev-list", "--all")  # every ref, tags and each worktree's HEAD included
                reachable, failure = (set(out.split()), "") if code == 0 else (None, out.strip())
            if reachable is None or full.strip() in reachable:
                kept.append(sha)
                if reachable is None:
                    lines.append(f"  skipped receipt {sha[:12]}: can't tell if it is reachable ({failure})")
                continue
        removed.append(sha)
        lines.append(f"  {'would remove' if dry else 'removed'} receipt {sha[:12]}")
        if not dry:
            p.unlink(missing_ok=True)
    return removed, kept, lines


def tidy_relay_logs(ctx, dry: bool, keep: int) -> tuple[list[str], list[str]]:
    """Keep the newest `keep` sessions (by sequence number) per identity."""
    removed, lines = [], []
    base = ctx.root / ".work" / "relay"
    for ident in sorted(base.iterdir()) if base.is_dir() else []:
        for p in prune_sessions(ident, keep, dry):
            removed.append(str(p))
            lines.append(f"  {'would remove' if dry else 'removed'} {p}")
    return removed, lines


def cmd_tidy(ctx, a):
    """Clean what Baton leaves behind (steps/after.md). Every skip is reported."""
    dry = bool(ctx.r.dry_run or getattr(a, "tidy_dry", False))
    keep = ctx.project.get("keep_session_logs", KEEP_SESSION_LOGS)
    if isinstance(keep, bool) or not isinstance(keep, int) or keep < 1:
        raise ContractError("project.json keep_session_logs must be a whole number of at least 1")
    verb = "would remove" if dry else "removed"
    wt, wt_skip, wt_lines = tidy_worktrees(ctx, dry)
    td, td_kept, td_lines = tidy_ticket_dirs(ctx, dry)
    rc, rc_kept, rc_lines = tidy_receipts(ctx, dry)
    rl, rl_lines = tidy_relay_logs(ctx, dry, keep)
    paid = ctx.root / ".work" / "paid-runs"
    n_paid = len(list(paid.glob("*.log"))) if paid.is_dir() else 0
    print("\n".join([
        f"worktrees: {verb} {len(wt)}, skipped {len(wt_skip)}", *wt_lines,
        f"ticket dirs: {verb} {len(td)} (closed tickets), kept {len(td_kept)}", *td_lines,
        f"verify receipts: {verb} {len(rc)} (commit reachable from no ref), kept {len(rc_kept)}", *rc_lines,
        f"relay session logs: {verb} {len(rl)} files, newest {keep} sessions per identity kept", *rl_lines,
        f"paid-run logs: kept {n_paid} (evidence)",
    ]))
    return 0
