# Issue tracker: GitHub

Read by the bt- skills. Generated from `docs/agents/contract.md`; the
contract wins where they differ. Use `python3 tools/agents/ticket.py` for every
write below; `gh` for reads.

## Conventions

- **Create an issue:** write the body from `docs/agents/templates/<type>.md`,
  then `ticket.py new --title "..." --file body.md [--parent <n>] [--blocked-by <n>,<n>]`.
- **Read an issue:** `gh issue view <n> --json number,title,body,labels,comments`.
- **List issues:** `gh issue list --state open --json number,title,labels` with
  `--label` filters, or `ticket.py status`.
- **Sub-issue:** `ticket.py new --parent <parent>`. Without sub-issues, the
  `Part of: #<parent>` line.
- **Blocking:** native issue dependencies (`--blocked-by`), also written in the
  `Blocked by:` line.
- **Count open blockers:**
  `gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by`
  (0 means startable).
- **Comment:** `ticket.py note <n> --file <f>` (adds the signature).
- **Labels and status:** `ticket.py claim | handoff | set`.
- **Close:** `ticket.py close <n> --reason ...` (the close rule for its type).

Infer the repo from `git remote -v`. File issues only into this repo.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Use `ticket.py new` with the matching template.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue**.

## Wayfinding operations

- **Map:** an issue labelled `wayfinder:map` holding Notes / Decisions so far / Fog,
  created with `ticket.py new --label wayfinder:map`.
- **Child ticket:** a sub-issue of the map, labelled `wayfinder:<type>`
  (research, prototype, grilling, task): `ticket.py new --parent <map> --label
  wayfinder:<type> --blocked-by <n>,<n>`, blockers first; `ticket.py block <n>
  --by <m>` for an edge onto an existing issue. They are exempt from the status
  count and never get a status label.
- **Claim:** `ticket.py claim <n>`: a signed "Claimed" comment, never an
  assignee (one shared account).
- **Frontier:** the map's open children with no open blocker and no active
  signed claim; first in map order wins.
- **Resolve:** comment the answer, then `ticket.py close <n> --reason completed --answer <comment URL>` (`--findings
  <link>` for research; `--reason not-planned --note` for a ruled-out ticket), then
  add a context pointer to the map's Decisions so far.
