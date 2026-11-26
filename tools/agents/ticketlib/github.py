from __future__ import annotations

import json
import os
import re
import shlex
import sqlite3
import subprocess
import sys
from pathlib import Path

import mirror

from .model import (
    ContractError, IDENTITY, OWNER_STATES, active_batch, add_child_line, allowed, blocked_by_line,
    format_comment, identity_of, integration_branch, label_names, parent_of, role_of, status_of,
    ticket_type,
)


class Runner:
    """Runs gh and git. With dry_run, write commands are printed, not run."""

    def __init__(self, cwd: Path, dry_run: bool = False):
        self.cwd, self.dry_run = cwd, dry_run

    def run_result(self, args: list[str], input: str | None = None,
                   env_extra: dict | None = None) -> tuple[int, str, str]:
        """Run a command without raising, returning (exit code, stdout, stderr).
        Some checks need the failure detail that `run` turns into an exception."""
        env = {**os.environ, "TICKET_CONTRACT_CALL": "1", **(env_extra or {})}   # env_extra may override
        r = subprocess.run(args, cwd=self.cwd, encoding="utf-8", errors="replace",
                           capture_output=True, input=input, env=env)
        return r.returncode, r.stdout, r.stderr

    def run(self, args: list[str], write: bool = False, check: bool = True,
            input: str | None = None, env_extra: dict[str, str] | None = None) -> str:
        if write and self.dry_run:
            print("DRY-RUN:", shlex.join(args))
            return ""
        code, out, err = self.run_result(args, input, env_extra)
        if check and code != 0:
            raise ContractError(f"`{shlex.join(args[:3])} …` failed: {err.strip() or out.strip()}")
        return out

    def json(self, args: list[str]):
        out = self.run(args)
        return json.loads(out) if out.strip() else None

    def ok(self, args: list[str]) -> bool:
        return subprocess.run(args, cwd=self.cwd, capture_output=True).returncode == 0


def read_config(root: Path, name: str, required: bool = False) -> dict:
    """docs/agents/<name> as a JSON object. A missing optional file is {}; a file that is there but
    unreadable or not an object is a refusal naming it, never a traceback."""
    path, shown = root / "docs/agents" / name, f"docs/agents/{name}"
    if not path.exists() and not required:
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:                  # UnicodeDecodeError is a ValueError
        raise ContractError(f"{shown} can't be read as JSON ({e}); fix the file")
    if not isinstance(data, dict):
        raise ContractError(f"{shown} isn't a JSON object; fix the file")
    return data


class Ctx:
    def __init__(self, root: Path, runner: Runner, sig: str | None):
        self.root, self.r, self.sig = root, runner, sig
        self.labels = read_config(root, "labels.json", required=True)
        self.project = read_config(root, "project.json")

    # identity -------------------------------------------------------------
    def need_sig(self) -> str:
        """The identity to write: old long signatures are stripped to the role, not re-signed verbatim."""
        sig = identity_of(self.sig) or ""
        if not IDENTITY.match(sig):
            raise ContractError('Signature needed: --as "<role>" (role: orchestrator or implementer, '
                                'optionally tagged: implementer#2) or AGENT_SIGNATURE; '
                                'e.g. --as implementer#2, written as — implementer#2')
        return sig

    def role(self) -> str:
        return role_of(self.need_sig())

    def identity(self) -> str:
        """Role plus instance tag: who holds a claim (parallel implementers differ by tag)."""
        return identity_of(self.need_sig())

    def need_role(self, role: str, what: str):
        if self.role() != role:
            raise ContractError(f"Only the {role} may {what}")

    def mirror_enabled(self) -> bool:
        """project.json's `mirror` is on by default; BATON_MIRROR=0 is the escape hatch."""
        return (self.project.get("mirror", True) is not False
                and os.environ.get("BATON_MIRROR", "1") != "0")

    def tracker(self):
        """The local tracker copy, synced once per process. None means read
        GitHub directly: switched off, or a failed sync (never fail on a cache)."""
        if hasattr(self, "_tracker"):
            return self._tracker
        self._tracker = None
        if self.mirror_enabled():
            try:
                self._tracker = mirror.sync(self.r, self.repo(), root=self.root)
            except (mirror.MirrorError, ContractError, sqlite3.Error, OSError, ValueError) as e:
                print(f"note: tracker copy unavailable ({e}); reading GitHub directly", file=sys.stderr)
        return self._tracker

    def refresh_tracker(self):
        """A change in GitHub means this process's copy must be read again on
        its next full check (a long `next --wait` keeps the same Ctx)."""
        self._tracker = None

    def using_copy(self) -> bool:
        """Whether list reads come from the copy, whose comments are complete."""
        return self.tracker() is not None

    def mirror_or_gh(self, getter, args: list[str]) -> list[dict]:
        """Lists come from the copy when it works; the original gh list call is
        the fallback, with exactly the fields and limits that call expected.
        A broken cache falls back too: a cache must never fail a contract read."""
        m = self.tracker()
        if m is not None:
            try:
                return getter(m)
            except (mirror.MirrorError, ContractError, sqlite3.Error, OSError, ValueError) as e:
                print(f"note: tracker copy unreadable ({e}); reading GitHub directly", file=sys.stderr)
        return self.r.json(args) or []

    @property
    def main(self) -> str:
        return self.project.get("main_branch", "main")

    @property
    def orch(self) -> str:
        return "orchestrator"

    # GitHub ---------------------------------------------------------------
    def repo(self) -> str:
        """owner/name from the origin remote's URL: no API call. gh is the fallback
        for a remote it can't parse (an SSH alias, say)."""
        if not hasattr(self, "_repo"):
            url = self.r.run(["git", "remote", "get-url", "origin"], check=False).strip()
            m = re.search(r"github\.com[:/]([^/\s]+)/([^/\s]+?)(?:\.git)?/?$", url)
            self._repo = (f"{m.group(1)}/{m.group(2)}" if m else
                          self.r.json(["gh", "repo", "view", "--json", "nameWithOwner"])["nameWithOwner"])
        return self._repo

    def issue(self, n: int) -> dict:
        return self.r.json(["gh", "issue", "view", str(n), "--json",
                            "number,title,body,labels,comments,state,stateReason,createdAt"])

    def pr(self, n: int) -> dict:
        return self.r.json(["gh", "pr", "view", str(n), "--json",
                            "number,title,body,comments,files,headRefName,headRefOid,baseRefName,state,mergeCommit"])

    def comment(self, kind: str, n: int, keyword: str, body: str = "") -> str:
        """Post a signed keyword comment; returns its URL (gh prints it), or '' in a dry run."""
        text = format_comment(keyword, body, self.need_sig())
        out = self.r.run(["gh", kind, "comment", str(n), "--body-file", "-"], write=True, input=text) or ""
        return out.strip().splitlines()[-1] if out.strip() else ""

    def status(self, issue: dict) -> str:
        s = status_of(issue["labels"], self.labels)
        if len(s) > 1:
            raise ContractError(f"#{issue['number']} has more than one status: {s}. The orchestrator fixes it with `set`.")
        return s[0] if s else ""

    def check_move(self, issue: dict, dst: str):
        src = self.status(issue)
        if src != dst and not allowed(src, dst, self.labels):
            raise ContractError(f"#{issue['number']}: '{src or 'no status'}' → '{dst}' isn't an allowed move")

    def transition(self, issue: dict, dst: str, keyword: str, body: str):
        """Move to `dst` (checked first) and post the signed comment with it."""
        self.check_move(issue, dst)
        src = self.status(issue)
        if src != dst:
            args = ["gh", "issue", "edit", str(issue["number"]), "--add-label", dst]
            if src:
                args += ["--remove-label", src]
            if "needs-triage" in label_names(issue["labels"]):
                args += ["--remove-label", "needs-triage"]
            self.r.run(args, write=True)
        self.comment("issue", issue["number"], keyword, body)
        if src != dst and dst in OWNER_STATES:
            self.notify(f"{self.repo()}#{issue['number']} waits on you ({dst}): {issue.get('title', '')}")

    def notify(self, message: str):
        """Tell the owner through project.json's notify_command, whichever harness
        made the move. `{message}` in the command is replaced, and the message is
        also in BATON_MESSAGE: a shell wrapper must read that, not interpolate a
        title into its code. No command, no-op."""
        cmd = self.project.get("notify_command") or ""
        if not cmd.strip():
            return
        args = [t.replace("{message}", message) for t in shlex.split(cmd)]
        if "{message}" not in cmd:
            args.append(message)
        try:
            self.r.run(args, write=True, check=False, env_extra={"BATON_MESSAGE": message})
        except OSError as e:
            print(f"note: notify_command failed ({e}); the owner wasn't notified")

    def open_blockers(self, issue: dict) -> int:
        """Open native blockers; if the API can't say, the Blocked by line decides."""
        n = issue["number"]
        try:
            out = self.r.run(["gh", "api", f"repos/{self.repo()}/issues/{n}",
                              "--jq", ".issue_dependencies_summary.blocked_by // empty"])
            if out.strip():
                return int(out.strip())
        except (ContractError, ValueError):
            pass
        return sum(1 for b in blocked_by_line(issue["body"]) if self.issue(b)["state"] == "OPEN")

    def spec_branch(self, issue: dict) -> str:
        """The branch a ticket is cut from: its active batch's branch, else its
        spec's integration branch, else main."""
        batch = active_batch(issue.get("comments"), self.orch)
        if batch:
            return batch
        p = parent_of(issue.get("body", ""))
        if p:
            branch = integration_branch(self.issue(p)["comments"])
            if branch:
                return branch
        return self.main

    # git ------------------------------------------------------------------
    def on_branch(self, commit: str, branch: str) -> bool:
        self.r.run(["git", "fetch", "--quiet", "origin", branch], check=False)
        return self.r.ok(["git", "merge-base", "--is-ancestor", commit, f"origin/{branch}"])

    def create_branch(self, name: str, base: str):
        sha = self.r.run(["gh", "api", f"repos/{self.repo()}/git/ref/heads/{base}", "--jq", ".object.sha"]).strip()
        self.r.run(["gh", "api", "--method", "POST", f"repos/{self.repo()}/git/refs",
                    "-f", f"ref=refs/heads/{name}", "-f", f"sha={sha}"], write=True)


def read_file(path: str | None) -> str:
    if not path:
        return ""
    if path == "-":
        return sys.stdin.read()
    try:
        return Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ContractError(f"--file '{path}' doesn't exist")
    except IsADirectoryError:
        raise ContractError(f"--file '{path}' is a directory, not a file")
    except UnicodeDecodeError:
        raise ContractError(f"--file '{path}' isn't UTF-8 text")
    except OSError as e:
        raise ContractError(f"--file '{path}' can't be read: {e.strerror or e}")


def report(problems: list[str], what: str):
    if problems:
        print(f"FAIL {what}")
        for p in problems:
            print(f"  - {p}")
    else:
        print(f"OK   {what}")


def add_child(ctx, parent: int, child: int, title: str):
    """List a filed ticket in its spec's Children section, using the guarded body edit."""
    spec = ctx.issue(parent)
    if ticket_type(spec["body"]) != "spec":
        return
    new = add_child_line(spec["body"], child, title)
    if new != spec["body"]:
        ctx.r.run(["gh", "issue", "edit", str(parent), "--body-file", "-"], write=True, input=new)


def file_ticket(ctx, title: str, body: str, parent=None, blocked_by=None, label=None, from_issue=None) -> str:
    """File a ticket (body already linted by the caller); print and return its URL."""
    ctx.need_sig()
    args = ["gh", "issue", "create", "--title", title, "--body-file", "-"]
    if parent:
        args += ["--parent", str(parent)]
    if blocked_by:
        args += ["--blocked-by", blocked_by]
    if ticket_type(body) == "spec":
        args += ["--label", "spec"]
    if label:
        args += ["--label", label]
    out = ctx.r.run(args, write=True, input=body).strip()
    print(out or "(dry run: not created)")
    if out and parent:
        add_child(ctx, parent, int(out.rstrip('/').split('/')[-1]), title)
    if from_issue and out:
        ctx.comment("issue", from_issue, "Filed", f"#{out.rstrip('/').split('/')[-1]}: {title}")
    return out
