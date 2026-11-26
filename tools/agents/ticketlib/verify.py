from __future__ import annotations

import datetime as dt
import json
import os
import shlex
import subprocess
from contextlib import contextmanager
from pathlib import Path

from .github import read_config
from .model import ContractError, field, is_test_path


def receipts_dir(root: Path) -> Path:
    """Receipts live under the git common dir so every worktree reads the same ones."""
    try:
        r = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                           cwd=root, text=True, capture_output=True)
        base = Path(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip() else root / ".git"
    except OSError:
        base = root / ".git"
    d = base / "baton" / "receipts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_receipt(root: Path, rec: dict):
    path = receipts_dir(root) / f"{rec['sha']}.json"
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")     # atomic: a reader never sees half a file
    tmp.write_text(json.dumps(rec))
    os.replace(tmp, path)


def read_receipt(root: Path, sha: str | None) -> dict | None:
    """The raw receipt for a (possibly short) sha, whatever its result."""
    if not sha:
        return None
    for p in sorted(receipts_dir(root).glob("*.json")):
        try:
            rec = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        if rec.get("sha", "").startswith(sha):
            return rec
    return None


def verify_command(root: Path) -> str:
    """The current verify command, read from disk: receipts outlive one session."""
    return str(read_config(root, "project.json").get("verify_command") or "")


def verify_hint() -> str:
    """The two commands that leave a passing receipt, and where to run them."""
    return ("  python3 tools/agents/job.py verify\n"
            "  python3 tools/agents/job.py wait verify\n"
            "Run them in the PR's worktree at its head commit.")


def passing_receipt(root: Path, sha: str | None) -> dict | None:
    """The receipt for sha only when the current verify passed on a clean worktree."""
    rec = read_receipt(root, sha)
    if not rec or rec.get("exit") != 0 or rec.get("dirty") is not False:
        return None
    want = " ".join(verify_command(root).split())
    got = " ".join(str(rec.get("command") or "").split())
    return rec if got == want else None


def failing_test_proof(ctx, n: int, pr: dict, claim: dict) -> str | None:
    """Bug tickets need a failing receipt on an earlier, test-changing commit.

    A passing receipt on the head only proves the final state. The earlier
    commit must sit on this branch, after its base, and its diff must touch a
    test path: that is proof the new test can fail. The return value is None
    when proved, else the exact instruction for the implementer.
    """
    instruction = ("Commit the failing test first, run `python3 tools/agents/job.py verify` "
                   "(it fails, and that's recorded), then commit the fix and verify again. "
                   "If the test and fix already share a commit, either split them (commit the "
                   "test alone first), or hand off with --no-red-proof '<why>'; the owner sees it.")
    root, r = ctx.root, ctx.r
    head = pr.get("headRefOid") or ""
    if not head:
        return instruction
    verify = " ".join(verify_command(root).split())
    base = field(claim["body"], "Base") or pr["baseRefName"]
    r.run(["git", "fetch", "--quiet", "origin", base, pr["headRefName"]], check=False)
    for p in sorted(receipts_dir(root).glob("*.json")):
        try:
            rec = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        sha = rec.get("sha") or ""
        if not sha or sha == head or rec.get("exit") in (None, 0) or rec.get("dirty") is not False:
            continue
        if " ".join(str(rec.get("command") or "").split()) != verify:
            continue
        if not r.ok(["git", "merge-base", "--is-ancestor", sha, head]):
            continue
        if r.ok(["git", "merge-base", "--is-ancestor", sha, f"origin/{base}"]):
            continue                            # already on the base: not this branch's work
        changed = r.run(["git", "diff", "--name-only", f"{sha}^", sha], check=False)
        if any(is_test_path(line) for line in changed.splitlines()):
            return None
    return instruction


@contextmanager
def scratch_worktree(ctx, name: str, ref: str):
    """A detached worktree of `ref` under .work/tmp, removed on the way out, error or not."""
    r = ctx.r
    wt = ctx.root / ".work" / "tmp" / name
    wt.parent.mkdir(parents=True, exist_ok=True)
    r.run(["git", "worktree", "remove", "--force", str(wt)], check=False)
    r.run(["git", "worktree", "add", "--detach", str(wt), ref])
    try:
        yield wt
    finally:
        r.run(["git", "worktree", "remove", "--force", str(wt)], check=False)


def run_verify_in(r, wt: Path, verify: str) -> tuple[int, str]:
    """The project's verify command in `wt`: (exit code, output with stderr folded in; test runners report there)."""
    code, out, _ = r.run_result(["sh", "-c", f"cd {shlex.quote(str(wt))} && ({verify}) 2>&1"])
    return code, out


def verify_at_head(ctx, head: str) -> str:
    """Run verify at `head` in a scratch worktree; record the result and return its last line."""
    verify = (ctx.project.get("verify_command") or "").strip()
    if not verify or ctx.r.dry_run:
        return ""
    with scratch_worktree(ctx, f"verify-{head[:12]}", head) as wt:
        code, out = run_verify_in(ctx.r, wt, verify)
    if code != 0:
        raise ContractError(f"Verify fails on {head[:7]}; not merged: {out.strip()[-500:]}\n{verify_hint()}")
    lines = [l.strip() for l in (out or "").splitlines() if l.strip()]
    last = lines[-1] if lines else ""
    write_receipt(ctx.root, {"sha": head, "command": verify, "exit": 0, "dirty": False,
                             "finished": dt.datetime.now(dt.timezone.utc).isoformat(),
                             "last_line": last, "worktree": str(ctx.root)})
    return last


def verify_for_merge(ctx, head: str) -> str:
    """Passing verify's last line for `head`, from a receipt or by running verify here."""
    rec = passing_receipt(ctx.root, head)
    return rec.get("last_line", "") if rec else verify_at_head(ctx, head)
