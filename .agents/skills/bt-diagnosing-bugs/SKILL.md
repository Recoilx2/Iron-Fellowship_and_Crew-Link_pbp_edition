---
name: bt-diagnosing-bugs
description: "Diagnosis loop for hard bugs and performance regressions: finds the root cause, says whether the fix is a patch or a root fix, and whether the spec is wrong. Use when asked to \"diagnose\" or \"debug this\", when something is broken, failing or slow, at step 3 of the failure ladder, and at step 1 of a bug ticket (docs/agents/steps/bugs.md)."
---
<!-- Derived from mattpocock/skills skills/engineering/diagnosing-bugs/SKILL.md (computedHash 87c78ae966e5), merged with the baton override card, 2026-11-13; rules also adapted from obra/superpowers (MIT) (compare with working code, condition polling). Regenerate when upstream changes. -->

# Diagnosing Bugs

A discipline for hard bugs. Skip phases only when explicitly justified.

Run as a sub-agent for `steps/bugs.md` or `steps/failure-ladder.md`, you diagnose through Phase 4 and **return**. Fix nothing and write nothing to GitHub. In **200 words or fewer**:

1. **Reproduce:** the one command that goes red, with its redacted output.
2. **Root cause:** the confirmed hypothesis and where the bad value or state starts.
3. **Fix:** patch (stops the symptom) or root fix (removes the cause), and the change you would make.
4. **Spec:** is the spec or rule wrong? Yes or no, with the line you checked.
5. **Evidence:** the loop command and its output, plus the `tried.md` record of what you ruled out.

**Stuck** means returning "stuck" with the `tried.md` record; the caller posts the handoff (`steps/failure-ladder.md`).

When exploring the codebase, read `GLOSSARY.md` (if it exists) to get a clear mental model of the relevant modules, and check ADRs in the area you're touching.

## Rules

- **No fix without a root cause.** A fix the confirmed hypothesis doesn't explain is a guess.
- **Never repeat a failed fix.** Keep a `tried.md` list of what you changed, predicted and saw; read it before every attempt (`steps/failure-ladder.md` counts attempts).

## Redact

This skill has you show commands, outputs and captured artifacts. **Redact every secret first**: write `<REDACTED>` in its place. Build loops against env vars, so the credential stays in the environment rather than in what you show. Captured artifacts carry auth headers: quote only the lines that carry the signal.

If the redacted output is not enough to diagnose the bug, say so: stuck.

## Phase 0: Keep the evidence

Before anything else, save the failing logs and outputs, redacted, in `.work/tickets/<n>/`. Evidence kept only in your head gets lost.

## Phase 1: Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a **tight** pass/fail signal for the bug (one that goes red on _this_ bug), you will find the cause; bisection, hypothesis-testing, and instrumentation all just consume it. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here, until each applicable loop type has been tried and its result recorded in `tried.md`. Then the bug is stuck.

### Ways to construct one, in roughly this order

1. **Failing test** at whatever seam reaches the bug: unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer) that drives the UI and asserts on DOM/console/network.
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
9. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs.

Build the right feedback loop, and the bug is 90% fixed.

### Tighten the loop

Treat the loop as a product. Once you have _a_ loop, **tighten** it:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A 30-second flaky loop is barely better than no loop; a 2-second deterministic one is tight, a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not, so keep raising the rate until it's debuggable.

### When you genuinely cannot build a loop

Stop: stuck. List what you tried and ask the owner for: (a) access to whatever environment reproduces it, (b) a redacted captured artifact (HAR file, log dump, core dump, screen recording with timestamps), or (c) permission to add temporary production instrumentation. Do **not** proceed to hypothesise without a loop.

A loop that fakes the cause you suspect (a mock that returns the short read, timeout or corrupt byte you have in mind) proves your hypothesis, not the bug. Mock what surrounds the bug, never the fault itself. If the real trigger needs something you don't have here (another OS, a device, the reporter's file), you cannot build a loop: stuck.

### Completion criterion: a tight loop that goes red

Phase 1 is done when the loop is **tight** and **red-capable**: you can name **one command** (a script path, a test invocation, a curl) that you have **already run at least once** (show the invocation and its output, redacted), and that is:

- [ ] **Red-capable**: it drives the actual bug code path and asserts the **user's exact symptom**, so it can go red on this bug and green once fixed. Not "runs without erroring"; it must be able to _catch this specific bug_.
- [ ] **Deterministic**: same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast**: seconds, not minutes.
- [ ] **Agent-runnable**: you can run it unattended; no human in the loop.

If you catch yourself reading code to build a theory before this command exists, **stop: jumping straight to a hypothesis is the exact failure this skill prevents.** No red-capable command, no Phase 2.

## Phase 2: Reproduce + minimise

Run the loop. Watch it go red as the bug appears.

Confirm:

- [ ] The loop produces the failure mode the **user** described, not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.

### Minimise

Once it's red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps **one at a time**, re-running the loop after each cut, and keep only what's load-bearing for the failure.

Why bother: a minimal repro shrinks the hypothesis space in Phase 3 (fewer moving parts left to suspect) and becomes the clean regression test in Phase 5.

Done when **every remaining element is load-bearing**: removing any one of them makes the loop go green.

Do not proceed until you have reproduced **and** minimised.

## Compare

Before hypothesising, find similar code that works (another caller, a sibling module, the previous version) and list every difference from the failing path. Check recent changes in that area.

## Phase 3: Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

If you cannot state the prediction, the hypothesis is a vibe: discard or sharpen it.

**Show the ranked list to your caller before testing.** They often have domain knowledge that re-ranks instantly ("we just deployed a change to #3"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it; proceed with your ranking if no one answers.

## Phase 4: Instrument

Each probe must map to a specific prediction from Phase 3. **Change one variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect. Measure first, fix second.

## Phase 5: Fix + regression test

Write the regression test **before the fix**, but only if there is a **correct seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (single-caller test when the bug needs multiple callers, unit test that can't replicate the chain that triggered the bug), a regression test there gives false confidence.

**If no correct seam exists, that itself is the finding.** The codebase architecture is preventing the bug from being locked down. Stuck, naming the missing seam (`steps/architecture.md`).

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam. Wait on a condition (poll with a timeout), never on an arbitrary sleep.
2. Watch it fail. If you forced the red by mutating code or a fixture, `diff` against a pristine copy to prove the mutation landed before you trust it.
3. Apply the fix where the bad value or state starts, not where the error shows.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.
6. Undo the fix once and watch the loop go red again, then restore it.

## Phase 6: Cleanup + result

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes
- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway prototypes deleted 
- [ ] The hypothesis that turned out correct is stated in the commit / PR message, so the next debugger learns

Then state the root cause, whether the fix is a patch (stops the symptom) or a root fix (removes the cause), and whether the spec or rule itself is wrong. If it is, stop: never fix code around a wrong rule (`steps/failure-ladder.md`).
