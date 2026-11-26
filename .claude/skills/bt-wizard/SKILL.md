---
name: bt-wizard
description: "Generate an interactive bash wizard that walks a human through steps only they can perform. Use for provisioning, API keys, credentials or CI secrets, an unfamiliar dashboard, or a one-off migration, or when a ticket or handoff says a step needs a human. Not for steps the agent can do itself."
---
<!-- Derived from mattpocock/skills skills/engineering/wizard/SKILL.md (computedHash 806f7f746182), merged with the baton override card, 2026-11-13. Regenerate when upstream changes. -->

# Wizard

A **wizard** is a bash script that walks a human, step by step, through a manual procedure that's tedious to do by hand and tedious to re-explain to an AI every time. It opens each URL, says exactly what to click and copy, captures the values, writes them where they belong (the secret store, the harness environment, GitHub secrets), confirms at every stage, and shows how many stages are left. It might configure third-party services, run a one-off migration, or move the project from one state to another.

Keys never land in a file inside the repo, not even a gitignored `.env`: they go to the secret store or the harness environment.

The delightful UX is already solved by [template.sh](template.sh): stage-by-stage progress, confirmation gates, cross-platform URL opening (including WSL), hidden secret entry, idempotent upserts into an env file outside the repo, `gh secret`/`gh variable` writes, and a closing summary. **Your job is only to scope the procedure and author its stages.** The library above the `STAGES` marker is identical in every wizard; that consistency is the point: never hand-edit it.

A wizard is ephemeral: built for one run, saved in `.work/` (`.work/tickets/<n>/` when it serves a ticket), deleted when the job's done. Never commit it with values filled in. If the owner wants a repeatable setup path in the repo, commit a copy that captures every value at run time and holds none.

## Process

### 1. Scope the procedure

Work out every manual step the human must take and every value that gets captured along the way. Read the repo first, don't ask cold:

- For setup: `.env.example`, `README`, `docker-compose*`, framework config, and `.github/workflows/*` (every `secrets.*` / `vars.*` reference is a value the wizard must produce).
- For a migration or transition: the current state, the target state, and the irreversible actions between them.

Then show the owner the ordered list of stages and the values each produces, and confirm: they may add, drop, or reorder.

**Done when:** every stage is named in order, and for each captured value you know (a) where the human gets it, (b) where it's written (the secret store, the harness environment's env file outside the repo, a GitHub secret, or nowhere; some stages are pure actions), and (c) whether it's secret (hidden entry) or public.

### 2. Map each stage's journey

For each stage, write the precise path a human follows: which URL to open, what to do there, where a value is shown, which variable it fills: e.g. "Dashboard → Developers → API keys → Reveal test key → copy". Where you don't actually know the current UI or the exact command, say so and ask the owner or check the docs: never invent steps that may not exist.

**Done when:** every stage traces to concrete instructions a stranger could follow.

### 3. Author the wizard

Copy `template.sh` into `.work/`. Replace the example stage with one `stage` per step, in dependency order. Use the library helpers: `stage`, `say`/`step`, `open_url`, `ask`/`ask_secret`, `write_env`, `set_secret`/`set_var`, `pause`/`confirm`. Set `TOTAL_STAGES` to the number of stages you wrote, and set `ENV_FILE` to the harness environment's env file (a path outside the repo; `write_env` refuses one inside it).

Hold the bar the template sets: open the URL before asking for its value, use `ask_secret` for anything secret, `write_env` every value the harness environment needs, `set_secret` only the values CI actually needs, and `confirm` before any irreversible action. Each `stage` clears the screen so only the current step is visible: keep a stage to one focused task so nothing the human needs scrolls away. Don't touch the library above the marker.

### 4. Verify and hand off

- `bash -n <script>`; run `shellcheck` if available.
- `chmod +x <script>`.
- Don't run it end-to-end yourself: it opens browsers and blocks on human input. Trace it statically instead: every value from step 1 is captured and lands where step 1 said, no value is written to a path inside the repo, and every `set_secret` name exactly matches a `secrets.*` reference in CI.
- Tell the owner how to run it (the absolute path). If it's a repeatable setup path, commit the value-free copy and link it from the README so the next person runs the script instead of asking an AI.
