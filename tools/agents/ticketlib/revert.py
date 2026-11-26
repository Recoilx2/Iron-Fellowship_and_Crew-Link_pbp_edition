from __future__ import annotations

from pathlib import Path

from .model import ContractError, is_test_path, path_matches
from .verify import run_verify_in, scratch_worktree

CANT_RUN = (126, 127)       # the shell couldn't run the command: no evidence either way
TAIL_LINES = 5


def is_test_file(path: str, project: dict) -> bool:
    """`test_paths` globs from project.json when it lists any (a leading `**/` also matches the repo root),
    else the contract's own test-path rule, which knows nested test folders."""
    own = [p for p in (project.get("test_paths") or []) if isinstance(p, str)]
    if not own:
        return is_test_path(path)
    return any(path_matches(path, g) or (g.startswith("**/") and path_matches(path, g[3:])) for g in own)


def restore_base_files(r, wt: Path, base: str, changes: list[tuple[str, str]]):
    """Put each changed source file back as it is on `base`: added files are removed, the rest checked out."""
    for status, path in changes:
        if status == "A":
            (wt / path).unlink(missing_ok=True)
        else:
            r.run(["git", "-C", str(wt), "checkout", base, "--", f":(literal){path}"])


def revert_check(ctx, pr: dict) -> tuple[int, str, list[str]]:
    """A PR's revert check: fetch its base and head from origin, then `revert_check_refs`."""
    if not (ctx.project.get("verify_command") or "").strip():
        raise ContractError("set verify_command in docs/agents/project.json; revert-check runs it")
    r, base, head = ctx.r, pr["baseRefName"], pr["headRefName"]
    code, _, err = r.run_result(["git", "fetch", "--quiet", "origin", base, head])
    if code:
        raise ContractError(f"fetching '{base}' and '{head}' from origin failed: {err.strip() or f'git exited {code}'}")
    return revert_check_refs(ctx, f"origin/{base}", pr["headRefOid"], f"pr{pr['number']}")


def revert_check_refs(ctx, base_ref: str, head_ref: str, name: str) -> tuple[int, str, list[str]]:
    """(exit code, the `Revert check:` line, the last lines of verify's output after the revert): does the
    project's verify fail on `head_ref` with every changed non-test file put back as it is where it branched
    from `base_ref`? Git and verify only; no GitHub. Verify must pass on the head first, and a command that
    can't run proves nothing."""
    verify = (ctx.project.get("verify_command") or "").strip()
    if not verify:
        raise ContractError("set verify_command in docs/agents/project.json; revert-check runs it")
    r = ctx.r
    oid = r.run(["git", "rev-parse", "--verify", f"{head_ref}^{{commit}}"]).strip()
    fork = r.run(["git", "merge-base", base_ref, oid]).strip()
    raw = r.run(["git", "diff", "--name-status", "--no-renames", "-z", fork, oid]).split("\0")
    changed = [(raw[i][:1], raw[i + 1]) for i in range(0, len(raw) - 1, 2)]
    source = [(s, p) for s, p in changed if not is_test_file(p, ctx.project)]
    if len(source) == len(changed):
        return 0, "Revert check: n/a (no test files changed)", []
    if not source:
        return 0, "Revert check: n/a (no non-test files changed)", []
    with scratch_worktree(ctx, f"revert-check-{name}", oid) as wt:
        on_head, _ = run_verify_in(r, wt, verify)
        if on_head:
            return 1, f"Revert check: n/a (verify fails on the head: exit {on_head})", []
        restore_base_files(r, wt, fork, source)
        code, out = run_verify_in(r, wt, verify)
    tail = [l.rstrip() for l in out.splitlines() if l.strip()][-TAIL_LINES:]
    if code in CANT_RUN:
        return 1, f"Revert check: n/a (verify can't run with the change reverted: exit {code})", tail
    if code == 0:
        return 1, "Revert check: FAILED: verify passes with the change reverted", []
    return 0, f"Revert check: verify fails with the change reverted (exit {code})", tail


def cmd_revert_check(ctx, a):
    if a.number is not None:
        code, line, tail = revert_check(ctx, ctx.pr(a.number))
    elif a.base and a.head:
        code, line, tail = revert_check_refs(ctx, a.base, a.head, "local")
    else:
        raise ContractError("give a PR number, or --base <ref> and --head <ref> to use git alone")
    print(line)
    if tail:
        print("Last lines of verify's output (an assertion failure shows the tests check the change; a crash doesn't):")
        for l in tail:
            print(f"  {l}")
    return code
