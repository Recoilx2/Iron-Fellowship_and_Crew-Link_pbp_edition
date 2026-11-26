# Ship (orchestrator)

**"Ship it"** (integration branch into `main`):

1. Bring `main` into the integration branch (`git merge origin/main`; never
   rebase it, so landed tickets' commits stay findable), then verify.
   (`merge` also does this itself for a clean merge, but the final review
   should see the merged result.)
2. Final review, for problems that only appear when tickets interact:
   - run `bt-code-review` in a fresh reviewer sub-agent over the whole
     integration branch against the spec, on the most capable model the harness
     offers; the orchestrator posts the verdict from its findings;
   - its Fit section covers the whole spec: reuse, drift, and code the spec
     superseded and left behind;
   - feed it every Minor and advisory finding carried forward in the spec's
     ticket reviews (their `Approved` and `Changes requested` comments);
   - file the findings as `cleanup` tickets (one per theme), `Part of` the Small fixes
     spec (`small_fixes_spec` in project.json) so they ship later and this spec
     can close; with none, this spec stays their parent. An Important
     finding that changes behaviour can't be a cleanup: file it as a bug
     ticket (`steps/bugs.md`) for the owner to rule on. Only Critical findings
     block shipping. Then post a `Cleanup` note on the spec: `ticket.py note <spec> --keyword Cleanup
     --file f`, listing them or saying "none found". `merge` into `main`
     refuses without it.
3. Demo: run the real product end to end; report the effect.
   The ship report adds **How it works**: the key modules and seams that
   changed, each linked and named in the project's glossary terms
   (`docs/agents/domain.md` says where; `GLOSSARY.md` if it exists), in a few lines.
   It ends: "Want me to walk you through the code?"
4. Write the PR body with `Part of #<spec>` only (never `Closes` a spec) and
   Merge Danger filled in: can it be undone, and how far does it reach. Lint it
   with `ticket.py lint pr <file> --head <spec branch>`, then open the PR to `main`.
5. Post the final review on the PR: `ticket.py review <pr> start`, then
   `approved --head <sha> --file <review>` (the commit you read).
6. Owner says go → `ticket.py merge <pr> --owner-go-ahead "<their words>"`.
   This closes the landed tickets now on `main`, and the spec when it is done
   (otherwise it names the tickets still open). Then post
   `ticket.py note <spec> --keyword Shipped --file <report>` on the spec, closed or not; it
   starts the housekeeping and retro duties `next` names when due.
7. Propose an architecture survey of the areas the spec touched
   (`steps/architecture.md`), delivered as the HTML report, not an
   interruption. The owner picks a candidate before any grilling. When you
   deliver the report, post the `Survey` note
   (`ticket.py note <spec> --keyword Survey --file <report>`); it resets the
   merged-ticket counter `ticket.py next` uses.

**A merged change on `main` turns out bad:**

1. Revert PR, never a force-push. Needs the owner's go-ahead (it touches
   `main`).
2. A bug ticket carrying the original PR's Merge Danger notes → `steps/bugs.md`.
