#!/usr/bin/env python3
"""relay.py: starts headless implementer sessions for the jobs `ticket.py next` names.

Two-harness mode: the owner talks to the orchestrator, and nothing else starts
the implementer's session. This does, as plain stdlib Python. The method is the
loop (bt-work, bt-implement-spec: success goes to review, failure goes up the
failure ladder, then a stuck handoff); the relay adds no judgement.

  relay.py start --as implementer#1 [--detach] [--once] [--max-jobs N] [--limit 8h]
  relay.py stop [--as <identity> | --all]     the current session finishes, then the relay exits
  relay.py status                             one line per relay
  relay.py log [--as <identity>] --tail N     capped tail (default 20, at most 100) of the newest session log

Per job: claim first for "Build #n" (a refused claim moves on, no tokens spent);
write the prompt to .work/relay/<identity>/<seq>.md; run
project.json `harness_commands[<Harness>]` (a list, or a string; `{prompt}` or
`{prompt_file}` is replaced, and `{model_args}` expands to the implementer
role's argv words) with AGENT_SIGNATURE set and tools/agents/guard
first on PATH. The child's stdout and stderr go ONLY to <seq>.log, never to this
process, so an orchestrator that starts a relay never reads its output. Then check
progress: a new signed comment by this identity, or a new commit on the ticket or
batch branch, since the session started.

Exit codes: 0 stopped (stop file, SIGINT, --once or --max-jobs reached); 2 refused
(bad config, or this identity is already running: a pid lock); 3 halted for the
owner (`notify_command`): a session ended with no progress, or 2 sessions in a row
failed. A halt is recorded as a signed Note on the ticket (stale-claim rule b).
The first SIGINT lets the session finish; the second is forwarded to the child.
A SIGTERM ends the session's whole process group (SIGTERM, then SIGKILL) and stops.
The relay never releases claims.
Preflight (exit 2) needs a passing `setup.py smoke` for the harness (project.md, Smoke
test results). A session that outlasts --limit (default 8h) is killed (SIGTERM, then
SIGKILL), logged, and counts as failed; the usual progress check follows.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import re
import shlex

import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import job      # noqa: E402
import setup as project_setup   # noqa: E402  (one parser for Extras, one rule for command templates)
import ticket   # noqa: E402
from ticketlib.sessions import KEEP_SESSION_LOGS, prune_sessions   # noqa: E402

STOPPED, REFUSED, HALTED = 0, 2, 3
LOG_DEFAULT, LOG_CAP = 20, 100
FAILURES_TO_HALT = 2
SESSION_LIMIT = "8h"        # safety timeout for one session; plumbing, not a process rule
KILL_GRACE = 5              # seconds between SIGTERM and SIGKILL at the limit
RETRY_SLEEPS = (30, 60, 120)  # a failing gh read gets three more tries, backing off each time
NO_HARNESS = ("no implementer harness: set roles.implementer in docs/agents/project.json "
              "(the setup session does this), or pass --harness <name>")
INSTRUCTIONS = ("Follow AGENTS.md and the bt-work skill (if your tool can't load skills, read "
                ".agents/skills/bt-work/SKILL.md). Do this one job only. When it is done, or you are "
                "stuck, hand off (`python3 tools/agents/ticket.py handoff`) and exit.")


class Refused(Exception):
    pass


def say(text: str):
    """The relay's own output: one short line at a time. Child output never comes through here."""
    print(job.clip(text, 200), flush=True)


def gh_read(fn, *args, **kw):
    """A GitHub read gets three more tries, with growing waits, before it
    counts as a failure; one bad response doesn't halt the relay."""
    for attempt, delay in enumerate((0, *RETRY_SLEEPS)):
        if delay:
            time.sleep(delay)
        try:
            return fn(*args, **kw)
        except ticket.ContractError:
            if attempt == len(RETRY_SLEEPS):
                raise


# --------------------------------------------------------------------------
# Files: lock, state, stop file, prompts
# --------------------------------------------------------------------------

class Files:
    def __init__(self, root: Path, ident: str):
        self.root, self.ident = root, ident
        d = job.state_dir(root, "relay", per_worktree=False)
        self.pid, self.stop, self.state = (d / f"{ident}.{x}" for x in ("pid", "stop", "state"))
        self.work = root / ".work" / "relay" / ident

    def rel(self, p: Path) -> str:
        return os.path.relpath(p, self.root)

    def pid_info(self) -> tuple[int | None, str | None]:
        """(pid, start time): old plain-pid lock files have no start time."""
        try:
            text = self.pid.read_text().strip()
        except OSError:
            return None, None
        try:
            data = json.loads(text)
        except ValueError:
            try:
                return int(text), None
            except ValueError:
                return None, None
        if isinstance(data, dict):
            return data.get("pid"), data.get("start")
        return (data, None) if isinstance(data, int) else (None, None)  # a plain pid is old state

    def holder(self) -> int | None:
        pid, start = self.pid_info()
        return pid if job.pid_alive(pid, start) else None

    def lock(self):
        """One relay per identity on this machine: an exclusive pid file."""
        for _ in range(3):
            if self.holder():
                raise Refused(f"{self.ident} is already running (pid {self.holder()}); `relay.py stop --as \"{self.ident}\"` first")
            self.pid.unlink(missing_ok=True)
            try:
                fd = os.open(self.pid, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                continue
            with os.fdopen(fd, "w") as f:
                json.dump({"pid": os.getpid(), "start": job.process_start(os.getpid())}, f)
            self.stop.unlink(missing_ok=True)       # a stop meant for the last run
            self.work.mkdir(parents=True, exist_ok=True)
            return
        raise Refused(f"could not take the lock for {self.ident}")

    def unlock(self):
        if self.holder() == os.getpid():
            self.pid.unlink(missing_ok=True)

    def update(self, **kw):
        st = job.read_json(self.state)
        st.update(kw, pid=os.getpid(), ident=self.ident, updated=time.time())
        job.write_json(self.state, st)

    def next_seq(self) -> str:
        seqs = [int(m.group(1)) for p in self.work.glob("*.md") if (m := re.fullmatch(r"(\d+)\.md", p.name))]
        return f"{max(seqs, default=0) + 1:03d}"

    def prune(self, keep: int = KEEP_SESSION_LOGS):
        """Keep the newest sessions, prompts and logs alike (the same rule `ticket.py tidy` applies)."""
        prune_sessions(self.work, keep)


# --------------------------------------------------------------------------
# Config and the child
# --------------------------------------------------------------------------

def role_config(ctx) -> dict:
    """Harness, model and effort for the implementer: the role table, or the raw --as's old parts.

    ctx.sig, not need_sig()'s identity: an old long signature is the only record
    of its harness and model on projects that have no role table yet."""
    role = (ctx.project.get("roles") or {}).get("implementer") or {}
    if isinstance(role, dict) and role.get("harness"):
        return role
    parts = (ctx.sig or "").split(" · ")
    if len(parts) >= 2:
        return {"harness": parts[1].strip(), "model": " · ".join(parts[2:]).strip(), "effort": "default"}
    return {}


def harness_of(ctx) -> str:
    return role_config(ctx).get("harness", "")


def model_args_of(role: dict) -> list[str]:
    """A role's model_args as argv words: the old string form is shell-split."""
    raw = (role or {}).get("model_args") or []
    return shlex.split(raw) if isinstance(raw, str) else list(raw)


def hard_config(role: dict) -> dict:
    """The optional stronger role for a ticket that has climbed the ladder."""
    hard = (role or {}).get("hard") or {}
    return hard if isinstance(hard, dict) else {}


def hard_ticket(ctx, job_text: str) -> int | None:
    """The ticket number when this job is a ladder or 'hard' ticket, else None."""
    m = re.match(r"(?:Build|Resume) #(\d+)", job_text)
    if not m:
        return None
    n = int(m.group(1))
    try:
        issue = ctx.issue(n)
    except ticket.ContractError:
        return None
    if "hard" in ticket.label_names(issue["labels"]) or \
            ticket.keyword_comments(issue["comments"], ticket.KW_LADDER):
        return n
    return None


def detach_argv(ctx, a, sig: str, harness: str, max_jobs: int | None) -> list[str]:
    """The child's argv: the bare identity, plus --harness when no role table can name it."""
    argv = [sys.executable, str(Path(__file__).resolve()), "start", "--as", sig, "--every", str(a.every),
                "--limit", a.limit]
    argv += ["--max-jobs", str(max_jobs)] if max_jobs is not None else []
    if not (ctx.project.get("roles") or {}).get("implementer"):
        argv += ["--harness", harness]       # the child has only the stripped identity
    return argv


def child_env(root: Path, sig: str, base: dict | None = None) -> dict:
    """AGENT_SIGNATURE, and the gh guard first on PATH: the hook-free guard, enforced here.
    BATON_GH_LOG is deliberately kept so a pilot's sessions write to the same gh call log."""
    env = dict(base if base is not None else os.environ)
    guard = str(root / "tools" / "agents" / "guard")
    rest = [d for d in env.get("PATH", "").split(os.pathsep) if d and d != guard]
    env["PATH"] = os.pathsep.join([guard] + rest)
    env["AGENT_SIGNATURE"] = sig
    env["PWD"] = str(root)          # OpenCode's shell tool starts in $PWD, not the process's working dir
    env.pop("BATON_SMOKE_MARK", None)                       # only the smoke test sets it
    return env


def command_template(ctx, harness: str, model_args: list[str] | None = None) -> list[str]:
    cmds = ctx.project.get("harness_commands") or {}
    key = harness if harness in cmds else next((k for k in cmds if k.lower() == harness.lower()), None)
    if not key or not cmds[key]:
        raise Refused(f"project.json harness_commands has no command for '{harness}'")
    try:
        words = project_setup.command_words(cmds[key])
    except ValueError as e:
        raise Refused(f"harness_commands['{key}'] {e}")
    if model_args and not any(w == "{model_args}" for w in words):
        raise Refused(f"harness_commands['{key}'] needs a whole {{model_args}} word: "
                      "roles.implementer.model_args is set")
    return words


def smoke_line_needed(root: Path, harness: str):
    if not project_setup.smoke_verified(root, harness):
        raise Refused(f'no passing smoke test for {harness}: run `python3 tools/agents/setup.py smoke --harness "{harness}"` first')


def write_prompt(files: Files, sig: str, job_text: str, seq: str) -> Path:
    lines = [f"You are {sig}. `AGENT_SIGNATURE` is already set to it; sign as it.", "",
             f"Do this one job: {job_text}", "", INSTRUCTIONS]
    extras = project_setup.extras_lines(files.root, "implementer")
    if extras:
        lines += ["", "Session-start instructions for this project (docs/agents/project.md, Extras):"]
        lines += [f"- {x}" for x in extras]
    path = files.work / f"{seq}.md"
    path.write_text("\n".join(lines) + "\n")
    return path


# --------------------------------------------------------------------------
# Jobs and progress
# --------------------------------------------------------------------------

class Watch:
    """What to look at for progress: issues (signed comments by this identity) and branches (commits)."""
    def __init__(self, issues=(), branches=()):
        self.issues, self.branches = list(dict.fromkeys(issues)), list(dict.fromkeys(branches))


def ticket_branch(n: int, issue: dict) -> str:
    """The branch this ticket's work is on: `claim` reuses the first Claimed note's branch."""
    return ticket.claimed_branch(issue.get("comments") or []) or f"ticket/{n}-{ticket.slug(issue['title'])}"


def watch_for(ctx, job_text: str) -> Watch | None:
    if m := re.match(r"(?:Build|Resume) #(\d+)", job_text):
        n = int(m.group(1))
        return Watch([n], [ticket_branch(n, ctx.issue(n))])
    if m := re.match(r"Merge PR #(\d+) into (\S+?):", job_text):
        pr = ctx.pr(int(m.group(1)))
        return Watch(ticket.closing_refs(pr["body"]), [m.group(2).rstrip(".")])
    if m := re.match(r"Run the batch on spec #(\d+) \(target (\S+?)\)", job_text):
        spec, target = int(m.group(1)), m.group(2)
        issues = ctx.r.json(["gh", "issue", "list", "--state", "open", "--limit", "300", "--json",
                             "number,title,comments"]) or []
        members = [i for i in issues if ticket.active_batch(i["comments"], ctx.orch) == target]
        return Watch([spec] + [i["number"] for i in members],
                     [target] + [ticket_branch(i["number"], i) for i in members])
    return None


def branch_head(ctx, branch: str) -> str:
    try:
        return ctx.r.run(["gh", "api", f"repos/{ctx.repo()}/git/ref/heads/{branch}", "--jq", ".object.sha"]).strip()
    except ticket.ContractError:
        return ""


def snapshot(ctx, ident: str, watch: Watch) -> tuple:
    mine = []
    for n in watch.issues:
        cs = [c for c in ctx.issue(n)["comments"]
              if ticket.parse_signature(c.get("body")) and ticket.identity_of(ticket.parse_signature(c["body"])) == ident]
        mine.append((n, len(cs)))
    return tuple(mine), tuple((b, branch_head(ctx, b)) for b in watch.branches)


def post_halt_notes(ctx, watch: Watch | None, text: str):
    """Rule (b) of stale claims reads this: a signed Note on each watched in-progress ticket with a claim."""
    for n in (watch.issues if watch else []):
        issue = ctx.issue(n)
        if ticket.active_claim(issue["comments"]) and "in-progress" in ticket.label_names(issue["labels"]):
            ctx.comment("issue", n, "Note", text)


# --------------------------------------------------------------------------
# The loop
# --------------------------------------------------------------------------

class Relay:
    def __init__(self, ctx, files: Files, sig: str, every: float, limit: float = 8 * 3600, role: dict | None = None):
        self.ctx, self.files, self.sig, self.every, self.limit = ctx, files, sig, every, limit
        self.role = role if role is not None else role_config(ctx)
        self.interrupts, self.child, self.terminated, self.watch = 0, None, False, None

    # signals ------------------------------------------------------------
    def on_signal(self, signum, frame):
        if signum == signal.SIGTERM:
            self.terminated = True
            if self.child and self.child.poll() is None:
                job.kill_group(self.child.pid, signal.SIGTERM)
                time.sleep(KILL_GRACE)                  # let the group go quietly, then make sure
                job.kill_group(self.child.pid, signal.SIGKILL)
                say("SIGTERM: ending the session's process group")
            return
        self.interrupts += 1
        if self.interrupts >= 2 and self.child and self.child.poll() is None:
            job.kill_group(self.child.pid, signal.SIGINT)
            say("second interrupt: forwarded to the session")
        elif self.interrupts == 1:
            say("interrupt: finishing the current session, then stopping (again to forward it)")

    def should_stop(self) -> bool:
        return self.terminated or self.interrupts > 0 or self.files.stop.exists()

    def sleep(self, seconds: float):
        end = time.time() + seconds
        while not self.should_stop() and time.time() < end:
            time.sleep(min(1.0, max(0.0, end - time.time())))

    # waiting for a job --------------------------------------------------
    def wait_for_job(self, refused: dict):
        """The cheap idle probe (one call for the newest-updated item) and a full `next` only
        when something changed. None when asked to stop."""
        seen, checked = None, False
        while not self.should_stop():
            stamp = ticket.latest_update(self.ctx)
            unchanged = stamp == ticket.mirror.UNCHANGED
            if not checked or stamp is None or (not unchanged and stamp != seen):
                found = gh_read(ticket.next_job, self.ctx, "implementer", relay=True)
                seen, checked = stamp, True
                # A 304 means "same as before": do not retry a job refused at
                # the earlier stamp just because this wait started a new poll.
                previous = refused.get(found)
                if found and not (previous is not None and
                                  (stamp == previous or stamp == ticket.mirror.UNCHANGED)):
                    return found, stamp
            self.sleep(self.every)
        return None, None

    # one session --------------------------------------------------------
    def run_child(self, argv: list[str], log: Path) -> int:
        with open(log, "ab") as out:
            self.child = subprocess.Popen(argv, cwd=self.ctx.root, env=child_env(self.ctx.root, self.sig),
                                          stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                                          start_new_session=True)
        deadline = time.time() + self.limit
        while True:
            try:
                return self.child.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                if time.time() >= deadline:
                    return self.kill_at_limit(log)

    def kill_at_limit(self, log: Path) -> int:
        """A hung session must not stall the relay: SIGTERM its group, SIGKILL after a grace, log it,
        and count it as failed (the usual progress check still runs)."""
        job.kill_group(self.child.pid, signal.SIGTERM)
        try:
            self.child.wait(timeout=KILL_GRACE)
        except subprocess.TimeoutExpired:
            pass
        job.kill_group(self.child.pid, signal.SIGKILL)   # the group, even if the leader already exited
        self.child.wait()
        with open(log, "a") as f:
            f.write(f"\nrelay: session killed at its limit ({job.fmt_age(self.limit)})\n")
        return 124

    def halt(self, reason: str, watch: Watch | None = None, log: Path | None = None, note: str | None = None) -> int:
        where = f"; log {self.files.rel(log)}" if log else ""
        w = watch or self.watch                         # a gh error can halt us with no watch to hand in
        if w:
            with contextlib.suppress(ticket.ContractError):
                post_halt_notes(self.ctx, w, note or f"Relay halted: {reason}.")
        self.files.update(state="halted", result=reason)
        self.ctx.notify(f"relay {self.files.ident} halted: {reason}{where}")
        say(f"HALTED: {reason}{where}")
        return HALTED

    def loop(self, max_jobs: int | None) -> int:
        ctx, files = self.ctx, self.files
        sessions, failures, refused = 0, 0, {}
        files.update(state="idle", job=None, result=None)
        while True:
            if self.should_stop():
                return self.stopped("stopped")
            if max_jobs is not None and sessions >= max_jobs:
                return self.stopped("job limit reached")
            job_text, stamp = self.wait_for_job(refused)
            if job_text is None:
                return self.stopped("stopped")
            if m := re.match(r"Build #(\d+)", job_text):
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        ticket.cmd_claim(ctx, argparse.Namespace(number=int(m.group(1))))
                except ticket.ContractError as e:
                    refused[job_text] = stamp
                    if stamp is None:                   # nothing changed to compare: back off before retrying
                        self.sleep(self.every)
                    say(f"claim refused on #{m.group(1)}: {e}; moving on")
                    continue
                self.watch = Watch([int(m.group(1))])   # the claim is held: a halt must note it
            watch = gh_read(watch_for, ctx, job_text)
            self.watch = watch
            if watch is None:
                return self.halt(f"unrecognised job '{job.clip(job_text, 80)}'", None, None)
            before = gh_read(snapshot, ctx, files.ident, watch)
            seq = files.next_seq()
            prompt_file = write_prompt(files, self.sig, job_text, seq)
            log = files.work / f"{seq}.log"
            hard = hard_config(self.role)
            hard_n = hard_ticket(ctx, job_text) if hard else None
            if hard_n:
                model_args = model_args_of(hard)
                say(f"relay {files.ident}: hard ticket #{hard_n}: {hard.get('model', '?')}, "
                    f"effort {hard.get('effort', '?')}")
            else:
                model_args = model_args_of(self.role)
            argv = project_setup.build_command(command_template(ctx, self.role.get("harness", ""), model_args),
                                               prompt_file.read_text(), str(prompt_file), model_args)
            files.update(state="running", job=job.clip(job_text, 80), seq=seq, started=time.time(), log=files.rel(log))
            say(f"session {seq}: {job.clip(job_text, 100)}")
            sessions += 1
            rc = self.run_child(argv, log)
            self.child = None
            if self.terminated:
                return self.stopped("terminated by SIGTERM")
            if self.interrupts >= 2:
                return self.stopped("session cut short by the second interrupt")
            progressed = gh_read(snapshot, ctx, files.ident, watch) != before
            failures = failures + 1 if rc != 0 else 0
            result = f"exit {rc}, {'progress' if progressed else 'no progress'}"
            files.update(state="idle", last=f"session {seq}: {result}", result=result)
            files.prune(ctx.project.get("keep_session_logs", KEEP_SESSION_LOGS))
            say(f"session {seq} done: {result}")
            if not progressed:
                return self.halt("session ended without progress", watch, log,
                                 note="Relay session ended without progress: no new signed comment or commit on the "
                                      "ticket or batch branch. The relay halted; the owner is told.")
            if failures >= FAILURES_TO_HALT:
                return self.halt(f"{failures} sessions in a row failed", watch, log)
            self.watch = None                           # progress was made: a later halt mustn't note this ticket

    def stopped(self, why: str) -> int:
        self.files.update(state="stopped", result=why)
        say(f"{self.files.ident}: {why}")
        return STOPPED


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def preflight(ctx, sig: str | None, harness: str | None = None) -> tuple[str, Files, dict, str]:
    """`harness` is the explicit --harness for a project with no role table.

    ctx.sig still holds the original --as / AGENT_SIGNATURE here, so an old long
    signature can name the harness before need_sig() strips it to an identity.
    """
    try:
        sig = ctx.need_sig()
    except ticket.ContractError as e:
        raise Refused(str(e))
    if ticket.role_of(sig) != "implementer":
        raise Refused("a relay runs implementer sessions; sign as implementer#<n>")
    role = role_config(ctx)
    harness = (harness or "").strip() or harness_of(ctx)
    if not harness:
        raise Refused(NO_HARNESS)
    argv = command_template(ctx, harness, model_args_of(role) or model_args_of(hard_config(role)))
    smoke_line_needed(ctx.root, harness)
    path = child_env(ctx.root, sig)["PATH"]
    if not shutil.which(argv[0], path=path):
        raise Refused(f"'{argv[0]}' (the {harness} command) isn't on PATH; fix harness_commands or install it")
    if not (ctx.root / "tools" / "agents" / "guard").is_dir():
        raise Refused("tools/agents/guard is missing; run `python3 tools/agents/setup.py check --fix`")
    files = Files(ctx.root, ticket.identity_of(sig))
    if files.holder():
        raise Refused(f"{files.ident} is already running (pid {files.holder()})")
    return sig, files, role, harness


def cmd_start(ctx, a) -> int:
    limit = job.parse_duration(a.limit)
    sig, files, role, harness = preflight(ctx, ctx.sig, a.harness)
    role = dict(role)
    role.setdefault("harness", harness)         # the child has no role table to fall back on
    say(f"relay {files.ident}: {role.get('harness', '?')}, model {role.get('model', '?')}, "
        f"effort {role.get('effort', '?')}")
    max_jobs = 1 if a.once else a.max_jobs
    if a.detach:
        files.work.mkdir(parents=True, exist_ok=True)
        log = files.work / "relay.log"
        argv = detach_argv(ctx, a, sig, harness, max_jobs)
        proc = job.detach(argv, log, ctx.root)
        for _ in range(100):                        # the child takes the lock within moments
            if files.holder() == proc.pid or proc.poll() is not None:
                break
            time.sleep(0.05)
        if proc.poll() is not None and files.holder() != proc.pid:
            raise Refused(f"the relay exited at once (code {proc.returncode}); see {files.rel(log)}")
        say(f"relay {files.ident} started (pid {proc.pid}, log {files.rel(log)})")
        return STOPPED
    files.lock()
    rl = Relay(ctx, files, sig, a.every, limit, role)
    old = {s: signal.signal(s, rl.on_signal) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        say(f"relay {files.ident} running (pid {os.getpid()}); `relay.py stop` ends it after the current session")
        try:
            return rl.loop(max_jobs)
        except ticket.ContractError as e:
            return rl.halt(f"GitHub check failed: {e}", None, None)
    finally:
        for s, h in old.items():
            signal.signal(s, h)
        files.unlock()


def relay_files(root: Path) -> list[Path]:
    return sorted(job.state_dir(root, "relay", per_worktree=False).glob("*.state"))


def ident_arg(a) -> str | None:
    """The identity from --as (a full signature or just 'implementer#1') or AGENT_SIGNATURE."""
    text = (a.sig or os.environ.get("AGENT_SIGNATURE") or "").strip()
    ident = ticket.identity_of(text) or text
    return ident if ticket.IDENTITY.match(ident or "") else None


def cmd_stop(ctx, a) -> int:
    root = ctx.root
    idents = [p.stem for p in relay_files(root)] if a.all else [ident_arg(a)]
    idents = [i for i in idents if i]
    if not idents:
        raise Refused('say which relay: --as "<identity>" or --all')
    for ident in idents:
        f = Files(root, ident)
        if f.holder():
            f.stop.write_text("stop")
            say(f"stop requested for {ident} (pid {f.holder()}); it ends after its current session")
        else:
            say(f"{ident} isn't running")
    return STOPPED


def cmd_status(root: Path) -> int:
    rows = relay_files(root)
    if not rows:
        say("no relays")
    for sp in rows[: job.STATUS_CAP]:
        st, f = job.read_json(sp), Files(root, sp.stem)
        alive = f.holder()
        if alive:
            cur = f"{st.get('state')}" + (f" · {st['job']} (session {st.get('seq')}, {job.fmt_age(time.time() - st.get('started', time.time()))})"
                                          if st.get("state") == "running" else "")
            line = f"{sp.stem} pid {alive} {cur} · last: {st.get('last') or 'none yet'}"
        else:
            line = f"{sp.stem} not running · {st.get('state')}: {st.get('result') or 'no result'}"
            if st.get("log"):
                line += f" · log {st['log']}"
        say(line)
    return STOPPED


def cmd_log(root: Path, a) -> int:
    base = root / ".work" / "relay"
    ident = ident_arg(a)
    dirs = [base / ident] if ident else [d for d in sorted(base.glob("*")) if d.is_dir()]
    if len(dirs) != 1:
        raise Refused(f"say which relay with --as: {', '.join(d.name for d in dirs) or 'none has run here'}")
    def order(p: Path):
        return (0, int(p.stem)) if p.stem.isdigit() else (1, p.stem)  # 1000 is newer than 999
    logs = sorted((p for p in dirs[0].glob("*.log") if p.name != "relay.log"), key=order) \
        or sorted(dirs[0].glob("relay.log"), key=order)
    if not logs:
        raise Refused(f"no logs yet for {dirs[0].name}")
    print(f"# {os.path.relpath(logs[-1], root)} (last {min(max(a.tail, 1), LOG_CAP)} lines)")
    for line in job.tail_lines(logs[-1], a.tail, LOG_CAP):
        print(line)
    return STOPPED


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="relay.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def ident(s):
        s.add_argument("--as", dest="sig", help='identity "implementer#1" (or AGENT_SIGNATURE)')

    s = sub.add_parser("start", help="run implementer sessions for the jobs `next` names")
    ident(s)
    s.add_argument("--harness", help="launch harness when roles.implementer is unset (else read from --as)")
    s.add_argument("--detach", action="store_true", help="run in the background; prints one line")
    s.add_argument("--once", action="store_true", help="one session, then exit")
    s.add_argument("--max-jobs", type=int, help="exit after this many sessions")
    s.add_argument("--every", type=float, default=60, help="seconds between idle checks (default 60)")
    s.add_argument("--limit", default=SESSION_LIMIT, help="safety timeout for one session (90s, 30m, 8h); default 8h")
    s = sub.add_parser("stop", help="ask a relay to exit after its current session")
    ident(s); s.add_argument("--all", action="store_true")
    sub.add_parser("status", help="one line per relay")
    s = sub.add_parser("log", help=f"the last lines of the newest session log (at most {LOG_CAP})")
    ident(s); s.add_argument("--tail", type=int, default=LOG_DEFAULT)
    return p


def main(argv: list[str] | None = None, runner_factory=ticket.Runner) -> int:
    a = build_parser().parse_args(argv)
    try:
        root = ticket.find_root(Path.cwd().resolve())
        if a.cmd == "status":
            return cmd_status(root)
        if a.cmd == "log":
            return cmd_log(root, a)
        ctx = ticket.Ctx(root, runner_factory(root, False), a.sig or os.environ.get("AGENT_SIGNATURE"))
        if a.cmd == "stop":
            return cmd_stop(ctx, a)
        return cmd_start(ctx, a)
    except (Refused, ticket.ContractError, job.JobError) as e:
        print(f"REFUSED: {job.clip(e, 300)}", file=sys.stderr)
        return REFUSED


if __name__ == "__main__":
    sys.exit(main())
