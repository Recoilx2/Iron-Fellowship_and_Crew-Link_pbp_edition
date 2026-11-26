---
name: bt-implement
description: "Implement one ticket end to end, test-first at the agreed seams, from claim to PR and handoff. Use when you hold a ready-for-agent ticket and are told \"do this\" or \"build it\", or when docs/agents/steps/build.md reaches its implement step."
---
<!-- Derived from mattpocock/skills skills/engineering/implement/SKILL.md (computedHash 560465496ad0), merged with the baton override card, 2026-11-13. Regenerate when upstream changes. 2026-11-21: self-check, verify, then handoff, so "done" rests on a verify receipt for the final code. -->

Implement one ticket. The step order is `docs/agents/steps/build.md`.

If you're passed a ticket reference, fetch it and state its title before starting. If the reference is ambiguous, ask.

Use the `bt-tdd` skill where possible, at the agreed seams: the spec's testing decisions and the ticket's Behaviour and Verify sections. Throwaway tests may start anywhere that reaches the bug; the committed regression goes at the agreed seam.

Run typechecking and single test files regularly, using the project's own linters, type checker, test runner and debugger, and the extras set up for your role, before improvising your own checks. Before changing a function, find its other callers. Once done, use the `bt-code-review` skill to review the work, then verify: "done" needs a passing verify receipt for the PR head.

Commit your work to the ticket branch.
