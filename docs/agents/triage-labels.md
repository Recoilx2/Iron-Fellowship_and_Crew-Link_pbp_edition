# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Question for the human                   |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified and unclaimed            |
| `ready-for-human`          | `ready-for-human`    | Agents stop; the human decides           |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Implementation workflow labels

Implementation issues carry exactly one status label. Beyond the roles above, the workflow uses:

| Label         | Meaning                                                |
| ------------- | ------------------------------------------------------ |
| `in-progress` | Claimed by an agent                                    |
| `needs-review`| PR open; a different harness reviews it                |
| `spec`        | Parent issue: never claim, implement or close it; its children are its sub-issues |

Wayfinder map and ticket issues carry only `wayfinder:` labels, never these.
