#!/usr/bin/env python3
"""job.py: run a long command detached and wait for it in plain Python.

An agent's tool calls time out, and polling in a shell loop burns tokens (or
hangs: a self-matching `pgrep -f` loop did). Start the command here, then wait
here; the waiting is Python, not an agent.

  job.py verify [--limit 2h]                             run project.json's verify command as a job
  job.py run --name <n> [--limit 2h] -- <command ...>   start it, return at once
  job.py wait <n> --max 9m                               block up to --max; one line
  job.py tail <n> -n 20                                  the last lines of the log (capped)
  job.py status                                          one line per job

Every output is one line or a capped tail; there is no full-log command. The
log is .work/jobs/<n>.log. Job state (pid, exit status) lives under the git
common dir in a folder keyed by this worktree, never committed: parallel
implementers in sibling worktrees can share the name `verify`. Relay state
stays machine-wide per identity, so a relay survives a switch of worktree. `--limit` is a safety timeout that kills a
hung job (default: project.json `job_limit`); it is plumbing, not a process rule.
relay.py reuses the helpers here.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ticketlib.github import read_config   # noqa: E402
from ticketlib.model import ContractError, parse_duration   # noqa: E402,F401  (one parser, shared with ticket.py)
from ticketlib.verify import passing_receipt, read_receipt, receipts_dir, write_receipt as store_receipt  # noqa: E402,F401

TAIL_CAP = 100          # most lines `tail` ever prints
LINE_CAP = 300          # longest line any output prints
STATUS_CAP = 20         # most jobs `status` lists
DEFAULT_LIMIT = "2h"


class JobError(Exception):
    pass


# --------------------------------------------------------------------------
# Helpers shared with relay.py
# --------------------------------------------------------------------------

def fmt_age(seconds: float) -> str:
    seconds = max(0, int(seconds))
    if seconds < 90:
        return f"{seconds}s"
    if seconds < 90 * 60:
        return f"{seconds // 60}m"
    return f"{seconds / 3600:.1f}h"


def clip(text: str, cap: int = LINE_CAP) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= cap else text[: cap - 1] + "…"


def project_root(start: Path | None = None) -> Path:
    """The project's top folder (the one with docs/agents/project.json), else the git top."""
    here = (start or Path.cwd()).resolve()
    for q in [here, *here.parents]:
        if (q / "docs/agents/project.json").exists():
            return q
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=here, text=True, capture_output=True)
    if r.returncode == 0 and r.stdout.strip():
        return Path(r.stdout.strip())
    raise JobError("not inside a set-up project or a git repo")


def common_dir(root: Path) -> Path:
    r = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                       cwd=root, text=True, capture_output=True)
    if r.returncode != 0 or not r.stdout.strip():
        raise JobError("no git common dir here; run inside the project's git repo")
    return Path(r.stdout.strip())


def worktree_key(root: Path) -> str:
    """A short stable id for this worktree: the git common dir is shared, so
    job state kept there must say which checkout it belongs to."""
    return hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:8]


def baton_dir(root: Path) -> Path:
    """The shared folder under the git common dir: every worktree reads the same receipts."""
    return common_dir(root) / "baton"


def state_dir(root: Path, kind: str, per_worktree: bool = True) -> Path:
    """Only job state is keyed by worktree; a relay is one machine-wide identity."""
    base = baton_dir(root)
    d = (base / worktree_key(root) / kind) if per_worktree else (base / kind)
    d.mkdir(parents=True, exist_ok=True)
    return d


def git_output(root: Path, *args: str) -> str:
    r = subprocess.run(["git", *args], cwd=root, text=True, capture_output=True)
    # rstrip only: `git status --porcelain` starts each line with a status letter
    # and a space; strip() would eat the first line's space and shift every path.
    return r.stdout.rstrip() if r.returncode == 0 else ""


def head_sha(root: Path) -> str:
    """The commit the worktree was on when the job started."""
    return git_output(root, "rev-parse", "HEAD")


def dirty_files(root: Path) -> list[str]:
    """The first 10 uncommitted paths, ignoring .work/ (our own scratch files)."""
    lines = [l[3:] for l in git_output(root, "status", "--porcelain").splitlines()
             if l.strip() and not l[3:].startswith(".work/")]
    return lines[:10]


def worktree_dirty(root: Path) -> bool:
    """Uncommitted changes at start, ignoring .work/ (our own scratch files)."""
    return bool(dirty_files(root))


def is_verify_job(root: Path, name: str, cmd: list[str], receipt_command: str | None = None) -> bool:
    """Only a job running the project's verify command earns a receipt.

    `name` alone is never proof: `run --name verify -- <other command>` is just
    a job. `verify` passes the exact config string, which runs through a shell.
    """
    if receipt_command is not None:
        return True
    verify = " ".join(str(read_config(root, "project.json").get("verify_command") or "").split())
    return bool(verify) and " ".join(cmd).split() == verify.split()


def write_receipt(root: Path, st: dict, log: Path, exit_code: int):
    info = st.get("verify") or {}
    if not info.get("sha"):
        return
    rec = {"sha": info["sha"], "command": info.get("command", ""), "exit": exit_code,
           "dirty": bool(info.get("dirty")), "dirty_files": info.get("dirty_files", []),
           "finished": dt.datetime.now(dt.timezone.utc).isoformat(),
           "last_line": last_line(log), "worktree": str(root)}
    store_receipt(root, rec)


def receipt_line(root: Path, state: dict) -> str | None:
    rec = read_receipt(root, (state.get("verify") or {}).get("sha"))
    if not rec:
        return None
    status = "dirty" if rec.get("dirty") else ("pass" if rec.get("exit") == 0 else "fail")
    return f"receipt: {rec['sha'][:7]} {status}"


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def write_json(path: Path, data: dict):
    """Atomic: a reader never sees half a file."""
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data))
    os.replace(tmp, path)


def process_start(pid) -> str | None:
    """The kernel's start time for a pid, so a reused pid isn't mistaken for
    the process we recorded. None when it can't be read."""
    try:
        if Path("/proc").is_dir():                      # Linux: field 22, after the last ')'
            fields = Path(f"/proc/{int(pid)}/stat").read_text().rsplit(")", 1)[1].split()
            return fields[19] if len(fields) > 19 else None
        r = subprocess.run(["ps", "-o", "lstart=", "-p", str(pid)], text=True, capture_output=True)
        return r.stdout.strip() or None
    except (OSError, ValueError, IndexError):
        return None


def pid_alive(pid, start: str | None = None) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    if start and process_start(pid) != start:            # an old state file has no start: behave as before
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:                                    # a zombie is finished, whatever kill says
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0] != "Z"
    except (OSError, IndexError):
        return True


def tail_lines(path: Path, n: int, cap: int = TAIL_CAP) -> list[str]:
    n = max(1, min(int(n), cap))
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 64 * 1024))        # the tail only; a big log is never read whole
            data = f.read().decode("utf-8", "replace")
    except OSError:
        return []
    return [clip(l) for l in data.splitlines()[-n:]]


def last_line(path: Path) -> str:
    for line in reversed(tail_lines(path, 20)):
        if line.strip():
            return line
    return ""


def detach(argv: list[str], log: Path | None, cwd: Path, env: dict | None = None) -> subprocess.Popen:
    """Start argv in its own session with all output going to `log` (or nowhere)."""
    out = open(log, "ab") if log else subprocess.DEVNULL
    try:
        return subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=out,
                                start_new_session=True)
    finally:
        if log:
            out.close()


def kill_group(pid: int, sig=signal.SIGTERM):
    try:
        os.killpg(pid, sig)
    except (ProcessLookupError, PermissionError):
        try:
            os.kill(pid, sig)
        except (ProcessLookupError, PermissionError):
            pass


# --------------------------------------------------------------------------
# Jobs
# --------------------------------------------------------------------------

NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")


def job_paths(root: Path, name: str) -> tuple[Path, Path]:
    if not NAME.fullmatch(name):
        raise JobError(f"job name '{name}' must be letters, digits, . _ - (up to 64)")
    logs = root / ".work" / "jobs"
    logs.mkdir(parents=True, exist_ok=True)
    return state_dir(root, "jobs") / f"{name}.json", logs / f"{name}.log"


def default_limit(root: Path) -> str:
    return str(read_config(root, "project.json").get("job_limit") or DEFAULT_LIMIT)


def view(state: dict) -> dict:
    """The state plus what is true now: running, done or lost (its runner died)."""
    s = dict(state)
    if "exit" in s:
        s["phase"] = "done"
    elif pid_alive(s.get("runner"), s.get("runner_start")):
        s["phase"] = "running"
    else:
        s["phase"] = "lost"
    return s


def finish_line(root: Path, name: str, state: dict, log: Path) -> str:
    s = view(state)
    age = fmt_age((s.get("finished") or time.time()) - s.get("started", time.time()))
    last = last_line(log)
    if s["phase"] == "done":
        why = " (killed at its limit)" if s.get("killed") else ""
        line = f"done, exit {s['exit']}{why}, {age}, {last}"
        if s["exit"] != 0:                              # tell the agent how to see what went wrong
            hint = f"; next: job.py tail {name} -n 40"
            line = clip(line, LINE_CAP - len(hint)) + hint
        return clip(line)
    if s["phase"] == "lost":
        return clip(f"lost after {age}: its runner died without recording an exit, {last}")
    return clip(f"running {age} (last: {last})")


def cmd_run(a) -> int:
    root = project_root()
    sp, log = job_paths(root, a.name)
    old = view(read_json(sp)) if sp.exists() else None
    if old and old["phase"] == "running":
        raise JobError(f"job '{a.name}' is already running (pid {old.get('runner')}); wait for it or pick another name")
    cmd = a.command[1:] if a.command[:1] == ["--"] else a.command
    if not cmd:
        raise JobError("no command; use: job.py run --name <n> -- <command ...>")
    limit = parse_duration(a.limit or default_limit(root))
    log.write_text("")
    state = {"name": a.name, "cmd": cmd, "limit": limit, "started": time.time(), "log": str(log),
             "cwd": str(root)}
    receipt_command = getattr(a, "receipt_command", None)
    if is_verify_job(root, a.name, cmd, receipt_command):
        state["verify"] = {"sha": head_sha(root), "dirty": worktree_dirty(root),
                           "dirty_files": dirty_files(root), "command": receipt_command or " ".join(cmd)}
    write_json(sp, state)
    runner = detach([sys.executable, str(Path(__file__).resolve()), "_runner", a.name, str(root)], None, root)
    for _ in range(100):                                    # the runner records its pid at once
        st = read_json(sp)
        if st.get("runner") or "exit" in st or runner.poll() is not None:
            break
        time.sleep(0.05)
    print(clip(f"started {a.name} (pid {read_json(sp).get('runner', runner.pid)}, limit {fmt_age(limit)}, "
               f"log {os.path.relpath(log, root)})"))
    return 0


def cmd_verify(a) -> int:
    """Run the project's verify_command as a job named verify, through sh -c.

    Shell words matter: project.json may use `&&` or a pipe. The receipt's
    command is the config string itself, so a receipt from another command
    never counts as proof of this project's verify.
    """
    root = project_root()
    verify = str(read_config(root, "project.json").get("verify_command") or "")
    if not verify.strip():
        raise JobError("set verify_command in docs/agents/project.json; job.py verify needs it to prove the head")
    a.name, a.command, a.receipt_command = "verify", ["--", "sh", "-c", verify], verify
    return cmd_run(a)


def cmd_runner(a) -> int:
    """Internal: the detached supervisor. Runs the command, enforces the limit, records the exit."""
    root = Path(a.root)
    sp, log = job_paths(root, a.name)
    st = read_json(sp)
    st["runner"] = os.getpid()
    st["runner_start"] = process_start(st["runner"])
    write_json(sp, st)
    out = open(log, "ab")
    try:
        proc = subprocess.Popen(st["cmd"], cwd=root, stdin=subprocess.DEVNULL, stdout=out, stderr=out,
                                start_new_session=True)
    except OSError as e:
        out.write(f"could not start: {e}\n".encode())
        st.update(exit=127, finished=time.time())
        write_json(sp, st)
        write_receipt(root, st, log, 127)
        return 0
    st["child"] = proc.pid
    st["child_start"] = process_start(proc.pid)
    write_json(sp, st)
    deadline = time.time() + st["limit"]
    killed = False
    while True:
        try:
            rc = proc.wait(timeout=0.2)
            break
        except subprocess.TimeoutExpired:
            if time.time() >= deadline:
                killed = True
                kill_group(proc.pid, signal.SIGTERM)
                try:
                    rc = proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    kill_group(proc.pid, signal.SIGKILL)
                    rc = proc.wait()
                break
    if killed:
        kill_group(proc.pid, signal.SIGKILL)        # anything it left behind
    st = read_json(sp)
    st.update(exit=rc, finished=time.time(), **({"killed": True} if killed else {}))
    write_json(sp, st)
    write_receipt(root, st, log, rc)
    return 0


def load(name: str) -> tuple[Path, dict, Path]:
    root = project_root()
    sp, log = job_paths(root, name)
    if not sp.exists():
        raise JobError(f"no job named '{name}' (job.py status lists them)")
    return root, read_json(sp), log


def cmd_wait(a) -> int:
    root, state, log = load(a.name)
    deadline = time.time() + parse_duration(a.max)
    sp = job_paths(root, a.name)[0]
    while True:
        state = read_json(sp)
        if view(state)["phase"] != "running" or time.time() >= deadline:
            break
        time.sleep(min(0.5, max(0.0, deadline - time.time())))
    print(finish_line(root, a.name, state, log))
    if state.get("verify"):
        line = receipt_line(root, state)
        if line:
            print(line)
    return 0


def cmd_tail(a) -> int:
    root, state, log = load(a.name)
    for line in tail_lines(log, a.n):
        print(line)
    return 0


def cmd_status(a) -> int:
    root = project_root()
    rows = []
    for sp in sorted(state_dir(root, "jobs").glob("*.json")):
        s = read_json(sp)
        if not s:
            continue
        v = view(s)
        age = fmt_age((s.get("finished") or time.time()) - s.get("started", time.time()))
        res = f"exit {s['exit']}" if v["phase"] == "done" else v["phase"]
        line = clip(f"{s.get('name', sp.stem)} {res} {age} · {' '.join(s.get('cmd', []))}", 120)
        if s.get("verify") and (rline := receipt_line(root, s)):
            line = clip(f"{line} · {rline}", LINE_CAP)
        rows.append((s.get("started", 0), line))
    if not rows:
        print("no jobs")
    for _, line in sorted(rows, reverse=True)[:STATUS_CAP]:
        print(line)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="job.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("verify", help="run project.json's verify_command as a job named verify")
    s.add_argument("--limit", help="kill the job after this long (default project.json job_limit)")
    s.set_defaults(fn=cmd_verify)
    s = sub.add_parser("run", help="start a command detached; returns at once")
    s.add_argument("--name", required=True)
    s.add_argument("--limit", help="kill the job after this long (90s, 30m, 2h); default project.json job_limit")
    s.add_argument("command", nargs=argparse.REMAINDER, help="-- <command ...>")
    s.set_defaults(fn=cmd_run)
    s = sub.add_parser("wait", help="block up to --max, then print one line")
    s.add_argument("name"); s.add_argument("--max", default="9m", help="at most this long (default 9m)")
    s.set_defaults(fn=cmd_wait)
    s = sub.add_parser("tail", help=f"the last lines of the log (at most {TAIL_CAP})")
    s.add_argument("name"); s.add_argument("-n", type=int, default=20)
    s.set_defaults(fn=cmd_tail)
    s = sub.add_parser("status", help="one line per job"); s.set_defaults(fn=cmd_status)
    s = sub.add_parser("list", help="one line per job (alias of status)"); s.set_defaults(fn=cmd_status)
    s = sub.add_parser("_runner"); s.add_argument("name"); s.add_argument("root"); s.set_defaults(fn=cmd_runner)
    return p


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    try:
        return a.fn(a) or 0
    except (JobError, ContractError) as e:
        print(f"REFUSED: {clip(e)}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
