---
name: bt-implement-spec
description: "Run an owner-approved batch: implement a spec's named tickets onto the batch branch, frontier first, one implementer sub-agent and PR per ticket, each merging its own PR on a green verify receipt. Use only when a batch has started (docs/agents/steps/batch.md) or the owner says to run implement-spec. A single ticket uses steps/build.md."
---
<!-- Derived from mattpocock/skills skills/engineering/implement-spec/SKILL.md (computedHash c3474ef32086), merged with the baton override card, 2026-11-13. Regenerate when upstream changes. 2026-11-21: dropped the merger subagent because ticket.py merge --batch lets the implementer merge its own PR; frontier and slots come from batch next, returns are capped at 200 words, and there is a no-sub-agents fallback. 2026-11-22: plumbing moved to steps/batch.md. -->

You have a spec and its tickets, started as a batch run. Procedure and commands are in `docs/agents/steps/batch.md`; this skill is the method.

The goal is every ticket in the run merged into the batch branch through its own PR.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Start every subagent with a fresh context window. Only you dispatch subagents. Start a fresh implementer for each ticket `batch next` prints; resume one only to finish its own ticket.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency. Each returns at most 200 words: the ticket, the PR, the head commit, verify on one line, proof of each acceptance criterion, and **Concerns** (or "none").

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. It saves its markdown notes in `.work/`, where all future subagents can read them. This lets **implementer subagents** focus on implementation rather than exploration.

3. The batch branch already exists (`batch.md`). Use it as it is.

4. Use a fresh **implementer subagent** for each frontier ticket, each in its own worktree on its own branch. Each implementer subagent builds its ticket by `docs/agents/steps/build.md`, based on the batch branch.

5. Once an implementer completes, it merges its own PR (`batch.md` step 3). If this changes the **frontier**, kick off more implementers. This allows for maximum concurrency.

6. Once every ticket is merged or stuck, post the batch report (`batch.md`). Review of the whole batch belongs to the orchestrator.

7. Clean up the worktrees of merged tickets. Keep stuck tickets' worktrees and name them in their handoffs.

## No sub-agents available

Build the frontier tickets one at a time in your own context, each through its own PR; then check the frontier again.
