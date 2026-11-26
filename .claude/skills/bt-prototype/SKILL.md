---
name: bt-prototype
description: Build a throwaway prototype on a prototype/<name> branch to answer a design question. Use when the owner wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like; when planning needs a feel for a design before bt-to-spec; or when a wayfinder:prototype ticket is on the frontier. Not for building the real feature.
---
<!-- Derived from mattpocock/skills skills/engineering/prototype/SKILL.md (computedHash 1e3ba2202a5b), merged with the baton override card, 2026-11-13. Regenerate when upstream changes. -->

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

Build it on a branch named `prototype/<name>`, cut in the current checkout (no worktree needed). That branch is never merged; it's deleted when its ticket closes. Scratch files go in `.work/`.

## Pick a branch

Identify which question is being answered, using the owner's prompt, the ticket, the surrounding code, or by asking if the owner is around:

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md). Build a single shareable HTML file (free-play buttons plus tabbed guided walkthroughs) that pushes the state machine through cases that are hard to reason about on paper, and that a non-developer can drive.
- **"What should this look like?"** → [UI.md](UI.md). Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts, so getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the owner isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious, but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure.
2. **Trivial to run.** A UI prototype starts from one command in the project's task runner: `pnpm <name>`, `python <path>`, `bun <path>`, etc. A logic demo is a single HTML file the owner double-clicks. Either way, no thinking required to start it.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file in `.work/` with a clear "PROTOTYPE, wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the owner can see what changed.
6. **Capture it when done.** Commit the prototype to its `prototype/<name>` branch and push it: that branch is the **primary source**, kept until its ticket closes. Leave a context pointer to the branch on the prototype's ticket, and capture the answer there too (the verdict and the question it settled). The validated decision reaches `main` only through the normal flow (the spec, a slice ticket, an ADR), never by merging the prototype branch.
