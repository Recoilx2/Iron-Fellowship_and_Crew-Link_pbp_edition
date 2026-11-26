#!/usr/bin/env python3
"""setup.py: install, check and sync the agent system in a project.

  survey   read-only: what this machine has for Baton and its extras
  install  run from the master copy: copy the template into a project
  check    run in a project: verify git, folders, contract, labels, skills,
           hooks, guard, gh permissions, harness commands, extras and secrets
           (--quick for the session-start hook, --fix for mechanical fixes)
  smoke    run in a project: launch a harness headless with a trivial job
           and check the guard, signature, allowlist, logs and extras
  extras   list, enable or disable optional extras (project scope only)
  ci --write  write .github/workflows/verify.yml from the example, using the
           project's verify command and the --setup-step options given
  sync     run in a project: pull a newer master contract (MINOR applies,
           MAJOR needs --accept-major)

Standard library only. Never prints secret values; reports paths only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import glob
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

MANIFEST = "docs/agents/.contract-manifest.json"
CONTRACT = "docs/agents/contract.md"
# Copied once, then owned by the project; never synced or overwritten.
PROJECT_OWNED = {"docs/agents/project.json", "docs/agents/project.md", "CODING_STANDARDS.md"}
SKIP_DIRS = {".git", ".work", "node_modules", ".venv", "venv", "env", "__pycache__", ".worktrees"}
# project.json keys the contract has dropped, with the version that dropped them; sync removes
# exactly these and never any other key a project may have added.
RETIRED_KEYS = {"stale_claim_hours": "5.0"}
# project.json keys renamed, with the version that renamed them; sync moves the value, so a project's own setting survives.
RENAMED_KEYS = {"restart_after_jobs": ("checkpoint_after_jobs", "7.3")}
ROLE_NAMES = ("orchestrator", "implementer", "reviewer")   # the roles in project.json's role table
IGNORED_DIRS = {".work": "Agent scratch (baton)", ".serena": "Serena cache (baton)",
                ".playwright-mcp": "Playwright MCP snapshots (baton)"}
ENV_OK = {".env.example", ".env.sample", ".env.template"}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args, cwd=None) -> tuple[int, str]:
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    except OSError as e:                      # the program isn't there
        return 127, str(e)
    return r.returncode, (r.stdout or r.stderr).strip()


def contract_version(path: Path) -> tuple[int, int] | None:
    if not path.exists():
        return None
    m = re.search(r"Contract-Version:\s*(\d+)\.(\d+)", path.read_text())
    return (int(m.group(1)), int(m.group(2))) if m else None


def vstr(v) -> str:
    return f"{v[0]}.{v[1]}" if v else "none"


def template_files(master: Path) -> list[str]:
    root = master / "template"
    out = []
    for p in sorted(root.rglob("*")):
        if p.is_file() and "__pycache__" not in p.parts:
            out.append(p.relative_to(root).as_posix())
    return out


# One master copy of our skills, installed where each harness looks:
# Claude Code reads .claude/skills; OpenCode and others read .agents/skills.
SKILL_DESTS = (".claude/", ".agents/")


def destinations(rel: str) -> list[str]:
    return [d + rel for d in SKILL_DESTS] if rel.startswith("skills/") else [rel]


def master_repo(master: Path) -> str | None:
    """The master copy's GitHub repo (`owner/name`) from its origin remote, or None if unreadable."""
    code, url = run(["git", "remote", "get-url", "origin"], cwd=master)
    if code != 0 or not url:
        return None
    m = re.search(r"github\.com[:/]+([^/\s]+/[^/\s]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else url


def master_commit(master: Path) -> str:
    code, out = run(["git", "rev-parse", "--short", "HEAD"], cwd=master)
    if code != 0:
        return "uncommitted"
    # Only template/ is copied, so only its changes (tracked or untracked) count.
    code2, dirty = run(["git", "status", "--porcelain", "--untracked-files=all", "--", "template"], cwd=master)
    return out + ("+local-changes" if dirty else "")


class Report:
    def __init__(self):
        self.lines: list[tuple[str, str]] = []

    def ok(self, msg): self.lines.append(("OK", msg))
    def warn(self, msg): self.lines.append(("WARN", msg))
    def fail(self, msg): self.lines.append(("FAIL", msg))
    def fixed(self, msg): self.lines.append(("FIXED", msg))

    def print(self, title: str):
        print(title)
        for level, msg in self.lines:
            print(f"  {level:5} {msg}")
        counts = {k: sum(1 for l, _ in self.lines if l == k) for k in ("OK", "FIXED", "WARN", "FAIL")}
        print("  " + ", ".join(f"{v} {k.lower()}" for k, v in counts.items()))

    @property
    def failed(self) -> bool:
        return any(l == "FAIL" for l, _ in self.lines)


# --------------------------------------------------------------------------
# install
# --------------------------------------------------------------------------

def cmd_install(a) -> int:
    master = Path(__file__).resolve().parents[3]
    if not (master / "template" / CONTRACT).exists():
        sys.exit("install runs from the master copy (baton/template/tools/agents/setup.py)")
    proj = Path(a.project).resolve()
    code, top = run(["git", "rev-parse", "--show-toplevel"], cwd=proj)
    if code != 0 or Path(top).resolve() != proj:
        sys.exit(f"{proj} isn't the top level of a git repo")
    manifest_path = proj / MANIFEST
    if manifest_path.exists():
        sys.exit("Already installed. Use `python3 tools/agents/setup.py sync` in the project.")

    copied, owned, same, conflicts = [], [], [], []
    files = {}
    for rel in template_files(master):
        src = master / "template" / rel
        for drel in destinations(rel):
            dst = proj / drel
            if dst.exists():
                if sha(dst) == sha(src):
                    same.append(drel)
                    if rel not in PROJECT_OWNED:
                        files[drel] = sha(src)
                else:
                    conflicts.append(drel)
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            if rel in PROJECT_OWNED:
                owned.append(drel)
            else:
                copied.append(drel)
                files[drel] = sha(src)

    pj = proj / "docs/agents/project.json"
    if pj.exists() and pj.relative_to(proj).as_posix() in owned:
        cfg = json.loads(pj.read_text())
        if a.verify:
            cfg["verify_command"] = a.verify
        pj.write_text(json.dumps(cfg, indent=2) + "\n")

    ensure_folders(proj, Report())
    ensure_hooks(proj, Report(), True)
    rep = Report()
    ensure_claude_path(proj, rep, True)
    manifest = {
        "contract_version": vstr(contract_version(master / "template" / CONTRACT)),
        "master": str(master),
        "master_commit": master_commit(master),
        "master_repo": master_repo(master),
        "installed": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "files": files,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    for _, msg in rep.lines:
        print(f"  {msg}")
    print(f"Installed contract {manifest['contract_version']} from {master} ({manifest['master_commit']})")
    print(f"  copied {len(copied)} files, {len(owned)} project-owned, {len(same)} already identical")
    if conflicts:
        mig = proj / ".work" / "migration.md"
        mig.write_text("# Migration: existing files that differ from the template\n\n"
                       "Not overwritten. Map each onto the contract, show the owner what changes,\n"
                       "and carry out the move as a cleanup ticket breakdown.\n\n"
                       + "".join(f"- `{c}`\n" for c in conflicts))
        print(f"  MIGRATION: {len(conflicts)} existing files differ and were left alone; list in {mig}")
        for c in conflicts:
            print(f"    - {c}")
    if not standards_rules(proj / "CODING_STANDARDS.md"):
        print("  NOTE: CODING_STANDARDS.md has no rules yet, so the Standards review gives only advisory smells. "
              "Ask the owner to add rules or accept the smell baseline.")
    print()
    return cmd_check(argparse.Namespace(quick=False, fix=a.fix, harness=None), root=proj)


# --------------------------------------------------------------------------
# check
# --------------------------------------------------------------------------

def ensure_folders(root: Path, rep: Report, fix: bool = True):
    work = root / ".work"
    if not work.exists():
        if fix:
            (work / "tmp").mkdir(parents=True, exist_ok=True)
            rep.fixed(".work/ created")
        else:
            rep.fail(".work/ missing")
    else:
        rep.ok(".work/ exists")
    gi = root / ".gitignore"
    lines = gi.read_text().splitlines() if gi.exists() else []
    for d, why in IGNORED_DIRS.items():
        lines = gi.read_text().splitlines() if gi.exists() else []
        if any(l.strip() in (d, d + "/", "/" + d, "/" + d + "/") for l in lines):
            rep.ok(f"{d}/ is gitignored")
        elif fix:
            with gi.open("a") as f:
                f.write(("\n" if lines and lines[-1].strip() else "") + f"# {why}\n{d}/\n")
            rep.fixed(f"{d}/ added to .gitignore")
        else:
            rep.fail(f"{d}/ not in .gitignore")
    lines = gi.read_text().splitlines() if gi.exists() else []
    if not any(l.strip() in (".env", "/.env", ".env*") for l in lines):
        if fix:
            with gi.open("a") as f:
                f.write(("\n" if gi.read_text().strip() else "")
                        + "# Env files hold secrets (baton)\n.env\n.env.*\n"
                        + "".join(f"!{n}\n" for n in sorted(ENV_OK)))
            rep.fixed("env files added to .gitignore")
        else:
            rep.fail("env files (.env) not in .gitignore")
    else:
        rep.ok("env files are gitignored")
    wt = root.parent / ".worktrees" / root.name
    if not wt.exists():
        if fix:
            wt.mkdir(parents=True, exist_ok=True)
            rep.fixed(f"worktree folder created: {wt}")
        else:
            rep.warn(f"worktree folder missing: {wt}")
    else:
        rep.ok(f"worktree folder: {wt}")


def standards_rules(path: Path) -> list[str]:
    """Rule lines in CODING_STANDARDS.md: bullets outside comments."""
    text = re.sub(r"<!--.*?-->", "", path.read_text(), flags=re.S) if path.exists() else ""
    return [l for l in text.splitlines() if re.match(r"^\s*[-*]\s+\S", l)]


def check_small_fixes(root: Path, rep: Report):
    """Quick tickets land on the standing Small fixes spec's branch; setup files it with `ticket.py small-fixes`."""
    pj = root / "docs/agents/project.json"
    cfg = json.loads(pj.read_text()) if pj.exists() else {}
    if isinstance(cfg.get("small_fixes_spec"), int):
        rep.ok(f"Small fixes spec is #{cfg['small_fixes_spec']}")
    else:
        rep.warn("small_fixes_spec not set: run `python3 tools/agents/ticket.py small-fixes` (as the orchestrator) "
                 "to file the standing Small fixes spec and its branch, then commit project.json")


def opencode_recorded(root: Path) -> bool:
    """Has the Harness locations section of project.md got an `OpenCode:` entry (or "OpenCode: not used")?"""
    f = root / "docs/agents/project.md"
    if not f.exists():
        return False
    text = re.sub(r"<!--.*?-->", "", f.read_text(), flags=re.S)
    m = re.search(r"^##\s+Harness locations\s*$(.*?)(?=^##\s|\Z)", text, re.M | re.S)
    return bool(m and re.search(r"^\s*(?:[-*]\s*)?OpenCode\s*:\s*\S", m.group(1), re.M | re.I))


def opencode_glob(pattern: str, text: str) -> bool:
    """OpenCode's `*`: any characters, `/` included; a pattern ending in ` *` also matches the bare command."""
    rx = lambda s: "".join(".*" if c == "*" else re.escape(c) for c in s)
    if pattern.endswith(" *"):
        return re.fullmatch(rx(pattern[:-2]) + "(?: .*)?", text, re.S) is not None
    return re.fullmatch(rx(pattern), text, re.S) is not None


def opencode_effect(rules: list[dict], command: str, default: str = "ask") -> str:
    """OpenCode's effect for a shell command: `*` matches anything (`/` too), a pattern ending in ` *` also
    matches the bare command, the last matching rule wins, and no match asks."""
    effect = default
    for p in rules:
        if opencode_glob(str(p.get("action", "")), "shell") and opencode_glob(str(p.get("resource", "")), command):
            effect = str(p.get("effect", "ask"))
    return effect


SETUP_SAMPLES = ["python3 tools/agents/setup.py sync --master /x", "python3 /home/u/.agents/skills/bt-setup/home.py",
                 'python3 "/home/u/.agents/skills/bt-setup/home.py"']


OPENCODE_SHARED = [Path("/etc/opencode/opencode.json"), Path("/etc/opencode/opencode.jsonc")]

CHECK_SAMPLE = "python3 tools/agents/setup.py check --quick"
GH_SAMPLE = "gh issue view 1"


def opencode_allowlist(root: Path) -> list[dict] | None:
    """The project's OpenCode permission rules when its shell is allowlisted (a broad deny), else None."""
    try:
        perms = json.loads((root / "opencode.json").read_text()).get("permissions", [])
    except (OSError, ValueError, AttributeError):
        return None
    if not isinstance(perms, list):
        return None
    rules = [p for p in perms if isinstance(p, dict)]
    denied = any(opencode_glob(str(p.get("action", "")), "shell") and p.get("effect") == "deny" for p in rules)
    return rules if denied else None


def check_opencode_gh_reads(root: Path, rep: Report):
    """Agents see tickets and PRs through `gh`; the gh guard on PATH refuses the writes the contract doesn't allow."""
    rules = opencode_allowlist(root)
    if rules is not None and opencode_effect(rules, GH_SAMPLE, "") != "allow":
        rep.warn('opencode.json "permissions" do not allow `gh` reads, so agents can\'t see tickets or PRs: add '
                 '{"action": "shell", "resource": "gh *", "effect": "allow"} after the broad deny, in a setup PR '
                 "(the gh guard on PATH still refuses every gh write the contract doesn't allow; harnesses/opencode.md, Permission allowlist)")


def check_opencode_shell_bypass(root: Path, rep: Report, shared: list[Path] | None = None):
    """A project that allowlists OpenCode's shell must also deny Serena's tools, whose shell bypasses that list.
    Serena may come from the managed or global config, so those are read too."""
    proj = root / "opencode.json"
    rules = opencode_allowlist(root)
    if rules is None:
        return
    if any(opencode_effect(rules, c) == "deny" for c in SETUP_SAMPLES):
        rep.warn('opencode.json "permissions" deny setup\'s commands, so the owner can\'t approve an update: add '
                 '{"action": "shell", "resource": "python3 tools/agents/setup.py *", "effect": "ask"} and '
                 '{"action": "shell", "resource": "python3 *bt-setup/home.py*", "effect": "ask"} after the broad deny, '
                 "before the setup.py check allow, in a setup PR (harnesses/opencode.md, Permission allowlist)")
    elif opencode_effect(rules, CHECK_SAMPLE, "") in ("deny", "ask"):
        rep.warn('opencode.json "permissions" do not allow `setup.py check` (a headless run rejects an ask): put the '
                 '{"action": "shell", "resource": "python3 tools/agents/setup.py check *", "effect": "allow"} rule '
                 "after the setup.py * ask rule, in a setup PR (harnesses/opencode.md, Permission allowlist)")
    files = [proj] + (OPENCODE_SHARED if shared is None else shared) + [
        Path.home() / ".config/opencode/opencode.json", Path.home() / ".config/opencode/opencode.jsonc"]
    serena = False
    for f in files:
        try:
            m = json.loads(f.read_text()).get("mcp", {})
            servers = m.get("servers", m) if isinstance(m, dict) else {}
            serena |= isinstance(servers, dict) and any(str(k).lower() == "serena" for k in servers)
        except (OSError, ValueError, AttributeError):
            continue
    if not serena:
        return
    if any(str(p.get("action", "")).startswith("serena") and p.get("effect") == "deny" for p in rules):
        rep.ok("OpenCode denies Serena's tools (its shell would bypass the shell allowlist)")
    else:
        rep.fail('Serena is configured for OpenCode and its shell bypasses the shell allowlist: add '
                 '{"action": "serena_*", "resource": "*", "effect": "deny"} to opencode.json "permissions" '
                 "(harnesses/opencode.md, Serena), in a setup PR")


HOOKS = "tools/agents/hooks"


def ensure_hooks(root: Path, rep: Report, fix: bool):
    """Git hooks (branch rules, Refs #n, key scan) via core.hooksPath, unless another hook manager has the repo."""
    _, path = run(["git", "config", "--get", "core.hooksPath"], cwd=root)
    code, hooks_dir = run(["git", "rev-parse", "--path-format=absolute", "--git-path", "hooks"], cwd=root)
    own = Path(hooks_dir) if code == 0 else None
    existing = [f for f in own.iterdir() if f.is_file() and f.suffix != ".sample"] if own and own.is_dir() else []
    if path == HOOKS:
        rep.ok(f"git hooks enabled (core.hooksPath={HOOKS})")
    elif path or existing:
        rep.warn(f"another hook manager owns git hooks ({path or hooks_dir}); call {HOOKS}/pre-push, "
                 "pre-commit and prepare-commit-msg from it")
    elif fix:
        run(["git", "config", "core.hooksPath", HOOKS], cwd=root)
        rep.fixed(f"git hooks enabled (core.hooksPath={HOOKS})")
    else:
        rep.fail("git hooks not enabled; run setup.py check --fix")


GUARD_DIR = "tools/agents/guard"
LOCAL_SETTINGS = ".claude/settings.local.json"


def is_guard_shim(path: str | None) -> bool:
    """Is this resolved `gh` Baton's guard shim (tools/agents/guard/gh in any checkout)?"""
    return bool(path) and Path(path).resolve().parts[-4:] == tuple(GUARD_DIR.split("/")) + ("gh",)


def is_git_guard_shim(path: str | None) -> bool:
    """Is this resolved `git` Baton's guard shim (tools/agents/guard/git in any checkout)?"""
    return bool(path) and Path(path).resolve().parts[-4:] == tuple(GUARD_DIR.split("/")) + ("git",)


def guard_seen(root: Path, route: str) -> bool:
    """Did the guard run by `route` ("hook" or "path") in this repo? The marker is an empty file in
    the git common dir, written by guard/gh and guard/git (keep the name in sync: a test checks)."""
    code, common = run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=root)
    return code == 0 and (Path(common) / f"baton-guard-seen-{route}").exists()


def local_path_set(root: Path) -> bool:
    """Does .claude/settings.local.json already start env.PATH with the guard folder?"""
    try:
        env = json.loads((root / LOCAL_SETTINGS).read_text()).get("env", {})
        return str(env.get("PATH", "")).split(os.pathsep)[0] == str(root / GUARD_DIR)
    except (OSError, ValueError, AttributeError):
        return False


def ensure_claude_path(root: Path, rep: Report, fix: bool):
    """Put tools/agents/guard first on PATH for Claude Code's Bash tool with no hooks: `env.PATH` in
    .claude/settings.local.json (read by the CLI and the VS Code extension alike, kept out of git).
    The value is literal, so re-run `check --fix` if PATH changes."""
    guard_dir = str(root / GUARD_DIR)
    f = root / LOCAL_SETTINGS
    try:
        cfg = json.loads(f.read_text()) if f.exists() else {}
        env = cfg.setdefault("env", {})
    except (ValueError, AttributeError):
        rep.warn(f"{LOCAL_SETTINGS} isn't a JSON object; add env.PATH starting with {guard_dir} by hand")
        return
    if local_path_set(root):
        rep.ok(f"Claude Code: {LOCAL_SETTINGS} puts the gh/git guard first on PATH")
    elif fix:
        rest = [d for d in os.environ.get("PATH", "").split(os.pathsep)
                if d and not is_guard_shim(str(Path(d) / "gh")) and not is_git_guard_shim(str(Path(d) / "git"))]
        env["PATH"] = os.pathsep.join([guard_dir] + rest)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(cfg, indent=2) + "\n")
        gi = root / ".gitignore"
        lines = gi.read_text().splitlines() if gi.exists() else []
        if LOCAL_SETTINGS not in lines:
            with gi.open("a") as g:
                g.write(("\n" if lines and lines[-1].strip() else "") + f"# Machine-local Claude Code settings (baton)\n{LOCAL_SETTINGS}\n")
        rep.fixed(f"{LOCAL_SETTINGS}: env.PATH starts with the gh/git guard (restart Claude Code to apply)")


def check_guard(root: Path, rep: Report, harness: str | None, fix: bool):
    """The gh and git guards are detected, not assumed: OK if each tool on this PATH is its shim (any
    harness), else OK if Claude Code's PreToolUse hook has left its marker, else WARN/Fail with the way to
    put the shim folder on PATH."""
    which = shutil.which("gh")
    guard = (root / GUARD_DIR / "gh").resolve()
    if fix:
        ensure_claude_path(root, rep, fix=True)
    if is_guard_shim(which):
        rep.ok(f"gh guard is first on PATH in this shell (gh is {which})")
    elif harness and harness != "Claude Code":
        rep.fail(f"{harness}: gh guard not first on PATH (gh is {which}); put {guard.parent} first "
                 "and record how in docs/agents/project.md")
    elif guard_seen(root, "hook"):
        rep.ok("gh guard: the Claude Code PreToolUse hook has run in this repo")
    elif local_path_set(root):
        rep.warn(f"gh guard not active in this session yet: {LOCAL_SETTINGS} puts it first on PATH, but gh is "
                 f"{which} here. Restart Claude Code from this project (the setting is read at launch)")
    else:
        rep.warn(f"gh guard not seen (gh is {which}; no PreToolUse hook run recorded), possibly because hooks "
                 f"are blocked by policy. Put the shim first on PATH: for Claude Code (CLI and VS Code "
                 f"extension) run `python3 tools/agents/setup.py check --fix`, which sets env.PATH in "
                 f"{LOCAL_SETTINGS}, then restart it; or start the CLI with "
                 f"`PATH=\"{guard.parent}:$PATH\" claude`. Other harnesses: put {guard.parent} first on "
                 "their PATH and record how in docs/agents/project.md")
    git_which = shutil.which("git")
    git_guard = (root / GUARD_DIR / "git").resolve()
    if is_git_guard_shim(git_which):
        rep.ok(f"git guard is first on PATH in this shell (git is {git_which})")
    elif harness and harness != "Claude Code":
        rep.fail(f"{harness}: git guard not first on PATH (git is {git_which}); put {git_guard.parent} first "
                 "and record how in docs/agents/project.md")
    elif guard_seen(root, "hook"):
        rep.ok("git guard: the Claude Code PreToolUse hook has run in this repo")
    elif local_path_set(root):
        rep.warn(f"git guard not active in this session yet: {LOCAL_SETTINGS} puts it first on PATH, but git is "
                 f"{git_which} here. Restart Claude Code from this project (the setting is read at launch)")
    else:
        rep.warn(f"git guard not seen (git is {git_which}; no PreToolUse hook run recorded), possibly because hooks "
                 f"are blocked by policy. Put the shim first on PATH: for Claude Code (CLI and VS Code "
                 f"extension) run `python3 tools/agents/setup.py check --fix`, which sets env.PATH in "
                 f"{LOCAL_SETTINGS}, then restart it; or start the CLI with "
                 f"`PATH=\"{git_guard.parent}:$PATH\" claude`. Other harnesses: put {git_guard.parent} first on "
                 "their PATH and record how in docs/agents/project.md")


# --------------------------------------------------------------------------
# stronger gh checks, harness commands, extras (contract 5.0)
# --------------------------------------------------------------------------

WRITE_PERMS = {"WRITE", "MAINTAIN", "ADMIN"}
DRY_RUN_REF = "refs/heads/baton-setup-dry-run"
CONTEXT7_ENV = "CONTEXT7_API_KEY"   # the convention; unverified for Claude Code and OpenCode (see harnesses/)

# Optional extras. `roles` are the defaults; `lines` pair roles with the owner-approved session-start line
# (each triggered by a situation, never "always"). `tool` is the one tool the smoke test has the harness call.
# The method never depends on an extra, and no skill may require one. The design's table has no line for
# Playwright; its line below is the agreed rule (browser to explore, tests for proof) phrased as a trigger.
EXTRAS = {
    "RTK": {"roles": ["implementer"], "mcp": False, "binary": ["rtk", "--version"], "tool": None,
            "lines": [(["implementer"], "")]},
    "Serena": {"roles": ["implementer", "reviewer"], "mcp": True, "binary": ["serena", "--help"],
               "tool": "get_current_config",
               "lines": [(["implementer", "reviewer"],
                          "Activate the project in Serena and use it for symbol search and edits.")]},
    "Context7": {"roles": ["orchestrator", "implementer"], "mcp": True, "binary": None, "tool": "resolve-library-id",
                 "lines": [(["orchestrator"],
                            "When a spec or research note names a library or API, check the current version's docs "
                            "with Context7 before writing it down (bt-to-spec, bt-research)."),
                           (["implementer"],
                            "Before calling a library API not already used the same way in this codebase, or when an "
                            "error suggests the API changed or doesn't exist, look it up in Context7.")]},
    "DeepWiki": {"roles": ["orchestrator"], "mcp": True, "binary": None, "tool": "read_wiki_structure",
                 "lines": [(["orchestrator"],
                            "When researching or comparing an external library or project, ask DeepWiki before "
                            "reading its source.")]},
    "Playwright": {"roles": ["implementer", "reviewer"], "mcp": True, "binary": None, "tool": "browser_navigate",
                   "lines": [(["implementer", "reviewer"],
                              "When checking a web or UI change, use the browser to explore and debug; proof is a "
                              "Playwright test in the verify command, and a manual click-through is never evidence.")]},
}


def _gh_json(root: Path, args: list[str]):
    code, text = run(args, cwd=root)
    if code != 0:
        return None, text
    try:
        return json.loads(text), text
    except ValueError:
        return text, text


def gh_repo_checks(root: Path) -> dict[str, tuple[str, str]]:
    """Name -> (status, detail), status "ok", "fail" or "skip". Reads only: viewerPermission is WRITE,
    MAINTAIN or ADMIN; issues enabled; labels can be created (the API's `permissions.push`, not an actual
    create); `git push --dry-run` works."""
    out: dict[str, tuple[str, str]] = {}
    info, raw = _gh_json(root, ["gh", "repo", "view", "--json", "nameWithOwner,viewerPermission,hasIssuesEnabled"])
    if not isinstance(info, dict):
        why = f"gh repo view failed: {raw[:120]}"
        for k in ("viewer_permission", "issues_enabled", "labels_creatable"):
            out[k] = ("fail", why)
    else:
        perm = info.get("viewerPermission")
        out["viewer_permission"] = (("ok" if perm in WRITE_PERMS else "fail"),
                                    f"viewerPermission is {perm} (needs WRITE, MAINTAIN or ADMIN)")
        enabled = info.get("hasIssuesEnabled") is True
        out["issues_enabled"] = (("ok" if enabled else "fail"), "issues are " + ("enabled" if enabled else "not enabled"))
        code, push = run(["gh", "api", f"repos/{info.get('nameWithOwner', '')}", "--jq", ".permissions.push"], cwd=root)
        out["labels_creatable"] = (("ok" if code == 0 and push.strip() == "true" else "fail"),
                                   "label creation needs push permission: " + (push.strip()[:80] or "no answer"))
    code, _ = run(["git", "rev-parse", "--verify", "-q", "HEAD"], cwd=root)
    if code != 0:
        out["push_dry_run"] = ("skip", "no commit yet, so `git push --dry-run` can't run")
    else:
        code, text = run(["git", "push", "--dry-run", "origin", f"HEAD:{DRY_RUN_REF}"], cwd=root)
        out["push_dry_run"] = (("ok" if code == 0 else "fail"), f"git push --dry-run: {text[:120]}" if code else "works")
    return out


GH_CHECK_TEXT = {"viewer_permission": "gh viewer has write permission", "issues_enabled": "issues are enabled",
                 "labels_creatable": "labels can be created", "push_dry_run": "git push --dry-run works"}


def report_gh_checks(rep: Report, results: dict[str, tuple[str, str]]):
    for name, (status, detail) in results.items():
        text = GH_CHECK_TEXT.get(name, name)
        if status == "ok":
            rep.ok(text)
        elif status == "skip":
            rep.warn(f"{text}: skipped ({detail})")
        else:
            rep.fail(f"{text}: {detail}")


def harness_commands(root: Path) -> dict:
    pj = root / "docs/agents/project.json"
    try:
        cfg = json.loads(pj.read_text()).get("harness_commands") or {}
    except (OSError, ValueError, AttributeError):
        return {}
    return cfg if isinstance(cfg, dict) else {}


def roles_config(root: Path) -> dict:
    pj = root / "docs/agents/project.json"
    try:
        cfg = json.loads(pj.read_text()).get("roles") or {}
    except (OSError, ValueError, AttributeError):
        return {}
    return cfg if isinstance(cfg, dict) else {}


def roles_line(root: Path) -> str:
    """The one line every session sees: which models are in use, and at what effort."""
    roles = roles_config(root)
    parts = [f"{name} {r.get('model', '?')} (effort {r.get('effort', '?')}, {r.get('harness', '?')})"
             for name in ROLE_NAMES if isinstance(r := roles.get(name), dict)]
    return "[agents] Roles: " + ("; ".join(parts) if parts else "not set; run the setup session")


def check_roles(root: Path, rep: Report):
    """Warn about an unusable role table: it is the owner's record of which models run Baton."""
    roles, cmds = roles_config(root), harness_commands(root)
    for name in ROLE_NAMES:
        role = roles.get(name)
        if role is None:
            continue
        if not isinstance(role, dict):
            rep.warn(f"roles.{name} must be an object with model and effort")
            continue
        for field in ("model", "effort"):
            if not role.get(field):
                rep.warn(f"roles.{name} needs {field} (set it in docs/agents/project.json)")
        args = role.get("model_args")
        if args is not None and (not isinstance(args, list) or not all(isinstance(x, str) for x in args)):
            rep.warn(f"roles.{name}.model_args must be a list of strings")
        if name == "implementer" and role.get("hard") is not None:
            hard = role["hard"]
            if not isinstance(hard, dict):
                rep.warn("roles.implementer.hard must be an object with model and effort")
            else:
                for field in ("model", "effort"):
                    if not hard.get(field):
                        rep.warn(f"roles.implementer.hard needs {field}")
                hargs = hard.get("model_args")
                if hargs is not None and (not isinstance(hargs, list) or not all(isinstance(x, str) for x in hargs)):
                    rep.warn("roles.implementer.hard.model_args must be a list of strings")
        agent_file = role.get("agent_file")
        if agent_file and not (root / agent_file).exists():
            rep.warn(f"roles.{name}.agent_file '{agent_file}' doesn't exist")
    impl = roles.get("implementer") or {}
    if not isinstance(impl, dict):
        return
    harness = impl.get("harness") or ""
    # A shared harness is no excuse: the relay still needs its own headless command.
    if cmds and harness not in cmds:
        rep.warn(f"roles.implementer.harness '{harness}' isn't a key of harness_commands; add one, "
                 "since the relay needs a headless command for it")


def newest_match(pattern: str) -> str:
    """A binary path with a glob (`~/.vscode-server/extensions/anthropic.claude-code-*/.../claude`) → the
    match with the highest version, comparing digit runs as numbers (2.1.330 beats 2.1.99). No glob, or no
    match: the pattern unchanged, so the caller's "not found" names it. Versioned extension folders change
    on every update, so a pinned path breaks; a glob keeps working."""
    if not any(ch in pattern for ch in "*?["):
        return pattern
    key = lambda p: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p)]
    matches = sorted(glob.glob(os.path.expanduser(pattern)), key=key)
    return matches[-1] if matches else pattern


def command_words(template) -> list[str]:
    """The words of a harness_commands entry: a list, or a string split like a shell line. One rule for
    relay.py and the smoke test: it must carry a `{prompt}` or `{prompt_file}` placeholder (ValueError says why).
    The first word may be a glob; it resolves to the newest match (`newest_match`)."""
    words = list(template) if isinstance(template, list) else (shlex.split(template) if isinstance(template, str) else [])
    if not words or not all(isinstance(w, str) for w in words):
        raise ValueError("must be a command string, or a non-empty list of strings")
    if not any("{prompt}" in w or "{prompt_file}" in w for w in words):
        raise ValueError("needs a {prompt} or {prompt_file} placeholder")
    return [newest_match(words[0]), *words[1:]]


def build_command(template, prompt: str, prompt_file: str = "", model_args: list[str] | None = None) -> list[str]:
    """argv from a harness_commands entry: `{prompt}` and `{prompt_file}` are replaced inside each word, and a
    whole `{model_args}` word expands to the role's argv words (possibly none)."""
    argv = []
    for w in command_words(template):
        if w == "{model_args}":
            argv.extend(model_args or [])
        else:
            argv.append(w.replace("{prompt_file}", prompt_file).replace("{prompt}", prompt))
    return argv


def check_harness_commands(root: Path, rep: Report):
    """Each harness's headless binary resolves (Claude Code installed only as the VS Code extension has no
    `claude` on PATH: record the bundled binary's path, or install the CLI)."""
    for name, tpl in harness_commands(root).items():
        try:
            words = command_words(tpl)
        except ValueError as e:
            rep.fail(f"harness_commands[{name}] {e}")
            continue
        if shutil.which(words[0]):
            rep.ok(f"{name}: headless binary {words[0]} resolves")
        else:
            rep.fail(f"{name}: headless binary {words[0]} not found. For Claude Code installed only as the VS Code "
                     "extension, put the bundled binary's path in harness_commands with `*` for the version folder "
                     "(see harnesses/claude-code.md) or install the CLI")
            continue
        raw = tpl[0] if isinstance(tpl, list) else shlex.split(tpl)[0]
        if re.search(r"[-/]\d+\.\d+\.\d+[-/]", raw) and not any(ch in raw for ch in "*?["):
            rep.warn(f"{name}: {raw} pins a versioned folder, which an update removes; put `*` for the version")


def parse_extras(text: str) -> list[dict]:
    """The Extras section of project.md: `- <Extra> [role, role]: <line>` (a line of "none" or empty means the
    extra has no session-start line). Comments don't count."""
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    m = re.search(r"^##\s+Extras\s*$(.*?)(?=^##\s|\Z)", text, re.M | re.S)
    out = []
    for l in (m.group(1).splitlines() if m else []):
        e = re.match(r"^\s*[-*]\s+([A-Za-z0-9 ._-]+?)\s*\[([^\]]*)\]\s*:\s*(.*?)\s*$", l)
        if e:
            line = e.group(3).strip().strip('"')
            out.append({"name": e.group(1), "roles": [r.strip() for r in e.group(2).split(",") if r.strip()],
                        "line": "" if line.lower().startswith("none") else line})
    return out


def extras_lines(root: Path, role: str) -> list[str]:
    """Session-start lines for `role`, from project.md's Extras section."""
    f = root / "docs/agents/project.md"
    return [e["line"] for e in parse_extras(f.read_text() if f.exists() else "")
            if role in e["roles"] and e["line"]]


def chosen_extras(root: Path) -> dict:
    pj = root / "docs/agents/project.json"
    try:
        ex = json.loads(pj.read_text()).get("extras") or {}
    except (OSError, ValueError, AttributeError):
        return {}
    return ex if isinstance(ex, dict) else {}


def extras_section(chosen: dict) -> str:
    lines = []
    for name, roles in chosen.items():
        spec = EXTRAS.get(name)
        if not spec:
            continue
        for line_roles, text in spec["lines"]:
            got = [r for r in line_roles if r in roles]
            if got:
                lines.append(f"- {name} [{', '.join(got)}]: " + (text or "none (applies automatically once installed)"))
    return "\n".join(lines)


def set_section(text: str, heading: str, body: str, before: str = "Project-specific rules") -> str:
    """Replace the body of `## heading` (keeping its comments), or add the section before `## before`."""
    m = re.search(rf"^##\s+{re.escape(heading)}\s*$(.*?)(?=^##\s|\Z)", text, re.M | re.S)
    if m:
        comments = "".join(c + "\n\n" for c in re.findall(r"<!--.*?-->", m.group(1), flags=re.S))
        new = f"## {heading}\n\n{comments}" + (body.strip() + "\n\n" if body.strip() else "")
        return text[:m.start()] + new + text[m.end():]
    block = f"## {heading}\n\n" + (body.strip() + "\n\n" if body.strip() else "")
    i = re.search(rf"^##\s+{re.escape(before)}\s*$", text, re.M)
    return text[:i.start()] + block + text[i.start():] if i else text.rstrip("\n") + "\n\n" + block


def cmd_extras(a) -> int:
    root = find_project_root()
    pj = root / "docs/agents/project.json"
    cfg = json.loads(pj.read_text())
    chosen = dict(cfg.get("extras") or {})
    if a.action == "list":
        for name, spec in EXTRAS.items():
            print(f"{name}: default roles {', '.join(spec['roles'])}; "
                  + (f"enabled for {', '.join(chosen[name])}" if name in chosen else "not enabled"))
        return 0
    if a.name not in EXTRAS:
        sys.exit(f"unknown extra {a.name}; choose from {', '.join(EXTRAS)}")
    if a.action == "enable":
        chosen[a.name] = [r.strip() for r in a.roles.split(",")] if a.roles else EXTRAS[a.name]["roles"]
    else:
        chosen.pop(a.name, None)
    cfg["extras"] = chosen
    pj.write_text(json.dumps(cfg, indent=2) + "\n")
    md = root / "docs/agents/project.md"
    md.write_text(set_section(md.read_text(), "Extras", extras_section(chosen)))
    print(f"{a.action}d {a.name}" + (f" for {', '.join(chosen[a.name])}" if a.name in chosen else "")
          + ". Project-scope config only: add the server to the project's .mcp.json (Claude Code) or "
            "opencode.json (OpenCode), as harnesses/<harness>.md says; never install globally without the owner's OK.")
    return 0


# --------------------------------------------------------------------------
# CI: a remote verify run on every PR (contract 6.3)
# --------------------------------------------------------------------------

VERIFY_WORKFLOW = ".github/workflows/verify.yml"
VERIFY_EXAMPLE = VERIFY_WORKFLOW + ".example"


def ci_indent(text: str, spaces: int) -> str:
    """Indent a block so a --setup-step or the verify command is valid YAML under its parent key."""
    pad = " " * spaces
    return "\n".join(pad + line if line.strip() else line for line in text.splitlines())


def cmd_ci(a, root: Path | None = None) -> int:
    """Write the verify workflow from the template, recording the setup steps in project.json."""
    if not a.write:
        sys.exit("use `python3 tools/agents/setup.py ci --write` to write the verify workflow")
    root = root or find_project_root()
    src = root / VERIFY_EXAMPLE
    if not src.exists():
        sys.exit(f"{VERIFY_EXAMPLE} missing; run `python3 tools/agents/setup.py sync`")
    pj = root / "docs/agents/project.json"
    cfg = json.loads(pj.read_text())
    verify = (a.verify or cfg.get("verify_command") or "").strip()
    if not verify:
        sys.exit("set verify_command in docs/agents/project.json; `ci --write` needs it (or pass --verify)")
    steps = list(a.setup_step or [])
    text = src.read_text()
    setup_yaml = ci_indent("\n".join(steps), 6) if steps else "      # No language setup steps; add them with --setup-step and re-run."
    text = text.replace("{{SETUP_STEPS}}", setup_yaml).replace("{{VERIFY}}", ci_indent(verify, 8))
    dst = root / VERIFY_WORKFLOW
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(text)
    cfg["ci_setup_steps"] = steps
    pj.write_text(json.dumps(cfg, indent=2) + "\n")
    print(f"Wrote {VERIFY_WORKFLOW} with {len(steps)} setup step(s); commit it and push so PRs get a verify run.")
    return 0


def mcp_servers_in(root: Path, harness: str) -> set[str] | None:
    """Lower-cased names of the MCP servers enabled in the project-scope config of `harness`, or None if
    that harness's config location isn't known here."""
    h = harness.lower().replace(" ", "")
    if h == "claudecode":
        files, pick = [root / ".mcp.json"], lambda d: d.get("mcpServers", {})
    elif h == "opencode":
        files = [root / "opencode.json", root / "opencode.jsonc", root / ".opencode/opencode.json"]

        def pick(d):
            m = d.get("mcp", {})
            return m.get("servers", m) if isinstance(m, dict) else {}
    else:
        return None
    found: set[str] = set()
    for f in files:
        try:
            servers = pick(json.loads(f.read_text()))
            found |= {str(k).lower() for k in servers} if isinstance(servers, dict) else set()
        except (OSError, ValueError, AttributeError):
            continue
    return found


def check_extras(root: Path, rep: Report):
    """Chosen extras are listed in project.md Extras; Context7's key variable is set (never its value)."""
    chosen = chosen_extras(root)
    md = root / "docs/agents/project.md"
    listed = {e["name"] for e in parse_extras(md.read_text() if md.exists() else "")}
    for name in chosen:
        if name not in EXTRAS:
            rep.warn(f"project.json extras names {name}, which this contract doesn't know")
        elif name not in listed:
            rep.warn(f"extra {name} is enabled in project.json but missing from project.md Extras "
                     f"(run `setup.py extras enable {name}`)")
        else:
            rep.ok(f"extra {name} listed in project.md Extras")
    if "Context7" in chosen:
        if os.environ.get(CONTEXT7_ENV):
            rep.ok(f"Context7 key: {CONTEXT7_ENV} is set (value not read out)")
        else:
            rep.warn(f"Context7 key: {CONTEXT7_ENV} is not set. The key is optional but recommended; put it in a "
                     "user-level environment outside the repo (the variable name is unverified: see harnesses/)")


# --------------------------------------------------------------------------
# smoke test
# --------------------------------------------------------------------------

PROBE_NAMES = ["guard_on_path", "gh_read", "guarded_write_refused", "signature_set",
               "viewer_permission", "issues_enabled", "labels_creatable", "push_dry_run",
               "git_guard_on_path", "git_write_refused"]


def probe_results(root: Path, expect_sig: str = "") -> dict[str, tuple[str, str]]:
    """Run inside a harness's shell by `check --probe`: everything the smoke test needs from there. Writes
    nothing to GitHub: each guarded write is only tried when its tool is the guard, which refuses it first."""
    out: dict[str, tuple[str, str]] = {}
    which = shutil.which("gh")
    guard = is_guard_shim(which)
    out["guard_on_path"] = (("ok" if guard else "fail"), f"gh resolves to {which}")
    code, text = run(["gh", "repo", "view", "--json", "nameWithOwner"], cwd=root)
    out["gh_read"] = (("ok" if code == 0 and "nameWithOwner" in text else "fail"),
                      "gh read reached the repo" if code == 0 else f"gh read failed: {text[:100]}")
    if guard:
        code, text = run(["gh", "issue", "close", "999999999"], cwd=root)   # no such issue; refused anyway
        refused = code != 0 and "gh guard: refused" in text
        out["guarded_write_refused"] = (("ok" if refused else "fail"), "the guard refused a write" if refused
                                        else f"a guarded write was not refused by the guard: {text[:100]}")
    else:
        out["guarded_write_refused"] = ("fail", "not tried: gh is not the guard here")
    git_which = shutil.which("git")
    git_guard = is_git_guard_shim(git_which)
    out["git_guard_on_path"] = (("ok" if git_guard else "fail"), f"git resolves to {git_which}")
    if git_guard:
        code, text = run(["git", "commit", "--no-verify"], cwd=root)
        refused = code != 0 and "git guard: refused" in text
        out["git_write_refused"] = (("ok" if refused else "fail"), "the git guard refused a skipped hook" if refused
                                    else f"a git commit --no-verify was not refused by the guard: {text[:100]}")
    else:
        out["git_write_refused"] = ("fail", "not tried: git is not the guard here")
    sig = os.environ.get("AGENT_SIGNATURE", "")
    good = bool(sig) and (not expect_sig or sig == expect_sig)
    out["signature_set"] = (("ok" if good else "fail"),
                            "AGENT_SIGNATURE is set" if good else "AGENT_SIGNATURE is " + ("different" if sig else "not set"))
    out.update(gh_repo_checks(root))
    return out


def cmd_probe(a, root: Path) -> int:
    res = probe_results(root, a.expect_signature or "")
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(res, indent=2) + "\n")
    rep = Report()
    for name, (status, detail) in res.items():
        (rep.ok if status == "ok" else rep.fail)(f"{name}: {detail}")
    rep.print("Harness probe")
    return 1 if rep.failed else 0


def last_line(text: str) -> str:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    return lines[-1] if lines else ""


def smoke_prompt(root: Path, harness: str, sig: str, workdir: Path, verify: str, extras: list[str]) -> str:
    probe = f"python3 tools/agents/setup.py check --probe --expect-signature {shlex.quote(sig)} --out {shlex.quote(str(workdir / 'probe.json'))}"
    steps = [f"1. Run exactly: {probe}",
             "2. Run exactly: python3 tools/agents/ticket.py --help",
             f"3. Run exactly: touch {shlex.quote(str(workdir / 'outside.marker'))}   It is meant to be refused by "
             "your permission settings. If it is refused, do not retry it or work around it; carry on."]
    n = 4
    if verify:
        steps.append(f"{n}. Run exactly: {verify}   Then print one line, `SMOKE-VERIFY: ` followed by the last "
                     "line of its output, copied verbatim.")
        n += 1
    for name in extras:
        tool = EXTRAS[name]["tool"]
        if tool:
            steps.append(f"{n}. Call one {name} tool ({tool}, or any tool of that server if it has another name), then "
                         f"print `SMOKE-EXTRA {name}: ok`, or `SMOKE-EXTRA {name}: failed` with the reason.")
            n += 1
    return (f"Baton smoke test for {harness}. This is a trivial job to check the setup: change no files, post nothing "
            "to GitHub, and do only these steps in order.\n" + "\n".join(steps) + "\nThen stop.")


def smoke_extras(root: Path, harness: str, output: str, verify_tail: str, verify: str) -> dict[str, tuple[str, str]]:
    """Check every enabled extra, even if it was already installed: its binary or tool call, its project-scope
    config, and (RTK) that the verify command's evidence is unfiltered."""
    res: dict[str, tuple[str, str]] = {}
    servers = None
    for name, roles in chosen_extras(root).items():
        spec = EXTRAS.get(name)
        if not spec:
            res[f"extra {name}"] = ("fail", "unknown extra")
            continue
        if spec["binary"]:
            code, text = run(spec["binary"], cwd=root)
            res[f"extra {name} binary"] = (("ok" if code == 0 else "fail"),
                                           f"`{' '.join(spec['binary'])}` " + ("runs" if code == 0 else f"failed: {text[:80]}"))
        if spec["mcp"]:
            servers = mcp_servers_in(root, harness)
            if servers is None:
                res[f"extra {name} project config"] = ("skip", f"{harness}'s project-scope config location isn't known to setup.py")
            else:
                res[f"extra {name} project config"] = (("ok" if name.lower() in servers else "fail"),
                                                      f"{name} " + ("is" if name.lower() in servers else "is not") + " enabled in the project-scope config")
            m = re.search(rf"SMOKE-EXTRA {re.escape(name)}:\s*(.*)", output)
            ok = bool(m) and m.group(1).strip().lower().startswith("ok")
            res[f"extra {name} tool call"] = (("ok" if ok else "fail"),
                                              f"{name} tool answered" if ok else
                                              ("no SMOKE-EXTRA line" if not m else m.group(1).strip()[:100]))
        if name == "RTK":
            m = re.search(r"SMOKE-VERIFY:\s*(.*)", output)
            if not verify:
                res["extra RTK evidence"] = ("skip", "no verify_command to compare")
            elif not m:
                res["extra RTK evidence"] = ("fail", "the harness never reported the verify command's output")
            else:
                same = bool(verify_tail) and verify_tail in m.group(1)
                res["extra RTK evidence"] = (("ok" if same else "fail"),
                                             "the verify command's last line came through unfiltered" if same
                                             else "RTK changed the verify command's output: evidence must come from unfiltered output")
    return res


def smoke_verified(root: Path, harness: str) -> bool:
    """Does project.md's Smoke test results hold a `- <Harness> verified ...` line (not FAILED) for this harness?"""
    md = root / "docs/agents/project.md"
    try:
        text = re.sub(r"<!--.*?-->", "", md.read_text(), flags=re.S)
    except OSError:
        return False
    m = re.search(r"^##\s+Smoke test results\s*$(.*?)(?=^##\s|\Z)", text, re.M | re.S)
    return any(re.match(rf"-\s+{re.escape(harness)}\s+verified\b", l.strip(), re.I)
               for l in (m.group(1).splitlines() if m else []))


def record_smoke(root: Path, harness: str, results: dict[str, tuple[str, str]], note: str):
    """Record the verified results in project.md's Smoke test results section, one line per harness."""
    md = root / "docs/agents/project.md"
    text = md.read_text()
    m = re.search(r"^##\s+Smoke test results\s*$(.*?)(?=^##\s|\Z)", re.sub(r"<!--.*?-->", "", text, flags=re.S), re.M | re.S)
    keep = [l for l in (m.group(1).splitlines() if m else [])
            if l.startswith("- ") and not l.startswith(f"- {harness} ")]
    passed = [k for k, (s, _) in results.items() if s == "ok"]
    failed = [k for k, (s, _) in results.items() if s == "fail"]
    state = "verified" if not failed else "FAILED"
    keep.append(f"- {harness} {state} {dt.date.today().isoformat()}: passed " + (", ".join(passed) or "nothing")
                + ("; failed " + ", ".join(failed) if failed else "") + (f"; {note}" if note else ""))
    md.write_text(set_section(text, "Smoke test results", "\n".join(keep)))


def cmd_smoke(a) -> int:
    root = find_project_root()
    harness = a.harness
    template = json.loads(a.command) if a.command and a.command.lstrip().startswith("[") else (a.command or harness_commands(root).get(harness))
    if not template:
        sys.exit(f"no headless command for {harness}: set harness_commands[{harness!r}] in docs/agents/project.json "
                 "(see harnesses/), or pass --command")
    cfg = json.loads((root / "docs/agents/project.json").read_text())
    verify = cfg.get("verify_command") or ""
    sig = "implementer#smoke"
    role_name = getattr(a, "role", "") or ""
    role = {}
    if role_name:
        role = roles_config(root).get(role_name)
        if not isinstance(role, dict):
            sys.exit(f"roles.{role_name} isn't set in docs/agents/project.json; set it in the setup session")
    model_args = role.get("model_args") or []
    if isinstance(model_args, str):
        model_args = shlex.split(model_args)
    workdir = root / ".work" / "smoke" / re.sub(r"\W+", "-", harness.lower())
    shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True)
    extras = [n for n in chosen_extras(root) if n in EXTRAS]
    plain_tail = ""
    if "RTK" in extras and verify:
        _, plain = run(["sh", "-c", verify], cwd=root)
        plain_tail = last_line(plain)
    prompt = smoke_prompt(root, harness, sig, workdir, verify, extras)
    pfile = workdir / "prompt.md"
    pfile.write_text(prompt + "\n")
    try:
        argv = build_command(template, prompt, str(pfile), model_args)
    except ValueError as e:
        sys.exit(f"harness_commands[{harness!r}] {e}")
    env = dict(os.environ, AGENT_SIGNATURE=sig, BATON_SMOKE_MARK=str(workdir / "ticket.marker"), PWD=str(root),
               PATH=os.pathsep.join([str(root / GUARD_DIR)] + [d for d in os.environ.get("PATH", "").split(os.pathsep) if d]))
    log = workdir / "run.log"
    results: dict[str, tuple[str, str]] = {}
    try:
        r = subprocess.run(argv, cwd=root, env=env, capture_output=True, text=True, timeout=a.timeout)
        code, out = r.returncode, (r.stdout or "") + (r.stderr or "")
    except FileNotFoundError as e:
        code, out = 127, str(e)
    except subprocess.TimeoutExpired:
        code, out = 124, f"timed out after {a.timeout}s"
    log.write_text(out)
    results["harness ran"] = (("ok" if code == 0 else "fail"), f"exit code {code}" + (" (success)" if code == 0 else ""))
    probe_file = workdir / "probe.json"
    try:
        probe = json.loads(probe_file.read_text())
    except (OSError, ValueError):
        probe = {}
    for name in PROBE_NAMES:
        status, detail = probe.get(name, ["fail", "the harness never ran the probe (check its permission allowlist)"])
        results[name.replace("_", " ")] = (status, detail)
    allowed = (workdir / "ticket.marker").exists()
    results["allowlist allows ticket.py"] = (("ok" if allowed else "fail"),
                                             "ticket.py ran under the allowlist" if allowed else "ticket.py never ran")
    ran_outside = (workdir / "outside.marker").exists()
    results["allowlist refuses outside commands"] = (
        ("fail" if ran_outside or not probe else "ok"),
        "a command outside the allowlist ran" if ran_outside else ("not judged: the harness did nothing" if not probe
                                                                    else "touch was refused"))
    if a.exit_probe:
        # Same environment as the main run (guard first, signature set), and bounded: a harness that
        # ignores the unknown flag would otherwise start a second full session.
        try:
            bad = subprocess.run(argv + ["--baton-smoke-invalid-flag"], cwd=root, env=env, capture_output=True,
                                 text=True, timeout=a.exit_probe_timeout).returncode
            results["exit code meaning"] = (("ok" if bad != 0 else "fail"),
                                            f"0 means success; an invalid flag exits {bad}" if bad != 0
                                            else "an invalid flag still exited 0")
        except subprocess.TimeoutExpired:
            results["exit code meaning"] = ("skip", f"not judged: the harness ignored an invalid flag and was still "
                                                    f"running after {a.exit_probe_timeout}s")
        except OSError as e:
            results["exit code meaning"] = ("skip", f"not judged: {e}")
    results["log location"] = (("ok" if log.exists() and log.stat().st_size else "fail"),
                               f"stdout and stderr are captured in {log.relative_to(root)}")
    results.update(smoke_extras(root, harness, out, plain_tail, verify))
    rep = Report()
    for name, (status, detail) in results.items():
        {"ok": rep.ok, "skip": rep.warn}.get(status, rep.fail)(f"{name}: {detail}")
    rep.print(f"Smoke test: {harness}")
    if not a.no_record:
        note = (f"role {role_name}, model {role.get('model', '?')}, effort {role.get('effort', '?')}"
                if role_name else "")
        record_smoke(root, harness, results, note)
    return 1 if any(s == "fail" for s, _ in results.values()) else 0


# --------------------------------------------------------------------------
# survey: what this machine has, before the setup session asks anything
# --------------------------------------------------------------------------

def os_release(path: str = "/etc/os-release") -> dict:
    try:
        text = Path(path).read_text()
    except OSError:
        return {}
    return {k: v.strip().strip('"') for k, _, v in (l.partition("=") for l in text.splitlines()) if k}


def install_hint(rel: dict, packages: dict[str, str]) -> str:
    """The install line for this platform's package manager; `packages` maps manager to command."""
    ids = {rel.get("ID", "")} | set(rel.get("ID_LIKE", "").split())
    if sys.platform == "darwin":
        mgr = "brew"
    elif "alpine" in ids:
        mgr = "apk"
    elif ids & {"debian", "ubuntu"}:
        mgr = "apt"
    elif ids & {"fedora", "rhel", "centos"}:
        mgr = "dnf"
    else:
        mgr = ""
    return packages.get(mgr) or packages.get("", "see its website")


def survey_items(os_release_path: str = "/etc/os-release") -> list[tuple[str, str, str]]:
    """(status, item, detail) for every requirement; read-only, installs nothing."""
    rel = os_release(os_release_path)
    home = Path(os.path.expanduser("~"))
    which = shutil.which
    out: list[tuple[str, str, str]] = []

    def item(ok, name, found, hint):
        out.append(("OK", name, found) if ok else ("MISSING", name, hint))

    def hint(**pk):
        return "install: " + install_hint(rel, {"apk": pk.get("apk", ""), "apt": pk.get("apt", ""),
                                                "brew": pk.get("brew", ""), "dnf": pk.get("dnf", ""),
                                                "": pk.get("other", "see its website")})

    v = sys.version_info
    item(v >= (3, 9), "Python 3", f"{v.major}.{v.minor}.{v.micro}", f"found {v.major}.{v.minor}; need 3.9 or newer")
    item(which("git"), "git", which("git") or "", hint(apk="apk add git", apt="apt install git", brew="brew install git", dnf="dnf install git"))
    gh = which("gh")
    if not gh:
        out.append(("MISSING", "gh", hint(apk="apk add github-cli", apt="apt install gh", brew="brew install gh",
                                          dnf="dnf install gh")))
    else:
        r = subprocess.run([gh, "auth", "status"], capture_output=True, text=True)
        out.append(("OK", "gh", f"{gh}, logged in") if r.returncode == 0
                   else ("WARN", "gh", "installed but not logged in; install: gh auth login"))
    musl = "alpine" in {rel.get("ID", "")} | set(rel.get("ID_LIKE", "").split()) or "musl" in rel.get("ID", "")
    libc = "musl" if musl else ("n/a (macOS)" if sys.platform == "darwin" else "glibc")
    out.append(("OK", "libc", f"{libc}{' (' + rel['PRETTY_NAME'] + ')' if rel.get('PRETTY_NAME') else ''}"))

    bundled = newest_match(str(home / ".vscode-server/extensions/anthropic.claude-code-*/resources/native-binary/claude"))
    claude = which("claude") or (bundled if os.path.exists(bundled) else None)
    item(claude, "claude (Claude Code)", str(claude), "install: see https://claude.com/claude-code")
    oc = which("opencode")
    if oc:
        wrap = Path(oc).parent / "opencode-bin"
        out.append(("OK", "opencode", f"{oc}" + (f" (a wrapper; the binary is {wrap})" if wrap.exists() else "")))
    else:
        out.append(("MISSING", "opencode", "install: see https://opencode.ai (only if it is the implementer harness)"))

    item(which("rtk"), "RTK extra (rtk)", which("rtk") or "", "install: see the RTK project's README (cargo or a release binary)")
    runner = which("serena") or which("uvx") or which("uv")
    item(runner, "Serena extra (serena or uv/uvx)", runner or "", hint(apk="apk add uv", apt="pipx install uv",
                                                                       brew="brew install uv", dnf="pipx install uv",
                                                                       other="pipx install uv"))
    out.append(("OK", "Context7 extra (CONTEXT7_API_KEY)", "is set") if os.environ.get("CONTEXT7_API_KEY")
               else ("WARN", "Context7 extra (CONTEXT7_API_KEY)", "not set; works with lower limits; "
                     "set it in your shell profile (never in the repo)"))
    out.append(("OK", "DeepWiki extra", "needs nothing"))

    node, npx = which("node"), which("npx")
    item(node and npx, "Playwright extra (node and npx)", f"{node}, {npx}",
         "missing " + " and ".join(n for n, f in (("node", node), ("npx", npx)) if not f) + "; "
         + hint(apk="apk add nodejs npm", apt="apt install nodejs npm", brew="brew install node", dnf="dnf install nodejs npm"))
    system = [b for b in ("chromium", "chromium-browser") if which(b)]
    if musl:
        if system:
            out.append(("OK", "Playwright extra (browser)", f"musl: use the system {system[0]}: pass "
                        f"--executable-path {which(system[0])} --headless --no-sandbox (--no-sandbox is needed as root; "
                        "Playwright's own downloads are glibc builds; verified on Alpine with Chromium 156)"))
        else:
            out.append(("MISSING", "Playwright extra (browser)", "musl: Playwright's downloaded browsers are glibc "
                        "builds and can't run; " + hint(apk="apk add chromium", other="install chromium")))
    else:
        cache = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
        roots = [Path(cache)] if cache else [home / ".cache/ms-playwright", home / "Library/Caches/ms-playwright"]
        pw = next((str(r) for r in roots if r.is_dir() and any(r.glob("chromium*"))), None)
        chrome = next((which(b) for b in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser") if which(b)), None)
        found = pw or chrome
        item(found, "Playwright extra (browser)", f"{found}", "no Playwright browser or system Chrome; install: "
             "npx playwright install chromium")
    return out


def cmd_survey(a) -> int:
    items = survey_items(a.os_release)
    for status, name, detail in items:
        print(f"  {status:<8} {name}: {detail}")
    missing = sum(1 for s, *_ in items if s == "MISSING")
    print(f"{missing} missing, {sum(1 for s, *_ in items if s == 'WARN')} to look at. Read-only: nothing was "
          "installed. Any install is machine-wide; ask the owner before running one.")
    return 0


def find_project_root() -> Path:
    here = Path.cwd().resolve()
    code, common = run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=here)
    if code != 0:
        sys.exit("Not inside a git repo")
    main_top = Path(common).resolve().parent
    return main_top


def cmd_check(a, root: Path | None = None) -> int:
    root = root or find_project_root()
    if getattr(a, "probe", False):
        return cmd_probe(a, root)
    rep = Report()
    here = Path.cwd().resolve()

    # 1. git
    code, top = run(["git", "rev-parse", "--show-toplevel"], cwd=here)
    if code == 0 and Path(top).resolve() == root:
        rep.ok("running at the repo's top level")
    elif code == 0 and Path(top).resolve().parent.parent == root.parent / ".worktrees":
        rep.ok(f"running in a worktree of {root.name}")
    elif code == 0:
        rep.warn(f"running in {top}, not at {root} or its worktree folder")
    code, url = run(["git", "remote", "get-url", "origin"], cwd=root)
    if code == 0 and "github.com" in url:
        rep.ok("origin points at GitHub")
    else:
        rep.fail("no GitHub remote named origin")
    if not a.quick:
        code, _ = run(["gh", "auth", "status"], cwd=root)
        rep.ok("gh authenticated") if code == 0 else rep.fail("gh not authenticated")
        code, out = run(["gh", "repo", "view", "--json", "nameWithOwner,isPrivate"], cwd=root)
        if code == 0:
            info = json.loads(out)
            rep.ok(f"gh targets {info['nameWithOwner']} ({'private' if info['isPrivate'] else 'public'})")
        report_gh_checks(rep, gh_repo_checks(root))

    # 2. folders
    ensure_folders(root, rep, fix=a.fix)
    ensure_hooks(root, rep, fix=a.fix or a.quick)

    # 3. contract
    mpath = root / MANIFEST
    if not mpath.exists():
        rep.fail("not installed (no contract manifest); run install from the master copy")
        return finish(rep, a, root)
    man = json.loads(mpath.read_text())
    local_v = contract_version(root / CONTRACT)
    rep.ok(f"contract {vstr(local_v)} (from master {man.get('master_commit')})")
    edited = [rel for rel, h in man.get("files", {}).items()
              if (root / rel).exists() and sha(root / rel) != h]
    missing = [rel for rel in man.get("files", {}) if not (root / rel).exists()]
    for rel in edited:
        rep.warn(f"edited by hand (sync won't overwrite): {rel}")
    for rel in missing:
        rep.fail(f"contract file missing: {rel}")
    master = Path(man.get("master", ""))
    master_v = contract_version(master / "template" / CONTRACT)
    if master_v and local_v and master_v > local_v:
        kind = "MAJOR (owner approval needed)" if master_v[0] > local_v[0] else "MINOR"
        rep.warn(f"master has contract {vstr(master_v)}: {kind} update; run `setup.py sync`")

    # 4. GitHub labels and workflow
    if not a.quick:
        code, out = run([sys.executable, str(root / "tools/agents/ticket.py"), "labels"]
                        + (["--apply"] if a.fix else []), cwd=root)
        if code == 0:
            if a.fix and ("missing" in out or "differs" in out):
                rep.fixed("labels synced from labels.json")
            else:
                rep.ok("labels match labels.json")
        else:
            rep.fail("labels differ from labels.json (run with --fix): " + out.replace("\n", "; "))
    if not a.quick:
        check_small_fixes(root, rep)
    wf = root / ".github/workflows/agents-contract.yml"
    rep.ok("contract workflow present") if wf.exists() else rep.fail("contract workflow missing")

    # 5. skills, resolved by path
    check_skills(root, rep)

    # 6. other harness
    oc = [p for p in (root / "opencode.json", root / ".opencode", Path.home() / ".config/opencode",
                      root.parent / ".config/opencode", root.parent / ".opencode") if p.exists()]
    recorded = opencode_recorded(root)
    if recorded:
        rep.ok("OpenCode recorded in docs/agents/project.md (Harness locations)")
    elif oc:
        rep.ok("OpenCode config found: " + ", ".join(str(p) for p in oc))
    else:
        rep.warn("no OpenCode config found in the usual places (if it isn't used, record "
                 "'- OpenCode: not used' under Harness locations in docs/agents/project.md)")
    if not a.quick and not recorded:
        rep.warn("OpenCode session-start hook and guard PATH: unverified; look them up and record in docs/agents/project.md")
    check_opencode_shell_bypass(root, rep)
    check_opencode_gh_reads(root, rep)

    # 6b. headless commands and extras (contract 5.0): the full check only, since a session at start
    # can't fix another harness's binary or an unset key
    if not a.quick:
        check_harness_commands(root, rep)
        check_extras(root, rep)

    # 6c. role table: which model and effort plays each role (setup session fills it in)
    check_roles(root, rep)

    # 7. hooks (Claude Code)
    st = root / ".claude/settings.json"
    if st.exists() and "setup.py" in st.read_text() and "SessionStart" in st.read_text():
        rep.ok("Claude Code session-start hook present")
    else:
        rep.warn("Claude Code session-start hook missing (.claude/settings.json)")

    # 8. guard: detected, not assumed
    check_guard(root, rep, a.harness, a.fix)
    if not a.quick and not recorded and not (is_guard_shim(shutil.which("gh"))
                                             and is_git_guard_shim(shutil.which("git"))):
        rep.warn("OpenCode: put tools/agents/guard first on its PATH and record how in docs/agents/project.md "
                 "(not checkable from this shell)")

    # 8b. harness-global rule files that contradict the contract
    for g in global_rule_conflicts(root):
        rep.warn(g)

    # 9. secrets: paths only, never contents
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if (f == ".env" or f.startswith(".env.")) and f not in ENV_OK:
                found.append(Path(dirpath, f).relative_to(root).as_posix())
    if found:
        rep.warn("secret files inside the repo (keys belong in a secret store or the harness environment): "
                 + ", ".join(found))
    else:
        rep.ok("no .env files inside the repo")
    return finish(rep, a, root)


CONFLICT_PATTERNS = [
    (r"the human merges", "says the human merges; the contract has the orchestrator merge"),
    (r"merge anything", "says agents never merge; the contract has the orchestrator merge"),
    (r"\*\*Status:\*\* done \| partial \| stuck\s*\n\s*\*\*Did:", "uses the old 5-line handoff; the contract's has 10 lines"),
]
GOVERNS_LINE = ("In a repo with docs/agents/contract.md, that contract governs all GitHub work; "
                "where this file disagrees, the contract wins.")


def global_rule_conflicts(root: Path) -> list[str]:
    """Harness-global rule files on this machine that contradict the contract.
    Fixed by adding GOVERNS_LINE at the top of each (the owner's call)."""
    homes = {Path.home(), root.parent}
    files = [h / rel for h in homes for rel in (".claude/CLAUDE.md", ".config/opencode/AGENTS.md")]
    out = []
    for f in files:
        if not f.exists():
            continue
        text = f.read_text()
        if GOVERNS_LINE in text:
            continue
        hits = [why for pat, why in CONFLICT_PATTERNS if re.search(pat, text, re.I)]
        if hits:
            out.append(f"{f} {'; '.join(hits)}. Fix (owner approves): add at the top: \"{GOVERNS_LINE}\"")
    return out


def check_skills(root: Path, rep: Report):
    cfg_path = root / "docs/agents/skills.json"
    if not cfg_path.exists():
        rep.fail("docs/agents/skills.json missing")
        return
    cfg = json.loads(cfg_path.read_text())
    subs = {"{root}": str(root), "{workspace}": str(root.parent), "~": str(Path.home())}
    dirs = []
    for d in cfg["search"]:
        for k, v in subs.items():
            d = d.replace(k, v)
        dirs.append(Path(d))
    for name in cfg.get("ours", []):
        absent = [d for d in SKILL_DESTS if not (root / d / "skills" / name / "SKILL.md").exists()]
        if absent:
            rep.fail(f"our skill {name} missing from " + ", ".join(f"{d}skills/" for d in absent))
    if cfg.get("ours"):
        rep.ok(f"{len(cfg['ours'])} baton skills checked in .claude/skills and .agents/skills")
    shadowing = [n for n in cfg.get("superseded", []) for d in SKILL_DESTS
                 if (root / d / "skills" / n / "SKILL.md").exists()]
    if shadowing:
        rep.warn("Matt's originals installed next to our bt- versions (use the bt- ones): "
                 + ", ".join(sorted(set(shadowing))))
    lock = root / "skills-lock.json"
    if lock.exists():
        upstream = json.loads(lock.read_text()).get("skills", {})
        stale = []
        for name in cfg.get("ours", []):
            f = root / ".agents/skills" / name / "SKILL.md"
            m = re.search(r"computedHash ([0-9a-f]{12})", f.read_text()) if f.exists() else None
            base = name.removeprefix("bt-")
            if m and base in upstream and not upstream[base].get("computedHash", "").startswith(m.group(1)):
                stale.append(base)
        if stale:
            rep.warn("Matt's upstream changed since our bt- versions were derived (regenerate them in the "
                     "master copy): " + ", ".join(stale))
    resolved = {}
    for name in cfg["required"] + cfg.get("optional", []):
        hit = next((d / name / "SKILL.md" for d in dirs if (d / name / "SKILL.md").exists()), None)
        if hit:
            resolved[name] = str(hit)
    out = root / ".work" / "skills.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(resolved, indent=2) + "\n")
    rep.ok(f"{len(resolved)} skills resolved by path into .work/skills.json")


def finish(rep: Report, a, root: Path) -> int:
    if a.quick:
        print_quick(rep, a, root)
    else:
        rep.print(f"Setup check: {root}")
    return 1 if rep.failed else 0


def print_quick(rep: Report, a, root: Path):
    """Short block for the session-start hook; its output joins the agent's context."""
    role = ("Your role (orchestrator or implementer) comes from the owner or the orchestrator; "
            "sign as '<role>'.")
    v = vstr(contract_version(root / CONTRACT))
    print(f"[agents] Contract {v}. Rules: AGENTS.md → docs/agents/contract.md. "
          f"All work: the bt-work skill. Temp files: .work/. {role}")
    print(roles_line(root))
    for l, m in rep.lines:
        if l == "FIXED":
            print(f"[agents] Fixed: {m}")
    problems = [(l, m) for l, m in rep.lines if l in ("WARN", "FAIL")]
    if problems:
        print("[agents] Setup check: " + "; ".join(f"{l} {m}" for l, m in problems))
    else:
        print("[agents] Setup check: all OK.")


# --------------------------------------------------------------------------
# sync
# --------------------------------------------------------------------------

def migrate_project_json(root: Path, master: Path) -> list[str]:
    """Add template keys the project lacks and drop retired ones; never touch an existing value or an unknown key."""
    pj = root / "docs/agents/project.json"
    if not pj.exists():
        return []
    cfg = json.loads(pj.read_text())
    tpl = json.loads((master / "template/docs/agents/project.json").read_text())
    lines = []
    for old, (new, ver) in RENAMED_KEYS.items():
        if old in cfg and new not in cfg:
            cfg[new] = cfg.pop(old)
            lines.append(f"  project.json: renamed {old} to {new} (renamed in {ver}); kept its value")
    for k, v in tpl.items():
        if k not in cfg:
            cfg[k] = v
            lines.append(f"  project.json: added {k} = {json.dumps(v)}")
    for k, ver in RETIRED_KEYS.items():
        if k in cfg:
            del cfg[k]
            lines.append(f"  project.json: removed {k} (retired in {ver})")
    if lines:
        pj.write_text(json.dumps(cfg, indent=2) + "\n")
    return lines


def print_sync_summary(old_v, new_v, updated, added, removed, conflicts, key_lines) -> None:
    print(f"Contract {old_v} → {new_v}: {len(updated)} updated, "
          f"{len(added)} added, {len(removed)} removed, {len(conflicts)} left alone (edited by hand).")
    for rel in removed:
        print(f"  removed  {rel} (retired from the master copy)")
    for rel in updated:
        print(f"  updated  {rel}")
    for rel in added:
        print(f"  added    {rel}")
    for line in key_lines:
        print(line)
    for rel in conflicts:
        print(f"  CONFLICT {rel}: edited by hand; move the project-specific part to docs/agents/project.md, "
              f"then delete the file and re-run sync")


def cmd_sync(a) -> int:
    root = find_project_root()
    mpath = root / MANIFEST
    if not mpath.exists():
        sys.exit("Not installed here; run install from the master copy")
    man = json.loads(mpath.read_text())
    master = Path(a.master or man["master"]).resolve()
    if not (master / "template" / CONTRACT).exists():
        sys.exit(f"Master copy not found at {master}")
    local_v = contract_version(root / CONTRACT)
    master_v = contract_version(master / "template" / CONTRACT)
    if master_v and local_v and master_v[0] > local_v[0] and not a.accept_major:
        print(f"Contract {vstr(local_v)} → {vstr(master_v)} is a MAJOR update (roles, merging, spending or "
              f"who decides what changed). Ask the owner, then re-run with --accept-major.")
        return 1
    updated, added, conflicts, removed = [], [], [], []
    files = dict(man.get("files", {}))
    wanted = {d for t in template_files(master) if t not in PROJECT_OWNED for d in destinations(t)}
    for rel in sorted(set(files) - wanted):           # retired from the master copy
        f = root / rel
        if f.exists() and sha(f) != files[rel]:
            conflicts.append(rel)
            continue
        if f.exists():
            f.unlink()
        files.pop(rel)
        removed.append(rel)
    for trel in template_files(master):
        if trel in PROJECT_OWNED:
            continue
        src = master / "template" / trel
        new = sha(src)
        for rel in destinations(trel):
            dst = root / rel
            if not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                files[rel] = new
                added.append(rel)
            elif sha(dst) == new:
                files[rel] = new
            elif rel in files and sha(dst) == files[rel]:
                shutil.copy2(src, dst)
                files[rel] = new
                updated.append(rel)
            else:
                conflicts.append(rel)
    man.update(files=files, contract_version=vstr(contract_version(root / CONTRACT)), master=str(master),
               master_commit=master_commit(master), master_repo=master_repo(master),
               synced=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
    mpath.write_text(json.dumps(man, indent=2) + "\n")
    new_v = vstr(contract_version(root / CONTRACT))
    mine = root / "tools/agents/setup.py"
    if mine.resolve() == Path(__file__).resolve() and str(mine.relative_to(root)) in updated + added:
        # This process still runs the old code; a second run does the steps the new version added.
        print_sync_summary(vstr(local_v), new_v, updated, added, removed, conflicts, [])
        print("  setup.py itself changed; re-running sync with the new copy.")
        sys.stdout.flush()
        os.execv(sys.executable, [sys.executable, str(mine), *sys.argv[1:]])
    key_lines = migrate_project_json(root, master)
    ign = Report()
    ensure_folders(root, ign)
    key_lines += [f"  gitignore {m}" for l, m in ign.lines if l == "FIXED"]
    print_sync_summary(vstr(local_v), new_v, updated, added, removed, conflicts, key_lines)
    return 1 if conflicts else 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="setup.py", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("install"); s.add_argument("--project", required=True)
    s.add_argument("--verify")
    s.add_argument("--fix", action="store_true", help="also apply labels to GitHub")
    s = sub.add_parser("check"); s.add_argument("--quick", action="store_true")
    s.add_argument("--fix", action="store_true"); s.add_argument("--harness")
    s.add_argument("--probe", action="store_true", help="run inside a harness: the smoke test's probe only")
    s.add_argument("--expect-signature"); s.add_argument("--out")
    s = sub.add_parser("smoke", help="launch a harness headless with a trivial job and check what it can do")
    s.add_argument("--harness", required=True)
    s.add_argument("--role", help="role in project.json roles: use its model_args and record its model and effort")
    s.add_argument("--command", help="headless command (JSON list or string, with {prompt}); default harness_commands")
    s.add_argument("--timeout", type=int, default=900)
    s.add_argument("--no-exit-probe", dest="exit_probe", action="store_false")
    s.add_argument("--exit-probe-timeout", type=int, default=120, help="seconds the invalid-flag launch may run")
    s.add_argument("--no-record", action="store_true", help="don't write the result into project.md")
    s = sub.add_parser("extras", help="list, enable or disable optional extras (project scope only)")
    s.add_argument("action", choices=["list", "enable", "disable"]); s.add_argument("name", nargs="?")
    s.add_argument("--roles", help="comma-separated; default: the extra's usual roles")
    s = sub.add_parser("ci", help="write the pull_request verify workflow from its example")
    s.add_argument("--write", action="store_true", help="write .github/workflows/verify.yml")
    s.add_argument("--verify", help="verify command (default: project.json verify_command)")
    s.add_argument("--setup-step", action="append", default=[], dest="setup_step",
                   help="a YAML step block for language setup; repeat for more steps")
    s = sub.add_parser("survey", help="read-only: what this machine has for Baton and its extras")
    s.add_argument("--os-release", default="/etc/os-release", help=argparse.SUPPRESS)
    s = sub.add_parser("sync"); s.add_argument("--master"); s.add_argument("--accept-major", action="store_true")
    a = p.parse_args(argv)
    if a.cmd == "install":
        return cmd_install(a)
    if a.cmd == "check":
        return cmd_check(a)
    if a.cmd == "smoke":
        return cmd_smoke(a)
    if a.cmd == "survey":
        return cmd_survey(a)
    if a.cmd == "extras":
        return cmd_extras(a)
    if a.cmd == "ci":
        return cmd_ci(a)
    return cmd_sync(a)


if __name__ == "__main__":
    sys.exit(main())
