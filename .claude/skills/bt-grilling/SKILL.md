---
name: bt-grilling
description: "Grill the owner relentlessly about a plan, decision or idea until you share one understanding, in numbered rounds with a recommended answer each. Use when the owner says \"grill me\" or wants to stress-test their thinking, when a decision or wayfinder grilling ticket needs resolving, or when another skill calls for it."
---
<!-- Derived from mattpocock/skills skills/productivity/grilling/SKILL.md (computedHash 485451958784), merged with the baton override card, 2026-11-13. Regenerate when upstream changes. -->

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask every open question on the frontier in one round: number each question and give your recommended answer. Where a question is a real decision, set out each option's trade-offs. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices, each with its trade-offs>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices, each with its trade-offs>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommended answer.

The first round also asks one open question with no recommended answer and no example answers: why the owner wants this, and what success looks like. Their own words carry more than a choice among yours. Any choice you make yourself is your call, never something they agreed to.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
