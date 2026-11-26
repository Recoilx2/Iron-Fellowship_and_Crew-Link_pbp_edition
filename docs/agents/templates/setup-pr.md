# Setup PR body

Used for the setup PR (`setup/baton`) and for contract syncs
(`setup/sync-<version>`). No `Closes` or Probes line: lint
exempts `setup/*` heads from the ticket rules, not from the `— orchestrator` last line.

Install:

```markdown
## Summary

Installs the agent contract (baton): `AGENTS.md`, `docs/agents/`,
`tools/agents/`, the `bt-` skills and the contract workflow.

- **Contract version:** <n.n> (master commit <hash>)
- **Verify command:** `<command>`
- **Merge:** the owner merges this PR on GitHub. The contract applies only
  once it's merged; agents don't merge it.

— orchestrator
```

Sync:

```markdown
## Summary

Syncs the agent contract (baton) from <from> to <to> (master commit <hash>).

- **Bump:** MINOR | MAJOR. For MAJOR: the owner approved applying it
  (<where, when>).
- **What changed:** one line per DESIGN.md entry between the two versions.
- **Verify command:** `<command>` → <result>
- **Untouched:** `docs/agents/project.md` and `CODING_STANDARDS.md`
  (project-owned). `project.json` only gains missing template keys (a renamed key keeps its
  value) and loses retired ones, and `.gitignore` gains missing entries; list each in the PR.
- **After it lands:** `ticket.py merge` merges `main` into every open `spec/*` and
  `batch/*` branch.
- **Merge:** a fresh reviewer approves; the orchestrator runs `ticket.py
  merge <pr>` (MAJOR: add `--owner-go-ahead '<the owner's words>'`).

— orchestrator
```
