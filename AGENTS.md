## Start here

The work is three specs, done in this order:

1. **Spec: Supabase foundation and Docker stack** (#11)
2. **Spec: Chat-first campaign screen (chat v1)** (#9)
3. **Spec: GM assistant (v1)** (#10)

To pick a ticket:

- Take the lowest-numbered open issue labelled `ready-for-agent` that has no assignee and no open blockers. Check its blockers with `gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by` (0 means you can start).
- Never pick up issues labelled `spec` or `wayfinder:*`. Specs are parents, and wayfinder tickets are decisions for the human.
- Before starting, read the ticket's parent spec, `GLOSSARY.md` and `docs/adr/`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on Recoilx2/Iron-Fellowship_and_Crew-Link_pbp_edition (a fork; never file upstream). See `docs/agents/issue-tracker.md`.

### Triage labels

The default five triage labels, plus the `in-progress` / `needs-review` / `spec` workflow labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
