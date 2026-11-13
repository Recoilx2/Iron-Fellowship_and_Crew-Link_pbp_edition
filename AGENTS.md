## Start here

The work is three specs, done in this order:

1. **Spec: Supabase foundation and Docker stack** (#11)
2. **Spec: Chat-first campaign screen (chat v1)** (#9)
3. **Spec: GM assistant (v1)** (#10)

To pick a ticket:

- Take the lowest-numbered open issue labelled `ready-for-agent` that has no assignee and no open blockers. Check its blockers with `gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by` (0 means you can start).
- Never pick up issues labelled `spec` or `wayfinder:*`. Specs are parents, and wayfinder tickets are decisions for the human.
- Before starting, read the ticket's parent spec, `GLOSSARY.md` and `docs/adr/`.

## Worktrees

Create every worktree or scratch copy of the repo under `.opencode/worktrees/` inside this repo, never in the workspace directory.

## Testing

The agent sandbox has no Docker. Run the plain tests (`npm test`), lint and the type-check locally. Tests that need the local Supabase stack run in GitHub Actions on every pull request: push your branch, open the PR, and check its CI result before handing off. Don't try to install or start Docker in the sandbox.

The stack tests (`src/**/*.live.test.ts`) skip without a stack, so plain `npm test` stays green. Against one local copy they run via `supabase/tests/live.sh` (see its header; it fails the run when any test is skipped). In CI the `live` job in `.github/workflows/supabase-smoke.yml` starts one copy from the template and runs that script on every pull request.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on Recoilx2/Iron-Fellowship_and_Crew-Link_pbp_edition (a fork; never file upstream). See `docs/agents/issue-tracker.md`.

### Triage labels

The default five triage labels, plus the `in-progress` / `needs-review` / `spec` workflow labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### When something fails

One ladder per failure. Run it in order, then stop.

1. **Evidence first.** Commit the logs, artifacts and rejected drafts on the
   ticket branch before diagnosing. Uncommitted `/tmp` evidence has been lost
   before.
2. **Diagnose.** Dispatch a subagent with the `diagnosing-bugs` skill. The
   diagnosis must check whether the failing rule matches the spec or ADR it
   comes from. If the rule itself is wrong, stop and report; don't fix code
   around it.
3. **Fix** through the normal flow: ticket, PR, review by another harness,
   merge per **Merging**. Zero-paid probes are the "try".
4. **Still failing?** Run the `moa` skill (mixture of agents: independent
   agents propose a fix) once, and take its fix through the same flow.
5. **Any second failure, of any kind:** stop and post a handoff (`stuck` →
   `needs-info`).