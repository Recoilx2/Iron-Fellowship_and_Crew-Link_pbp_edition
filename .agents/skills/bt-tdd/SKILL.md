---
name: bt-tdd
description: Test-driven development, red → green: committed tests at the ticket's agreed seams, throwaway reproductions at any seam that reaches the bug. Use whenever building a ticket or fixing a bug test-first (bt-implement uses it, at docs/agents/steps/build.md step 4), when someone mentions "red-green-refactor" or TDD, or when writing integration tests.
---
<!-- Derived from mattpocock/skills skills/engineering/tdd/SKILL.md (computedHash e3e0f78ff1c2), merged with the baton override card, 2026-11-13; the anti-patterns on mocks, test-only methods, partial mocks and change detectors, and the refactor, fail-for-the-right-reason and clean-output rules of the loop, adapted from obra/superpowers (MIT) test-driven-development and its writing-good-tests reference, 2026-11-14 and 2026-11-15. Regenerate when upstream changes. 2026-11-21: throwaway tests may start at any seam that reaches the bug, then move to the agreed seam before commit, because a hard "no other seam" rule stalls reproduction. -->

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

When exploring the codebase, read `GLOSSARY.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification: "user can checkout with valid cart" tells you exactly what capability exists, and it survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Committed tests go at pre-agreed seams.** The confirmed seams are the ones named in the spec's Testing Decisions and the ticket's Behaviour and Verify sections. Before committing a test, write down which of those seams it tests. You can't test everything, so agreeing the seams up front lands effort on critical paths and complex logic instead of every edge case.

**Throwaway tests may use any seam while you work.** A bug reproduction may start at any seam that reaches the bug (unit, integration, e2e, or a temporary script), whichever gives the fastest red signal, even when it isn't the agreed seam. Use it to find and fix the bug, then move the regression test to the agreed seam; the throwaway is deleted before commit. A throwaway follows the same red → green loop; it just never ships. If the bug cannot be reproduced at the agreed seam, that missing seam is itself a finding: propose one, with what it catches and what it misses. A new committed seam is an owner question (`steps/build.md` step 4).

When the shape of that interface is itself in question (how deep the module is, where the seam belongs, what the interface should expose), use the `bt-codebase-design` skill for the vocabulary. It is the shared source of the module, interface, depth, seam, adapter, leverage and locality terms, and it is a reference to consult, not a session to run.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological**: the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth: a known-good literal, a worked example, the spec.
- **Horizontal slicing**: writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead: one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.
- **Asserting on a mock**: the mock earns no assertions; it passes when present and fails when absent. Assert the real component's behaviour, or unmock it.
- **Test-only methods in production classes**: cleanup or hooks only tests call belong in test utilities.
- **Partial mocks**: mirror the real data completely, every documented field, or downstream code reads a missing one and the test passes while integration breaks.
- **Change detectors**: a test only an intentional decision can fail (a constant's value, exact message wording) sleeps through bugs. Test the behaviour that depends on the decision.
- **No named break**: before the test body, name the production change that would make it fail. Can't name one → redesign it around observable behaviour.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **Watch it fail for the right reason.** Run it and read the output. It must fail (not error), and because the behaviour is missing (not a typo or bad setup). An error: fix it and re-run until it fails properly. If it passes straight away, it tests something that already works: fix the test, not the code. Put the red run in the PR's Evidence.
- **Assert the exact result.** Check the value or state the behaviour produces, not only that something happened (no error, a non-empty result, any warning); check message wording only where the wording is the behaviour.
- **Break it once.** After the test passes, break the line it covers, confirm the test fails, then restore the line.
- **Try the awkward inputs.** Empty, missing, malformed and boundary values, and names or paths with spaces, each get a test or a probe.
- **Green means the whole suite.** Run the project's verify command, not just the new test. Other tests must still pass and the output must be clean: new warnings count as failures.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactor while green, no new behaviour.** Last step of each cycle, after green only: remove duplication, improve names, keep the tests green. Anything bigger than the code this ticket touches is out of scope.
