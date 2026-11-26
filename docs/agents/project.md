# Project settings and rules

Owned by this project; sync never overwrites it. Machine-readable settings
are in `project.json`.

## Settings

In `project.json`; the code reads them and prints what you need (`batch start`
prints `max_parallel_implementers`; `next` says when a survey, housekeeping, retro or
checkpoint is due). Setup writes `harness_commands`, the relay's headless command
per harness; `setup.py smoke` proves it.

- `checkpoint_after_jobs` (default 8; projects set up earlier have it as
  `restart_after_jobs`, which is still read): after this many merges and review
  verdicts on open specs since the orchestrator's last `Report` note, `next`
  says "Checkpoint due": post a Report and keep working.
- `test_paths` (optional): globs for the test files `ticket.py revert-check`
  keeps as on the PR head. Unset: a path with a `test`, `tests`, `spec` or
  `__tests__` folder at any depth, or a file named `test_*`, `*_test.*`,
  `*.test.*` or `*.spec.*`.
- `keep_session_logs` (default 20): `ticket.py tidy` keeps this many newest
  relay sessions per identity.
- `ticket_limits` (default 8 acceptance criteria, 10 Touches entries): `lint`
  refuses bigger slices and bugs.

## Harness locations

<!-- Filled in by the orchestrator at setup, one `- <Harness>: ...` line each
(`- OpenCode: not used` if so; setup check stops warning once it's there):
where the harness keeps its rules, hooks and session logs, and how the gh
guard is put first on its PATH. Claude Code (CLI and VS Code extension), with
no hooks needed: `python3 tools/agents/setup.py check --fix` sets `env.PATH`
in `.claude/settings.local.json` (machine-local, gitignored; verified to put
the shim first for the Bash tool); alternatively launch the CLI as
`PATH="$PWD/tools/agents/guard:$PATH" claude`. `CLAUDE_ENV_FILE` is for
hooks only, so it fails under a managed-hooks-only policy.
AGENT_SIGNATURE is per session and sub-agent: record how this harness sets it
for a sub-agent, which exports it in every shell command. -->

- Claude Code: 2.1.332, the VS Code extension's bundled binary (no `claude` on PATH, so `harness_commands` uses `~/.vscode-server/extensions/anthropic.claude-code-*/resources/native-binary/claude`, resolved to the newest version); rules `AGENTS.md` via `CLAUDE.md`; skills `.claude/skills/bt-*`; hooks in `.claude/settings.json` (SessionStart runs `setup.py check --quick`, PreToolUse runs the guard); reviewer definition `.claude/agents/reviewer.md`; guard first on PATH through `env.PATH` in the gitignored `.claude/settings.local.json` (`setup.py check --fix` writes it per machine and checkout), or `PATH="$PWD/tools/agents/guard:$PATH"` at launch; logs: launcher capture `.work/smoke/claude-code/run.log` / `.work/relay/<id>/<seq>.log`, transcripts `~/.claude/projects/<cwd with non-alphanumerics as ->/<session>.jsonl`, sub-agents under `<session>/subagents/`; signature `AGENT_SIGNATURE=orchestrator` at launch, a sub-agent exports the identity from its brief (`reviewer#1`) in every shell command. `.gitignore` ignores `.claude/*` except `settings.json`, `agents/` and `skills/bt-*` (personal skills stay untracked).
- OpenCode: v2.4.1, `/usr/local/bin/opencode-bin` (same binary as `opencode`); rules `AGENTS.md`; skills `.agents/skills/bt-*`; implementer definition `.opencode/agents/implementer.md`; permissions in `opencode.json` (`shell` deny first, `ask` for setup's own commands, narrow allows, `serena_*` denied because the machine's managed config starts Serena, whose shell tool would bypass the allowlist); no session-start hook: the implementer runs bt-work's Session start itself; guard first on PATH and signature through the launching environment, which reaches the shell only with `--standalone` (`relay.py` and `setup.py smoke` set PATH, PWD and AGENT_SIGNATURE); interactive: `AGENT_SIGNATURE=implementer PATH="$PWD/tools/agents/guard:$PATH" opencode`; logs: launcher capture, plus `/root/.local/share/opencode/log` and `opencode session export <id>`. `opencode api model.list` returns an empty list on v2.4.1, so model variants were proved by real runs.

## Model proof

<!-- Written by the setup session, one `- <Role>: <harness>, <model> @ <effort>;
[verified: <command>]` line per role, quoting step 4's evidence, plus the interactive
orchestrator launch (guard first on PATH, `AGENT_SIGNATURE=orchestrator`). If the
harness has no sub-agent definition files, say so here and give the model and effort
in each sub-agent brief instead; leave `agent_file` unset in `project.json`. -->

- Orchestrator: Claude Code, claude-opus-5-5 @ high; [verified: `claude -p … --model opus --effort high --output-format json` run 2026-11-25, `modelUsage` lists `claude-opus-5-5`; `--effort` values low|medium|high|xhigh|max from `claude --help`, 2.1.332; `CLAUDE_CODE_EFFORT_LEVEL` unset]. Interactive launch: `AGENT_SIGNATURE=orchestrator PATH="$PWD/tools/agents/guard:$PATH" "$(ls -d ~/.vscode-server/extensions/anthropic.claude-code-*/resources/native-binary/claude | sort -V | tail -1)" --model opus --effort high` [unverified as an interactive session; the same binary, env and flags passed the headless smoke test].
- Reviewer: Claude Code sub-agent `.claude/agents/reviewer.md` (`model: opus`, `effort: high`), claude-opus-5-5 @ high; [verified: headless run asking for the reviewer sub-agent, 2026-11-25, session e158bc46: `subagents/agent-a8dc635f9d94c5022.meta.json` → `"agentType":"reviewer"`, `"model":"claude-opus-5-5"`]. Effort comes from the frontmatter; the meta file doesn't record it [unverified]. Headless: `setup.py smoke --harness "Claude Code" --role reviewer` passed 15/15.
- Implementer: OpenCode, opencode-go/hy4-flash-free @ high (the variant); [verified: `setup.py smoke --harness OpenCode --role implementer` 2026-11-25, then `opencode-bin session export ses_dea8db19cffe14R8Y35HmezbrH` → `{"id":"hy4-flash-free","providerID":"opencode-go","variant":"high"}`]. The owner set this model as the only one for OpenCode work.

## Extras

<!-- Optional extras the owner chose at setup, each enabled only in this project's own config (never
globally), one `- <Extra> [role, role]: <session-start line>` per extra and role set, written by
`python3 tools/agents/setup.py extras enable <Extra>`. Read your role's lines at session start
(bt-work Session start). The method never depends on an extra: with none enabled, nothing
changes. Rules: Playwright is for exploring, tests are the proof; RTK must never filter the verify
command's evidence. -->

## Smoke test results

<!-- Written by `python3 tools/agents/setup.py smoke --harness <name>`: one `- <Harness> verified <date>: ...`
line per harness, what the setup session checked from inside the harness's shell. -->

- OpenCode verified 2026-11-25: passed harness ran, guard on path, gh read, guarded write refused, signature set, viewer permission, issues enabled, labels creatable, push dry run, git guard on path, git write refused, allowlist allows ticket.py, allowlist refuses outside commands, exit code meaning, log location; role implementer, model opencode-go/hy4-flash-free, effort high
- Claude Code verified 2026-11-25: passed harness ran, guard on path, gh read, guarded write refused, signature set, viewer permission, issues enabled, labels creatable, push dry run, git guard on path, git write refused, allowlist allows ticket.py, allowlist refuses outside commands, exit code meaning, log location; role reviewer, model claude-opus-5-5, effort high

## Project-specific rules

<!-- Rules that apply only to this project, each naming the incident that
caused it. General rules go to the master copy instead. -->
