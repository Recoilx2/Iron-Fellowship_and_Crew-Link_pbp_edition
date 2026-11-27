# Triage labels

Read by `bt-triage`. Full label rules: `docs/agents/contract.md`.

| Role in the skills | Label here | Meaning |
|---|---|---|
| `needs-triage` | `needs-triage` | Not yet triaged; no status yet |
| `needs-info` | `needs-info` | Waiting on an owner decision |
| `ready-for-agent` | `ready-for-agent` | Matches its template; startable |
| `ready-for-human` | `ready-for-human` | Agents stop; the owner decides |
| `wontfix` | `wontfix` | Won't be worked on |
| category: bug | `bug` | Raw issue: something is broken |
| category: enhancement | `enhancement` | Raw issue: new behaviour requested |

Move statuses with `ticket.py set`; close with `ticket.py close`.
