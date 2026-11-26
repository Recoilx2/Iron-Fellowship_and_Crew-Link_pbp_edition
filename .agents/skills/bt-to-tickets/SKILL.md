---
name: bt-to-tickets
description: Break a spec, plan, or the current conversation into tracer-bullet slice tickets with native blocking edges, shaped for an unattended batch run, and publish them on GitHub after the owner approves the breakdown. Use right after bt-to-spec, when the owner says "plan it" or "break this into tickets", or when steps/planning.md reaches its tickets step.
---
<!-- Derived from mattpocock/skills skills/engineering/to-tickets/SKILL.md (computedHash 17496514c929), merged with the baton override card, 2026-11-13. Regenerate when upstream changes. 2026-11-21: publishing now fills the parent spec's Children list (the only allowed parent edit), and slices are sized by lint limits, one seam and one verify command, not by a model's context window. -->

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If you're passed a reference (a spec issue number or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Size each slice by the limits `lint` enforces (at most 8 acceptance criteria and 10 Touches entries), one seam and one verify command, **not by what fits a context window**
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately. Tickets that touch the same files also block one another.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket; green is promised only there.

### 4. Quiz the owner

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the owner:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the owner approves the breakdown.

### 5. Publish the tickets

Publish the approved tickets one issue per ticket, in dependency order (blockers first), per `docs/agents/issue-tracker.md` and `docs/agents/steps/planning.md` step 5. Write each body on the template for its type in `docs/agents/templates/`.

`ticket.py` fills in the spec's Children section as it files each ticket. That is the **only** edit allowed to a parent: don't close the spec or change any other part of it.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.


Avoid specific file paths or code snippets: they go stale fast. Exceptions: **Touches** names modules or shared files, not paths into them; and if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.
