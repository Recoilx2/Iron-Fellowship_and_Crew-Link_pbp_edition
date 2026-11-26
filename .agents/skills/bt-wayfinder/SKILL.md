---
name: bt-wayfinder
description: "Plan work too big for one agent session as a shared map of decision tickets on GitHub, resolved one at a time until the way is clear. Use when a fuzzy idea spans more decisions or slices than one spec holds, when steps/planning.md points here, or when handed a wayfinder:map issue."
---
<!-- Derived from mattpocock/skills skills/engineering/wayfinder/SKILL.md (computedHash bd82983c1058), merged with the baton override card, 2026-11-13. Regenerate when upstream changes. -->

A loose idea has arrived — more than one spec's worth of decisions, or more slices than the lint limits allow in one spec — and wrapped in fog: the way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map** on the repo's issue tracker, then works its **decision tickets** (questions whose resolution is a decision, not slices of a build to execute) one at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting: it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place like a data-structure migration. The map is domain-agnostic: engineering work, course content, whatever fits the shape.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the map is done when the way is clear, with nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the map and it's time to hand off. An effort can override this in its **Notes**, carrying execution into the map itself, but absent that, produce decisions, not deliverables.

## Refer by name

Every map and ticket is an issue, so it has a **name**: its title. In everything the owner reads (narration, the map's Decisions-so-far), refer to it by that name, never by a bare id, number, or slug. A wall of `#42, #43, #44` is illegible; names read at a glance. The id and URL don't vanish; a name wraps its link, but they ride _inside_ the name, never stand in for it.

## The Map

The map is a single issue on this repo's GitHub tracker, labelled `wayfinder:map`, the canonical artifact. Its tickets are sub-issues of the map.

The map is an **index**, not a store. It lists the decisions made and points at the tickets that hold their detail; a decision lives in exactly one place, its ticket, so the map never restates it, only gists it and links.

How the map, its child tickets, blocking, claims and frontier queries work in this repo is set out in the "Wayfinding operations" section of `docs/agents/issue-tracker.md`.

### The map body

The whole map at low resolution, loaded once per session. Open tickets are **not** listed: they are open sub-issues, found by query.

```markdown
## Destination

<what reaching the end of this map looks like: the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [<closed ticket title>](link): <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is a **sub-issue** of the map; its issue number is its identity. Its body is the question, sized by observable limits, not a token count: at most 8 acceptance criteria, one seam, one verify command. It uses no ticket template and no `Type:` line:

```markdown
## Question

<the decision or investigation this ticket resolves>
```

Each ticket carries a `wayfinder:<type>` label, one of `research`, `prototype`, `grilling`, `task` (see [Ticket Types](#ticket-types)). The `wayfinder:*` labels are the only labels a map and its tickets carry, never a status label like `ready-for-agent`: they are decisions, not implementation work.

A session **claims** a ticket **first**, before any work, so concurrent sessions skip it. The signed claim _is_ the claim, never an assignee. An open ticket with no active signed claim is unclaimed.

Blocking uses GitHub's **native** issue dependencies: essential because it renders the frontier _visually_ in GitHub's own UI, so the owner sees what's takeable without opening the map. A ticket is **unblocked** when every ticket blocking it is closed; the **frontier** is the open, unblocked children with no active signed claim, the edge of the known.

The answer isn't part of the body; it's recorded on resolution (see [Work through the map](#work-through-the-map)). Assets created while resolving a ticket are linked from the issue, not pasted in.

## Ticket Types

Every ticket is either **HITL** (human in the loop, worked _with_ the owner, who speaks for themselves) or **AFK**, driven by the agent alone. A HITL ticket only resolves through that live exchange; the agent never stands in for the owner's side of it (a grilling agent that answers its own questions has broken this).

- **Research** (AFK): Reading documentation, third-party APIs, or local resources like knowledge bases to surface a fact a decision waits on. Resolved by a subagent that uses the `bt-research` skill. Use when knowledge outside the current working directory is required.
- **Prototype** (HITL): Raise the fidelity of the discussion by making a cheap, rough, concrete artifact to react to (an outline, a rough take, a stub, or UI/logic code) using the `bt-prototype` skill. Links the prototype as an asset. Use when "how should it look" or "how should it behave" is the key question.
- **Grilling** (HITL): Conversation. The default case. Use the `bt-grilling` skill. Use the `bt-domain-modeling` skill.
- **Task** (HITL or AFK): Manual work that must happen before a _decision_ can be made: nothing to decide, prototype, or research, but the discussion is blocked until it's done. Signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. This is the one type that _does_ rather than decides, and it earns its place by unblocking a decision, not by delivering the destination. The agent drives it alone where it can (AFK); otherwise it hands the owner a precise checklist (HITL). Resolved when the work is done; the answer records what was done and any resulting facts (where credentials are kept, new URLs, row counts) later tickets depend on, never the secrets themselves.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war**: the dim view of decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets, one at a time, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. It's the undiscovered frontier _toward_ the destination: everything here is in scope, just not sharp enough to ticket. Write as loosely or as fully as the view allows; it doubles as a signpost for collaborators reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now, _not_ whether you can answer it now.

- **Ticket when** the question is already sharp, even if it's blocked and you can't act on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't pre-slice the fog into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a live ticket, and what's out of scope (the next section).

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work beyond it is **out of scope**: it isn't fog, and it doesn't belong in **Not yet specified**. It gets its own **Out of scope** section on the map: work you've consciously ruled out of _this_ effort. Scope, not sharpness, lands it here.

Out-of-scope work never graduates (the frontier stops at the destination), so it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the route. When a ticket that already exists turns out to sit past the destination (mis-scoped in while charting, or exposed by a resolution), **close it** (a closed ticket is unambiguously off the frontier) and leave one line in the **Out of scope** section: the gist plus why it's out of scope, linking the closed ticket. It stays out of **Decisions so far**, which records the route actually walked; a scope boundary isn't a step on it.

## Invocation

Two modes. Either way, **never resolve more than one ticket per session**, with the exception of research tickets.

### Chart the map

Invoked with a loose idea.

1. **Name the destination.** Use the `bt-grilling` skill. Use the `bt-domain-modeling` skill. Pin down what this map is finding its way to: the spec, decision, or change. The destination fixes the scope, so it's settled first.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** (the way to the destination is already clear, within one spec's worth of decisions and the lint limits), you don't need a map: return to `docs/agents/steps/planning.md` and go on to "bt-to-spec" and "bt-to-tickets", or one slice ticket for a small change.
3. **Create the map**: Destination and Notes filled in, Decisions-so-far empty, the fog sketched into **Not yet specified**.
4. **Create the tickets you can specify now** as sub-issues of the map, blockers first, so every blocking edge and cross-reference names a real issue number: a placeholder `#<n>` auto-links to an unrelated issue. Wiring sorts them into the frontier and the blocked; everything you can't yet specify stays in the fog: the **Not yet specified** section.
5. **Fire the research subagents.** For each `research` ticket you just created, spin up a subagent with a fresh context window that uses the `bt-research` skill to resolve it in parallel, committing its findings under `docs/research/` on a throwaway `research/<name>` branch, with a link from the ticket. Push the branch but open no PR: it is never merged, and it is deleted when its ticket closes.
6. Stop: charting is one session's work; it hand-resolves nothing.

### Work through the map

Invoked with a map (URL or number). A ticket is **optional**: without one, you pick the next decision, not the owner.

1. Load the **map**: the low-res view, not every ticket body.
2. Choose the ticket. If one was named, use it. Otherwise take the first frontier ticket in map order. **Claim it** before any work.
3. Resolve it as the type its `wayfinder:<type>` label names (see [Ticket Types](#ticket-types)). Read the label, not just the body: the body never states the wayfinder type. **Zoom as needed**: fetch the full body of any related or closed ticket on demand (`gh issue view`); use the skills the `## Notes` block names. If in doubt, use the `bt-grilling` skill. Use the `bt-domain-modeling` skill.
4. Record the resolution: post the answer as a signed **resolution comment**, close the issue, and **append a context pointer** to the map's Decisions-so-far. Delete a closed ticket's `research/*` branch.
5. Add newly-surfaced tickets (blockers first, as in charting); graduate any fog the answer has made specifiable, clearing each graduated patch from **Not yet specified** so it lives only as its new ticket. If the answer reveals that a ticket (this one or another) sits beyond the destination, **rule it out of scope** rather than resolving it on the route. If the decision invalidates other parts of the map, update those tickets, or close them as not-planned with the reason.

Unblocked tickets may run in parallel, so expect other sessions to be editing the tracker concurrently.
