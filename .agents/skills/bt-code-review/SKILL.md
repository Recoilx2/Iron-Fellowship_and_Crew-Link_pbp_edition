---
name: bt-code-review
description: "Review a branch or PR against its base in four sections: Standards, Spec, Fit and Proof, as fresh sub-agents or inline. Use for a `needs-review` PR (docs/agents/steps/review.md), the self-check after committing (steps/build.md step 6), a batch or integration branch, or any review request."
---
<!-- Derived from mattpocock/skills skills/engineering/code-review/SKILL.md (computedHash ce86b40a3d16), merged with the baton override card, 2026-11-13; rules also adapted from obra/superpowers (MIT), 2026-11-14 and 2026-11-15 (severity scale, reasonable-user requirements, bounded outside-the-diff checks, whole-branch final review), and from mattpocock/skills triage (search by domain concept, record where you looked). Regenerate when upstream changes. 2026-11-21: section briefs and the smell baseline moved to SECTIONS.md; severity and modes moved to the top so the coordinator holds the rules and a reviewer loads one file. -->

# Code review

Review of the diff between `HEAD` and a fixed point, in four deliberately separate sections: **Standards**, **Spec**, **Fit**, **Proof**. The briefs, smell baseline and output formats live in `bt-code-review/SECTIONS.md`: that is the only file a section reviewer reads from this skill. This file decides the mode, runs the sections and aggregates them.

## Severity

Put one level on every finding:

- **Critical**: broken functionality, a missing requirement, a security hole, data loss.
- **Important**: wrong behaviour in an edge case, verbatim duplication, a swallowed error, a test that asserts nothing, a broken pattern.
- **Minor**: naming, style, small leftovers. Not everything is Critical.

## Modes

- **PR review** (`docs/agents/steps/review.md`): fixed point is the PR base, the spec is the issue in `Closes #<n>`.
- **Self-check** (`docs/agents/steps/build.md` step 6): fixed point is the branch the ticket was cut from; the spec is the ticket.
- **Reviewer sub-agent**: base ref, diff and tickets come from the orchestrator's brief.
- **Batch / integration**: the target's branch point; each ticket in the batch.

A sub-agent starts fresh and never starts sub-agents. Inside one, run all four briefs inline, one after another, using SECTIONS.md; judge Spec from the ticket and diff, not memory of building it. In a reviewer sub-agent, use the brief's inputs (`docs/agents/steps/review.md` step 2) instead of `gh pr view`, `gh issue view` and `ticket.py`; make no `gh` or `ticket.py` writes and post nothing.

## Process

### 1. Pin the fixed point and sources

Before spawning anyone, confirm the ref resolves (`git rev-parse origin/<base>`) and the diff is non-empty. Capture the diff command once: `git diff origin/<base>...HEAD` (three-dot, against the merge-base), plus `git log origin/<base>..HEAD --oneline`. The spec is the issue in the PR body's `Closes #<n>`; without it, Spec skips and reports "no spec available". Standards are `CODING_STANDARDS.md` at the repo root, and the Standards brief carries the smell baseline.

### 2. Run the sections

Issue four calls together: one fresh sub-agent per section (Standards, Spec, Fit, Proof), each with a fresh context and only its SECTIONS.md brief plus inputs. When sub-agents aren't available, run the same briefs inline, one after another, in your own context. Don't share one section's context with the next.

### 3. Aggregate

Present the reports under `## Standards`, `## Spec`, `## Fit`, `## Proof`, verbatim or lightly cleaned, each ranked by severity within its section, advisory smells last. Do **not** merge findings or rank across sections: the sections are separate so one can't mask another. Keep the Spec section's **Declined to judge** line.

End with one line: cited findings per section and the worst issue _within each section_; no single winner across sections. Mark each finding Critical, Important or Minor. List Minor and advisory ones under `## Carried forward`: they go in the review comment and on to the ship review (`docs/agents/steps/ship.md`), never dropped.

Write the report to `.work/` (the scratch path the brief names) and return it.

### 4. File the outcome

The caller files it: `docs/agents/steps/review.md` for a PR, `docs/agents/steps/build.md` step 6 for a self-check (act only on cited findings; smells stay advisory). A reviewer sub-agent stops after the report. File a bug outside the PR as a ticket, never a comment.

## Why separate sections

- Every standard followed but the wrong thing built → **Standards pass, Spec fail.**
- What the issue asked, but the project's conventions broken → **Spec pass, Standards fail.**
- What was asked, in the right style, but re-implementing what exists or leaving dead code → **Standards and Spec pass, Fit fail.**
- All three pass, but the tests still pass with the change reverted, or mock the very fault being fixed → **Proof fail.** `review approved` needs its `Revert check:` line: `ticket.py revert-check <pr>` (or `--base <ref> --head <ref>`, git only) prints it.
