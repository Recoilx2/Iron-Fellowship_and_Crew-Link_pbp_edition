#!/usr/bin/env python3
"""Claude Code PreToolUse hook: applies the gh guard's refusals to Bash commands.

Claude Code passes the tool call as JSON on stdin. Exit code 2 blocks the call
and shows stderr to the agent. ticket.py's own gh calls run in its own
process, not through the Bash tool, so they are never blocked here. Where policy blocks project hooks this never runs; the
PATH shim (guard/gh) is the route that works in every harness.
"""
import importlib.machinery
import importlib.util
import json
import re
import shlex
import sys
from pathlib import Path

loader = importlib.machinery.SourceFileLoader("gh_guard", str(Path(__file__).with_name("gh")))
spec = importlib.util.spec_from_loader("gh_guard", loader)
guard = importlib.util.module_from_spec(spec)
loader.exec_module(guard)

SEPARATORS = {"&&", "||", ";", "|", "&", "(", ")", "\n"}
WRAPPERS = {"env", "command", "exec", "sudo", "nohup", "nice", "time"}
SHELLS = {"bash", "sh", "dash", "zsh"}
WRAPPER_VALUE_FLAGS = {"-u", "--user", "-n", "-X", "-t", "--max-args", "--max-procs"}
TIMEOUT_VALUE_FLAGS = {"-s", "-k", "--signal", "--kill-after"}
XARGS_VALUE_FLAGS = {"-I", "-n", "-P", "-d", "-L"}


def _tokens(command: str) -> list[str]:
    """Shell tokens of a command line. An unbalanced quote falls back to a plain split:
    a parse error must never let the whole command through unchecked."""
    text = command.replace("\n", " ; ")
    try:
        lexer = shlex.shlex(text, posix=True, punctuation_chars=";&|()")
        lexer.whitespace_split = True
        return list(lexer)
    except ValueError:
        return text.split()


def _skip_options(words: list[str], value_flags: set[str]) -> list[str]:
    """Consume a wrapper's own flags and their values, leaving the tool's argv.
    A flag taking its value after `=` has no separate word to skip."""
    while words and words[0].startswith("-"):
        option = words.pop(0)
        flag, sep, _ = option.partition("=")
        if not sep and flag in value_flags and words and not words[0].startswith("-"):
            words.pop(0)
    return words


def _unwrap(words: list[str], tool: str) -> list[list[str]]:
    """The tool's argv from one segment after peeling wrappers like sudo, timeout, env and xargs."""
    words = list(words)
    while words:
        raw, name = words[0], Path(words[0].strip("'\"")).name
        if name in SHELLS and len(words) > 1 and words[1].strip("'\"") in ("-c", "-lc", "-xc"):
            return gh_calls(words[2], tool) if len(words) > 2 else []
        if "=" in raw and not raw.startswith("-"):
            words = words[1:]
            continue
        if name == "timeout":
            words = _skip_options(words[1:], TIMEOUT_VALUE_FLAGS)
            if words and re.fullmatch(r"[\d.]+[smhd]?", words[0]):
                words = words[1:]
            continue
        if name == "xargs":
            words = _skip_options(words[1:], XARGS_VALUE_FLAGS)
            continue
        if name in WRAPPERS:
            words = words[1:]
            while words and words[0].startswith("-"):
                flag = words[0]
                words = words[1:]
                if flag in WRAPPER_VALUE_FLAGS and words and not words[0].startswith("-"):
                    words = words[1:]
            continue
        if name == tool:
            return [words[1:]]
        return []
    return []


def gh_calls(command: str, tool: str = "gh") -> list[list[str]]:
    """Each `gh ...` (or `git ...`) invocation in a shell command line, as argv after it."""
    tokens, calls, seg = _tokens(command), [], []
    for t in tokens + [";"]:
        if t in SEPARATORS or set(t) <= set(";&|()"):
            calls.extend(_unwrap(seg, tool))
            seg = []
        else:
            seg.append(t)
    return calls


def main() -> int:
    try:
        call = json.load(sys.stdin)
    except json.JSONDecodeError:
        guard.record_seen("hook")
        return 0
    if not isinstance(call, dict):
        guard.record_seen("hook")
        return 0
    guard.record_seen("hook", call.get("cwd") or None)       # setup.py check reads this marker
    if call.get("tool_name") != "Bash":
        return 0
    command = (call.get("tool_input") or {}).get("command", "")
    calls, git_calls = gh_calls(command), gh_calls(command, "git")
    for argv in calls:
        why = guard.refusal(argv)
        if why:
            print(f"gh guard: refused `gh {' '.join(argv[:2])}`: {why}", file=sys.stderr)
            return 2
    for argv in git_calls:
        why = guard.git_refusal(argv)
        if why:
            print(f"git guard: refused `git {' '.join(argv[:3])}`: {why}", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
