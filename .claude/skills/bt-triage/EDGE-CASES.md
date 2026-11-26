# Triage edge cases

Reference for `bt-triage`: load this when one of these cases comes up. The procedure you follow on every issue stays in `SKILL.md`; role and label definitions are in `ROLES.md`.

## External pull requests

If this repo treats external pull requests as a request surface (see `docs/agents/issue-tracker.md`), a PR is an issue with attached code: same roles, same states, same machine. Discovery surfaces only *external* PRs (the tracker config defines who counts as external), so a collaborator's in-flight PR is not triage work. This filter is discovery-only: an explicitly named PR is always triaged regardless of author. Tag discovery lines `[PR]` or `[issue]`. For a PR, "verify the claim" in the procedure means checking out the diff and running the relevant tests or commands, and `ready-for-agent` means the brief says what is left to do *to the existing diff*.

## Insufficient detail from a reporter

When the reporter's steps don't reproduce the bug, post triage notes (template in `SKILL.md`) as a `ticket.py note` and leave the issue at `needs-triage` until they reply. Ask specific, actionable questions, never "please provide more info".

If the reporter can't be reached and reproducing needs an environment you don't have (their OS, share, device or file), don't file a bug ticket: move the issue to `needs-info` with the questions and what would let you reproduce it, for the owner. A fix you can't reproduce is a guess, and guesses add new bugs.

## Product calls

A product call ("is this even wanted?", "how should it behave?") is not a maintainer's routine call. File a decision ticket with your recommendation, move the raw issue to `needs-info` pointing at it, and stop; the owner's answer resumes triage.

## Quick state override

If the owner says "move #42 to ready-for-agent", trust them and skip grilling. A raw issue doesn't match a template, so it can't be promoted as it stands: write the brief from what the issue already says, say what you're about to do, then file, promote and close as in the procedure's step 5.

## Rejected enhancements

Write to `.out-of-scope/` only once the owner has decided against the request, or when a matching file already records that decision; link it from the close note. An already-implemented request is `wontfix` for a different reason and never goes in that knowledge base — see [OUT-OF-SCOPE.md](OUT-OF-SCOPE.md).

## Resuming a previous session

If prior triage notes exist on the issue or PR, read them, check whether the reporter has replied or the owner has answered the decision ticket, and present an updated picture before continuing. Don't re-ask resolved questions.
