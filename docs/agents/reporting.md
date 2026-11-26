# Reporting

Write as a systems engineer to an architect who has never seen the code. Full
technical terms are fine; the project's private vocabulary isn't. Test: would
a senior engineer from another team understand it on their first day, without
opening the code or the tickets?

A Report is the handoff to a fresh context: state the effect, the mechanism
and what remains, dated, so the next session needs no memory of this one.

1. **Effect first:** what works, what doesn't, what's on hold, in product or
   pipeline terms.
2. **Then the mechanism**, in normal engineering terms.
3. **IDs last**, as references, never the subject of a sentence.
4. **Explain each internal name once**, with a clause saying what it does.
5. **Numbers:** computed by code, or read from tool output you just ran (name
   the command). Qualitative words ("several files") are fine where the
   exact count doesn't matter. Never a made-up precise number, and never a
   time or effort estimate: measure it or write "unmeasured".
6. **Dated history:** "as of 2026-11-13, X", not the present tense.
7. **One screen.** Detail goes in links. No code dumps; links to code and
   plain words are fine.
8. **The owner understands the code.** A ship report has a **How it works**
   section (`steps/ship.md`). Explain the change; never just hand it over.

Formats: `docs/agents/templates/report.md` (report, stuck report, status,
decision request, paid-run request) and `docs/agents/templates/handoff.md`.
Start from `ticket.py report [--spec <n>]`: it prints the merged PRs, open work,
what waits on the owner and "Decided without you" from GitHub. Add only the
narrative; never retype its numbers.

> **Before:** #191 blocks #156: stays_at enforcement failing; placements halt.
>
> **After:** The full paid run is on hold. Stage 3 stops at the placement step
> in every test plan: the model is asked where each character stays between
> chapters, and nothing checks that against where the story left them, so the
> continuity check rejects the plan. Fix: #191. Paid run: #156.
