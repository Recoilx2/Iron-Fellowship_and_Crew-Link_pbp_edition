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

## Model proof

<!-- Written by the setup session, one `- <Role>: <harness>, <model> @ <effort>;
[verified: <command>]` line per role, quoting step 4's evidence, plus the interactive
orchestrator launch (guard first on PATH, `AGENT_SIGNATURE=orchestrator`). If the
harness has no sub-agent definition files, say so here and give the model and effort
in each sub-agent brief instead; leave `agent_file` unset in `project.json`. -->

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

## Project-specific rules

<!-- Rules that apply only to this project, each naming the incident that
caused it. General rules go to the master copy instead. -->
