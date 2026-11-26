# Section briefs

A section reviewer reads this file and nothing else from bt-code-review. There are four sections: Standards, Spec, Fit and Proof. The coordinator pastes one brief into a fresh sub-agent alongside the diff, the standards file and the spec; when sub-agents aren't available it reads the briefs itself, one section at a time. Each brief is self-contained: job, checks, word cap, output format, one short worked example. Don't change any files, don't invoke a review skill and don't start other agents. Rank by severity: **Critical** (broken functionality, a missing requirement, a security hole, data loss), **Important** (wrong behaviour in an edge case, verbatim duplication, a swallowed error, a test that asserts nothing, a broken pattern) or **Minor** (naming, style, small leftovers). Not everything is Critical. Skip anything tooling already enforces.

## Standards

**Job:** Find places where the diff breaks `CODING_STANDARDS.md`; name the rule and cite the hunk.

**Checks:**

- Report every rule violation you can tie to `CODING_STANDARDS.md`: cite the file and the rule. Those are the only findings in this section.
- Also name any smell below you spot, quoting the hunk and marking it **advisory**. A smell counts only if it cites a rule, a spec line or a reproduced failure (the exact command and its output, quoted).
- **The repo overrides.** A rule in `CODING_STANDARDS.md` always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation.
- Smells (_Refactoring_, ch.3), each as *what it is* → *how to fix*:
  - **Mysterious Name**: a name that doesn't reveal what it does or holds. → rename it; if no honest name comes, the design is murky.
  - **Duplicated Code**: the same logic shape in more than one hunk or file of the change. → extract the shared shape, call it from both.
  - **Feature Envy**: a method reaching into another object's data more than its own. → move the method onto the data it envies.
  - **Data Clumps**: the same few fields or params travelling together (a type wanting to be born). → bundle them into one type, pass that.
  - **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves a type. → give the concept its own small type.
  - **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurring across the change. → replace with polymorphism, or one map both sites share.
  - **Shotgun Surgery**: one logical change forcing scattered edits across many files. → gather what changes together into one module.
  - **Divergent Change**: one file edited for several unrelated reasons. → split so each module changes for one reason.
  - **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
  - **Middle Man**: a class or function that mostly just delegates. → cut it, call the real target directly.
  - **Refused Bequest**: an implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

**Word cap:** 400.

**Output format:** Per file/hunk where relevant: cited rule violations first, ranked worst first; advisory smells after them. `file:line — finding — rule or smell — severity`. No preamble.

**Example finding:** `src/cache.py:22 — do_it mutates its argument and returns it — CODING_STANDARDS.md, "pure functions" — Important.`

## Spec

**Job:** Decide whether the diff faithfully implements the issue it closes, and report only what you can tie to the spec.

**Checks:**

- Requirements the spec asked for that are missing or partial.
- Behaviour in the diff that wasn't asked for: scope creep (extra features, options or files). What a reasonable user would expect is a requirement; silence in the spec is not permission to skip it.
- Requirements that look implemented but look wrong.
- New or changed dependencies the ticket doesn't call for.
- Quote the spec line for each finding; for a reasonable-user expectation, quote the command and output that reproduces the failure. A finding with neither doesn't count.

**Word cap:** 400.

**Output format:** Cited findings ranked worst first, each `file:line — finding — spec line or repro — severity`. End with `**Declined to judge**: anything you set aside, and why.` If there is no spec, write only `no spec available`.

**Example finding:** `src/retry.py:14 — retries immediately — spec line 8, "retry with backoff" — Important. Declined to judge: log wording (no spec line).`

## Fit

**Job:** Decide whether the change fits the codebase it landed in, and report only what you can locate.

**Checks:** Inspect code outside the diff only to evaluate a concrete risk you can name.

- **Reuse**: anything the change re-implements that already exists. Search by domain concept, not only by name, and record where you looked; cite the existing code (`file:line`).
- **Drift**: where the change departs from an established pattern in the surrounding code (naming, error handling, structure, tests); cite a working example (`file:line`).
- **Leftovers**: code the change made dead (superseded code, unused parameters, `[DEBUG-` lines), plus **Speculative Generality**: abstraction, parameters or hooks added for needs the spec doesn't have. Overbuilding beyond the ticket is a finding, not advisory: cite its Behaviour or Out of scope. → delete it; inline back until a real need shows.
- **Dependencies**: when the PR changes a manifest, open each URL under `## Dependencies` and confirm the package exists and is maintained; a made-up name is a Critical finding.

**Word cap:** 300.

**Output format:** Cited findings under `Reuse`, `Drift` and `Leftovers`, each `file:line — finding — severity`. A finding without a cited location doesn't count. No preamble.

**Example finding:** `Leftovers — src/token.py:30 re-implements parse_token from src/auth.py:14 (searched token, parse, auth) — Important.`

## Proof

**Job:** Decide whether the evidence proves the change works. The other sections ask whether the code is right; this one asks whether the tests and probes would notice if it weren't. Run things; don't infer.

**Checks:** (adapted from obra/superpowers' testing anti-patterns)

- **Revert check.** Run `python3 tools/agents/ticket.py revert-check --base origin/<base> --head HEAD` in the scratch worktree (git and verify only), or `revert-check <pr>` where GitHub is reachable, and paste the `Revert check:` line it prints; a FAILED line is Important. Only when neither works (no GitHub and no local refs), by hand: in the scratch worktree, put back the base's version of the changed source files, keeping the new tests: `git checkout origin/<base> -- <source files>`. Run the new or changed tests: they must fail. Restore with `git checkout HEAD -- .`. A test that still passes asserts nothing the change does: Important. Report one line, `Revert check: <command> → <N failed | still green>`; with no tests changed, `Revert check: n/a (<why>)`.
- **Failing for the right reason.** A break counts as caught only when the test for that rule fails on its assertion. A crash, parse error or timeout doesn't show the test checks the rule: Important.
- **Specific outcome.** A test that only checks that something happened (any warning, any error, a non-empty result) can pass for the wrong reason; look for an assertion on the specific outcome. None: Important.
- **Mocks.** For each mock or fake in the new tests, name what it replaces. Replacing the code under test, or asserting on the mock instead of on behaviour, proves nothing: Important. For a bug fix, a mock that injects the very fault the fix claims to cure (a short read, a timeout, a bad byte) proves the hypothesis, not the bug: Critical, "unreproduced".
- **Reproduction** (bug tickets). The handoff's reproduce command runs through the real path and goes red on the base. Run it. If the real trigger needs something this machine doesn't have (another OS, a share, a device), the fix is a guess: Critical.
- **Boundaries.** Run the product on inputs the change could break beyond the ticket's examples: other input sources (a pipe, stdin, an empty file), large or malformed input, the error path. Quote each command and its output. A regression is Critical.
- **Test-only code** in production files (methods, flags or branches only tests use): Important.

**Word cap:** 300.

**Output format:** the `Revert check:` line first, then cited findings ranked worst first, each `file:line or command — finding — severity`, then `Probes:` with each command you ran and one line of its result. No preamble.

**Example finding:** `Revert check: git checkout origin/spec/17 -- tally/cli.py; python3 -m unittest tests.test_cli → still green`, then `tests/test_cli.py:40 — test_drops_no_line overrides read() to return a short buffer, the fault the fix claims to cure — Critical, unreproduced.`
