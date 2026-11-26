# Triage roles and labels

Reference for `bt-triage`: load this when you need to name a category or state. The procedure you follow on every issue stays in `SKILL.md`.

## Who decides

The **orchestrator** makes routine calls: is it a bug, can it be reproduced, which template. Product calls ("is this even wanted?", "how should it behave?") belong to the owner: file them as a decision ticket (`docs/agents/templates/decision.md`, via `ticket.py new --from <n>`) with your recommendation.

## Categories (exactly one)

- `bug`: something is broken.
- `enhancement`: new feature or improvement.

## States (exactly one)

- `needs-triage`: the orchestrator needs to evaluate.
- `needs-info`: waiting on an owner decision.
- `ready-for-agent`: fully specified, ready for an AFK agent.
- `ready-for-human`: the owner decides or does it.
- `wontfix`: will not be actioned.

For a PR, the same states read against the attached code: `ready-for-agent` means a brief is filed and an agent should take the next step on the diff; `ready-for-human` means the owner decides.

Every triaged issue carries exactly one category role and one state role. If state roles conflict, resolve that before anything else; a product conflict goes to the owner.

## Labels

The label for each role is in `docs/agents/triage-labels.md`.

## State transitions

An unlabelled issue normally goes to `needs-triage` first; from there it moves to `needs-info`, `ready-for-agent`, `ready-for-human` or `wontfix`. A `needs-info` issue resumes triage once the owner has answered its decision ticket. Move statuses only with `python3 tools/agents/ticket.py set <n> <status> --note "<why>"`; `ticket.py` refuses moves the contract doesn't allow (**Labels** in `docs/agents/contract.md`).
