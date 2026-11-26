from __future__ import annotations

import datetime as dt
import fnmatch
import re
from pathlib import Path


TYPES = {
    "slice": ["What to build", "Behaviour", "Approach constraints", "Verify",
              "Acceptance criteria", "Out of scope"],
    "bug": ["Effect", "Reproduce", "Expected vs actual", "Evidence",
            "Where found", "Root cause", "Acceptance criteria", "Out of scope"],
    "decision": ["The decision", "Options", "Recommendation", "What it blocks",
                 "Door check", "Acceptance criteria", "Out of scope"],
    "spec": ["Problem Statement", "Solution", "User Stories",
             "Implementation Decisions", "Testing Decisions", "Children",
             "Acceptance criteria", "Out of scope"],
    "cleanup": ["What and why", "Exact targets", "Safety",
                "Acceptance criteria", "Out of scope"],
    "fix": ["What and why", "Verify", "Acceptance criteria", "Out of scope"],
    "research": ["Question", "Why it matters", "Sources", "Output", "Time box",
                 "Acceptance criteria", "Out of scope"],
}


# Sections that may hold a fixed "not yet" phrase when a ticket is filed.
ALLOWED_PENDING = {
    ("bug", "root cause"): "pending diagnosis.",
    ("spec", "children"): "pending to-tickets.",
}


CLOSE_ON_MAIN = {"slice", "bug", "cleanup", "fix"}


UNCLAIMABLE = {"spec", "decision"}           # the owner answers decisions


PR_HEADINGS = ["Summary", "Evidence", "Merge Danger"]


HANDOFF_FIELDS = ["Status", "Effect", "Did", "State", "Proof", "Decisions",
                  "Left", "Next", "Questions"]


HANDOFF_LABEL = {"done": "needs-review", "partial": "ready-for-agent",
                 "stuck": "needs-info"}


# What counts as naming a proof in an acceptance criterion: a `command`, or a
# test or probe. Decisions are proved by the owner's answer; research by findings.
PROOF = re.compile(r"`|\b(tests?|probes?|ci|pytest|unittest)\b", re.I)


PROOF_BY_TYPE = {"decision": re.compile(r"\b(answer|comment)\b", re.I),
                 "research": re.compile(r"\b(findings|link)\b", re.I)}


PLACEHOLDER = re.compile(r"^\s*[-*]?\s*(TBD|TODO)\s*[:.…]*\s*$|^\s*[-*]?\s*<[^>\n]+>\s*$", re.M | re.I)


INLINE_PLACEHOLDER = re.compile(r"<[^>\n]+>")


# `— implementer#2`, or the pre-6.0 long form `— implementer#2 · <harness> · <model>`,
# whose tail is ignored. Only a role starts a signature, so an em-dash line in prose isn't one.
SIG_LINE = re.compile(r"^\s*—\s*(?P<sig>(?:orchestrator|implementer)(?:#[A-Za-z0-9_-]+)?(?:\s·\s[^\n]+?)?)\s*$", re.M)


KW_CLAIMED, KW_RELEASED = "Claimed", "Claim released"


KW_RETRACTED = "Claim retracted"   # a claimant that lost a claim race withdraws its own claim


KW_HANDOFF, KW_REVIEWING = "Handoff", "Reviewing"


KW_APPROVED, KW_CHANGES = "Approved", "Changes requested"


KW_BATCH, KW_BATCH_END = "Batch", "Batch ended"


KW_LANDED, KW_TRIED = "Landed", "Tried"


TRIED_LIMIT = 3


FAILURE_LADDER_DOC = "docs/agents/steps/failure-ladder.md"


KW_CLEANUP = "Cleanup"


KW_INTEGRATION, KW_DECIDED, KW_LADDER = "Integration", "Decided", "Ladder"


KW_SURVEY = "Survey"


KW_HOUSEKEEPING, KW_RETRO, KW_SHIPPED = "Housekeeping", "Retro", "Shipped"


KW_BASE_MERGED = "Base merged"      # ticket.py merged the base into a PR branch; the approval carries over


KW_PAID_RUN = "Paid run"            # ticket.py ran an owner-approved paid run; one per approval


# Keywords only ticket.py writes, and who may write the free-form notes.
RESERVED = {KW_CLAIMED, KW_RELEASED, KW_RETRACTED, KW_HANDOFF, KW_REVIEWING, KW_APPROVED, KW_CHANGES,
            KW_BATCH, KW_BATCH_END, KW_LANDED, KW_TRIED, KW_INTEGRATION, KW_BASE_MERGED, KW_PAID_RUN, "Completed",
            "Closed", "Ready", "Status", "Filed", "Blocked", "Resolved"}


NOTE_KEYWORDS = {"Note": "any", "Resolution": "any", "Batch report": "implementer",
                 KW_LADDER: "implementer", "Report": "orchestrator", KW_DECIDED: "orchestrator",
                 KW_HOUSEKEEPING: "orchestrator", KW_RETRO: "orchestrator", KW_SHIPPED: "orchestrator",
                 KW_CLEANUP: "orchestrator", KW_SURVEY: "orchestrator"}


# Ticket-size limits from project.json, used when linting without a project (offline, audit).
DEFAULT_TICKET_LIMITS = {"acceptance_criteria": 8, "touches": 10}


AGGREGATE_PREFIXES = ("spec/", "batch/")    # branches made of already-handled tickets


SETUP_PREFIX = "setup/"                     # setup and sync PRs: no ticket; the install PR the owner merges


OWNER_STATES = {"needs-info", "ready-for-human"}  # entering one notifies the owner


# Dependency manifests are owner-review files even when owner_review_paths is empty.
DEPENDENCY_MANIFESTS = ("package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
                        "requirements*.txt", "pyproject.toml", "poetry.lock", "Pipfile*",
                        "go.mod", "go.sum", "Cargo.toml", "Cargo.lock", "Gemfile*",
                        "composer.json", "*.csproj", "pom.xml", "build.gradle*")


COMMENT_URL = re.compile(r"#(?:issuecomment|discussion_r|pullrequestreview)-\d+")


LIST_COMMENTS_CAP = 100       # a gh list's `--json comments` holds at most the last 100


TEST_NAME_PATTERNS = ("test_*", "*_test.*", "*.test.*", "*.spec.*")


TEST_PATH_PARTS = {"test", "tests", "spec", "__tests__"}


class ContractError(Exception):
    """A contract rule refused the action. The message says which and why."""


def strip_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.S)


def parse_body(text: str) -> dict:
    """Split an issue body into header lines and `## ` sections."""
    text = strip_comments(text or "")
    head, sections, current = [], {}, None
    for line in text.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            current = m.group(1).strip().lower()
            sections[current] = []
        elif current is None:
            head.append(line)
        else:
            sections[current].append(line)
    header = {}
    for line in head:
        m = re.match(r"^\s*(Type|Part of|Blocked by|Door)\s*:\s*(.*?)\s*$", line, re.I)
        if m:
            header[m.group(1).lower()] = m.group(2)
    return {"header": header,
            "sections": {k: "\n".join(v).strip() for k, v in sections.items()}}


def ticket_type(text: str) -> str | None:
    t = parse_body(text)["header"].get("type")
    return t.strip().lower() if t else None


def parent_of(text: str) -> int | None:
    m = re.fullmatch(r"#(\d+)", (parse_body(text)["header"].get("part of") or "").strip())
    return int(m.group(1)) if m else None


CHILD_LINE = r"^[ \t]*(?:[-*][ \t]*)?(?:\[[ xX]\][ \t]*)?#({n})\b"


def children_of(spec: dict) -> set[int]:
    """The ticket numbers leading the list lines of a spec's Children section
    (a `#n` inside a child's title doesn't count)."""
    section = parse_body(spec.get("body", ""))["sections"].get("children", "")
    return {int(n) for n in re.findall(CHILD_LINE.format(n=r"\d+"), section, re.M)}


def add_blocker_line(body: str, by: int) -> str:
    """The body with `#<by>` on its header `Blocked by:` line: `none` is replaced,
    existing entries kept. Unchanged if there's no such line or it already names it."""
    cut = re.search(r"^##\s", body or "", re.M)
    limit = cut.start() if cut else len(body or "")
    comments = [m.span() for m in re.finditer(r"<!--.*?-->", body or "", re.S)]
    for m in re.finditer(r"^([ \t]*Blocked by[ \t]*:[ \t]*)(.*?)[ \t]*$", body or "", re.I | re.M):
        if m.start() >= limit or any(a <= m.start() < b for a, b in comments):
            continue
        if f"#{by}" in re.findall(r"#\d+\b", m.group(2)):
            return body
        value = f"#{by}" if re.fullmatch(r"none", m.group(2), re.I) or not m.group(2) else f"{m.group(2)}, #{by}"
        return body[:m.start()] + m.group(1) + value + body[m.end():]
    return body


def add_child_line(body: str, child: int, title: str) -> str:
    """The spec body with `- #<child> <title>` in its `## Children` section.

    The first child replaces the 'Pending to-tickets.' line; later ones append
    after the existing entries. A child already listed leaves the body alone,
    so a retried filing never lists it twice."""
    m = re.search(r"^##[ \t]+Children[ \t]*$", body or "", re.I | re.M)
    if not m:
        return body
    nxt = re.search(r"^##[ \t]", body[m.end():], re.M)
    end = m.end() + nxt.start() if nxt else len(body)
    section = body[m.start():end]
    if re.search(CHILD_LINE.format(n=child), section, re.M):
        return body
    lines = section.split("\n")
    placeholder = re.compile(r"^[ \t]*Pending to-tickets\.[ \t]*$", re.I)
    for i, line in enumerate(lines):
        if placeholder.match(line):
            lines[i] = f"- #{child} {title}"
            break
    else:
        insert = 1
        for i in range(len(lines) - 1, 0, -1):
            if lines[i].strip():
                insert = i + 1
                break
        lines.insert(insert, f"- #{child} {title}")
    return body[:m.start()] + "\n".join(lines) + body[end:]


def blocked_by_line(text: str) -> list[int]:
    return [int(n) for n in re.findall(r"#(\d+)", parse_body(text)["header"].get("blocked by") or "")]


def door_field(text: str) -> str:
    """The decision's stated door: 'one-way' (owner) or 'two-way' (orchestrator)."""
    return (parse_body(text)["header"].get("door") or "").strip().lower()


def one_way_ticks(text: str) -> list[str]:
    """Ticked boxes in a decision's Door check list; any one makes the door one-way."""
    section = parse_body(text)["sections"].get("door check", "")
    return [l for l in section.splitlines() if re.match(r"^\s*-\s*\[[xX]\]", l)]


def decision_note_problems(text: str) -> list[str]:
    """A two-way decision's note must say the choice, its evidence and how to undo it."""
    return [f"Decided note needs '{name}: ...'" for name in ("Choice", "Evidence", "Undo")
            if not re.search(rf"^\s*{name}:\s*\S", text or "", re.M | re.I)]


def touch_entries(text: str) -> list[str]:
    """Every entry in a ticket's optional `## Touches` section, duplicates included.

    The size lint counts entries, not distinct modules: listing one file ten
    times is still ten lines a reader has to keep in their head."""
    body = parse_body(text)["sections"].get("touches", "")
    items = (re.sub(r"^[-*]\s*", "", p.strip()).strip("` ").lower()
             for line in body.splitlines() for p in line.split(","))
    return [i for i in items if i and i != "none"]


def touches_of(text: str) -> set[str]:
    """Distinct entries in a ticket's optional `## Touches` section (modules or shared files)."""
    return set(touch_entries(text))


def touch_clashes(tickets: dict[int, str]) -> list[tuple[int, int, set[str]]]:
    """Pairs of tickets sharing a Touches entry with no blocking path (by their
    `Blocked by` lines) between them; those could run in parallel and collide."""
    edges = {n: set(blocked_by_line(b)) for n, b in tickets.items()}

    def gated(a: int, b: int) -> bool:          # does a wait on b, directly or not?
        seen, todo = set(), [a]
        while todo:
            for x in edges.get(todo.pop(), ()):
                if x == b:
                    return True
                if x not in seen:
                    seen.add(x)
                    todo.append(x)
        return False

    touches = {n: touches_of(b) for n, b in tickets.items()}
    ns = sorted(tickets)
    return [(a, b, touches[a] & touches[b]) for i, a in enumerate(ns) for b in ns[i + 1:]
            if touches[a] & touches[b] and not gated(a, b) and not gated(b, a)]


def lint_ticket(text: str, limits: dict | None = None) -> list[str]:
    """Problems with a ticket body; empty list means it matches its template.

    `limits` is project.json's ticket_limits; offline callers get the defaults.
    Sizing is observable, so a model never has to judge what fits one session."""
    parsed = parse_body(text)
    header, sections, problems = parsed["header"], parsed["sections"], []
    ttype = (header.get("type") or "").strip().lower()
    if ttype not in TYPES:
        return [f"Type line missing or unknown (expected one of: {', '.join(TYPES)})"]
    part_of = header.get("part of")
    if part_of is None:
        problems.append("Part of line missing (use '#<n>' or 'none')")
    elif not re.fullmatch(r"(#\d+|none)", part_of.strip(), re.I):
        problems.append(f"Part of must be '#<n>' or 'none', got '{part_of}'")
    blocked = header.get("blocked by")
    if blocked is None:
        problems.append("Blocked by line missing (use 'none' or '#<n>, #<n>')")
    elif not re.match(r"^(none|#\d+(\s*,\s*#\d+)*)\b", blocked.strip(), re.I):
        problems.append(f"Blocked by must start with 'none' or '#<n>', got '{blocked}'")
    if ttype == "decision":
        door = door_field(text)
        if not door:
            problems.append("Decision needs 'Door: one-way' or 'Door: two-way'")
        elif door not in ("one-way", "two-way"):
            problems.append(f"Door must be 'one-way' or 'two-way', got '{door}'")
        ticks = one_way_ticks(text)
        if ticks and door == "two-way":
            problems.append(f"Door is two-way but {len(ticks)} one-way box(es) are ticked; "
                            "tick none or set 'Door: one-way'")
    for name in TYPES[ttype]:
        key = name.lower()
        if key not in sections:
            problems.append(f"Section missing: ## {name}")
            continue
        body = sections[key]
        pending = ALLOWED_PENDING.get((ttype, key))
        if pending and body.strip().lower() == pending:
            continue
        if not body:
            problems.append(f"Section empty: ## {name}")
        elif PLACEHOLDER.search(body):
            problems.append(f"Section has a placeholder (a TBD/TODO line or <...>): ## {name}")
    criteria = sections.get("acceptance criteria", "")
    items = [l for l in criteria.splitlines() if re.match(r"^\s*-\s*\[[ xX]\]", l)]
    if "acceptance criteria" in sections and not items:
        problems.append("Acceptance criteria has no '- [ ]' items")
    extra = PROOF_BY_TYPE.get(ttype)
    for item in items:
        if not (PROOF.search(item) or (extra and extra.search(item))):
            problems.append(f"Criterion names no proof (a `command`, test or probe): {item.strip()}")
    if ttype in ("slice", "bug"):
        lim = limits or DEFAULT_TICKET_LIMITS
        max_criteria = int(lim.get("acceptance_criteria", DEFAULT_TICKET_LIMITS["acceptance_criteria"]))
        if len(items) > max_criteria:
            problems.append(f"{len(items)} acceptance criteria (max {max_criteria}); "
                            "split the ticket into thinner slices")
        max_touches = int(lim.get("touches", DEFAULT_TICKET_LIMITS["touches"]))
        entries = touch_entries(text)
        if len(entries) > max_touches:
            problems.append(f"{len(entries)} Touches entries (max {max_touches}); "
                            "split the ticket into thinner slices")
    return problems


def is_aggregate(head: str | None) -> bool:
    return bool(head) and head.startswith(AGGREGATE_PREFIXES)


def path_matches(path: str, pattern: str) -> bool:
    """A glob matches the path or its file name, so 'package.json' catches a
    manifest in a subdirectory without listing every directory."""
    return fnmatch.fnmatch(path, pattern) or fnmatch.fnmatch(path.rsplit("/", 1)[-1], pattern)


def is_test_path(path: str) -> bool:
    """A test path has a test directory segment or a test-shaped file name. A
    bare 'test' inside a word (latest.md, attestation.py) proves nothing."""
    parts = [p for p in re.split(r"[/\\]", path.strip()) if p]
    if any(p.lower() in TEST_PATH_PARTS for p in parts):
        return True
    name = parts[-1].lower() if parts else ""
    return any(fnmatch.fnmatchcase(name, pat) for pat in TEST_NAME_PATTERNS)


def review_file_groups(ctx, files: list[str]) -> tuple[list[str], list[str]]:
    """(owner-path matches, dependency manifests) among a PR's changed files.
    Manifests are returned apart, but merge treats both groups as owner-review."""
    patterns = [p for p in (ctx.project.get("owner_review_paths") or []) if isinstance(p, str)]
    matched = [f for f in files if any(path_matches(f, p) for p in patterns)]
    manifests = [f for f in files if any(path_matches(f, p) for p in DEPENDENCY_MANIFESTS)]
    return sorted(set(matched)), sorted(set(manifests))


def lint_pr(text: str, head: str | None = None, files: list[str] | None = None,
            base: str | None = None, main: str = "main") -> list[str]:
    """PR body problems. A PR of one ticket must close it; an aggregate
    (spec/* or batch/* head) names its spec with 'Part of'. A manifest change
    lists its new dependencies, with registry URLs, under '## Dependencies'.
    A spec or batch PR into main (`base`, default `main`) also carries no closing keyword: its tickets
    already landed. Into an integration branch it may close them."""
    text = strip_comments(text or "")
    if (head or "").startswith(SETUP_PREFIX):       # setup and sync PRs carry no ticket, but still need a role signature last
        lines = [l for l in text.splitlines() if l.strip()]
        sig = SIG_LINE.match(lines[-1]) if lines else None
        return [] if sig and IDENTITY.match(identity_of(sig.group("sig"))) else \
            ["A setup PR body must end with a signature line: — orchestrator"]
    problems = []
    if is_aggregate(head):
        if not re.search(r"^\s*Part of\s+#\d+", text, re.M | re.I):
            problems.append("An integration or batch PR needs 'Part of #<spec>'")
        if (base or main) == main and re.search(r"^\s*(Closes|Fixes|Resolves)\s+#\d+", text, re.M | re.I):
            problems.append("A spec or batch PR carries `Part of #<spec>` only; its tickets are already "
                            "landed, so `Closes` makes merge refuse")
    elif not re.search(r"^\s*Closes\s+#\d+", text, re.M | re.I):
        problems.append("PR body needs 'Closes #<n>' (and 'Part of #<parent>')")
    probes = re.search(r"^\s*Probes:\s*(.+)$", text, re.M | re.I)
    if not probes or INLINE_PLACEHOLDER.search(probes.group(1)) or \
            not re.search(r"\b(green|red)\b", probes.group(1), re.I):
        problems.append("PR body needs a filled-in 'Probes: <command> green|red' line")
    sections = parse_body(text)["sections"]
    for h in PR_HEADINGS:
        body = sections.get(h.lower())
        if body is None:
            problems.append(f"PR body section missing: ## {h}")
        elif not SIG_LINE.sub("", body).strip():
            problems.append(f"PR body section empty: ## {h}")
    if any(path_matches(f, p) for f in files or [] for p in DEPENDENCY_MANIFESTS):
        deps = sections.get("dependencies", "")
        entries = [l.strip() for l in deps.splitlines()
                   if l.strip() and not SIG_LINE.match(l)]
        if not entries:
            problems.append("PR body needs a filled-in '## Dependencies' section for a manifest change")
        elif not all(re.search(r"https?://\S+", e) for e in entries):
            problems.append("Each line in '## Dependencies' needs the new dependency's registry URL")
    sig = parse_signature(text)
    if not sig or INLINE_PLACEHOLDER.search(sig):
        problems.append("PR body needs a signature line: — <role>")
    return problems


def handoff_fields(text: str) -> dict:
    fields = {}
    for m in re.finditer(r"^\s*\*\*(?P<k>[A-Za-z ]+):\*\*\s*(?P<v>.*)$", text or "", re.M):
        fields[m.group("k").strip()] = m.group("v").strip()
    return fields


def lint_handoff(text: str) -> list[str]:
    fields, problems = handoff_fields(strip_comments(text)), []
    for f in HANDOFF_FIELDS:
        if not fields.get(f):
            problems.append(f"Handoff field missing or empty: **{f}:**")
        elif INLINE_PLACEHOLDER.search(fields[f]):
            problems.append(f"Handoff field still has a <placeholder>: **{f}:**")
    status = fields.get("Status", "").lower()
    if status and status not in HANDOFF_LABEL:
        problems.append(f"Status must be one of done, partial, stuck; got '{status}'")
    return problems


def parse_signature(body: str) -> str | None:
    found = SIG_LINE.findall(body or "")
    return found[-1].strip() if found else None


IDENTITY = re.compile(r"^(orchestrator|implementer)(#[A-Za-z0-9_-]+)?$")


def identity_of(sig: str | None) -> str | None:
    """Who signed, exactly: the first part, with any instance tag ('implementer#2').

    New signatures have only this part; old long ones keep it before the first
    ' · ', so both forms read the same way."""
    return sig.split(" · ", 1)[0].strip() if sig else None


def role_of(sig: str | None) -> str | None:
    """The actor a signature speaks for: its role, without any instance tag.
    Every role check (review independence, who may merge) uses this."""
    ident = identity_of(sig)
    return ident.split("#", 1)[0] if ident else None


def first_line(body: str) -> str:
    for line in (body or "").splitlines():
        if line.strip():
            return line.strip()
    return ""


def keyword_comments(comments: list[dict], keyword: str, by: str | None = None) -> list[dict]:
    """Signed comments whose first line is exactly `keyword`, oldest first.
    With `by`, only those signed by that role."""
    out = []
    for c in comments or []:
        sig = parse_signature(c.get("body"))
        if first_line(c.get("body", "")) == keyword and sig and (by is None or role_of(sig) == by):
            out.append(c)
    return sorted(out, key=lambda c: c.get("createdAt", ""))


def parse_duration(text, what: str = "a duration") -> float:
    """Seconds from 90s, 30m, 4h or plain seconds; the one parser for ticket.py, job.py and relay.py."""
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([smh]?)", str(text).strip())
    if not m:
        raise ContractError(f"{what} must look like 90s, 30m, 4h or plain seconds, got '{text}'")
    return float(m.group(1)) * {"": 1, "s": 1, "m": 60, "h": 3600}[m.group(2)]


def field(body: str, name: str) -> str | None:
    m = re.search(rf"^{re.escape(name)}:\s*(\S+)", body or "", re.M)
    return m.group(1) if m else None


def live_claims(comments: list[dict]) -> list[dict]:
    """Claimed comments, oldest first, minus those their own claimant retracted."""
    gone = {(identity_of(parse_signature(c["body"])), field(c["body"], "Claim"))
            for c in keyword_comments(comments, KW_RETRACTED)}
    return [c for c in keyword_comments(comments, KW_CLAIMED)
            if (identity_of(parse_signature(c["body"])), c["createdAt"]) not in gone]


def claim_window(comments: list[dict]) -> list[dict]:
    """Live claims after the last release, handoff or orchestrator Status note.
    The race check and the holder check share this window so they name the same
    winner. A claimant's own `set needs-info` Status note keeps its claim: it
    must still be able to hand off 'stuck' while the owner answers."""
    ends = [c["createdAt"] for kw in (KW_RELEASED, KW_HANDOFF) for c in keyword_comments(comments, kw)]
    ends += [c["createdAt"] for c in keyword_comments(comments, "Status", by="orchestrator")]
    return [c for c in live_claims(comments) if not ends or c["createdAt"] > max(ends)]


def claim_race_loser(comments: list[dict], me: str) -> tuple[dict, dict] | None:
    """(my claim, the earlier claim by someone else) when two claimants raced:
    both claims sit after the last release, handoff or status change, and
    theirs came first. None when mine is first or there is no claim of mine."""
    window = claim_window(comments)
    mine = [c for c in window if identity_of(parse_signature(c["body"])) == me]
    if not mine:
        return None
    for c in window[:window.index(mine[-1])]:
        if identity_of(parse_signature(c["body"])) != me:
            return mine[-1], c
    return None


def active_claim(comments: list[dict]) -> dict | None:
    """The earliest live claim in the current window: if two agents raced, the
    first claimant holds the ticket even when the loser never retracted.

    A release, handoff or orchestrator Status note ends the window, so the
    ticket can be claimed again after changes are requested or a stuck
    ticket is resumed.
    """
    claims = claim_window(comments)
    return claims[0] if claims else None


def claimed_branch(comments: list[dict]) -> str | None:
    """The branch an earlier Claimed note named, so a rename keeps its work."""
    return next((b for c in keyword_comments(comments, KW_CLAIMED)
                 if (b := field(c["body"], "Branch"))), None)


def active_batch(comments: list[dict], orchestrator: str | None = None) -> str | None:
    """Target branch of the latest Batch comment (signed by the orchestrator,
    if named) not followed by Batch ended."""
    starts = keyword_comments(comments, KW_BATCH, by=orchestrator)
    ends = keyword_comments(comments, KW_BATCH_END, by=orchestrator)
    if not starts or (ends and ends[-1]["createdAt"] > starts[-1]["createdAt"]):
        return None
    return field(starts[-1]["body"], "Target")


def batch_target_before(comments: list[dict], orchestrator: str | None, at: str) -> set[str]:
    """Every batch target the orchestrator set on this ticket before `at`."""
    return {field(c["body"], "Target") for c in keyword_comments(comments, KW_BATCH, by=orchestrator)
            if c["createdAt"] <= at} - {None}


def ended_batch_targets(comments: list[dict], orchestrator: str | None) -> set[str]:
    """Batch targets whose Batch ended was posted after the start: a run that
    may still need its PR (the comment used to come before `gh pr create`)."""
    ends = keyword_comments(comments, KW_BATCH_END, by=orchestrator)
    return {field(c["body"], "Target") for c in keyword_comments(comments, KW_BATCH, by=orchestrator)
            if field(c["body"], "Target") and any(e["createdAt"] > c["createdAt"] for e in ends)}


def batch_pr_heads(ctx) -> set[str]:
    """Branches that already have a PR, so a retry doesn't open a second one."""
    prs = ctx.mirror_or_gh(lambda m: m.prs("all", limit=300),
                           ["gh", "pr", "list", "--state", "all", "--limit", "300", "--json", "headRefName"])
    return {p["headRefName"] for p in prs}


def batch_branch_has_commits(ctx, head: str, base: str) -> bool:
    """GitHub refuses a PR whose head has no commit beyond its base: an empty batch."""
    ctx.r.run(["git", "fetch", "--quiet", "origin", base, head], check=False)
    code, out, err = ctx.r.run_result(["git", "rev-list", "--count", f"origin/{base}..origin/{head}"])
    if code or not out.strip().isdigit():
        raise ContractError(f"Can't tell whether {head} has commits beyond {base}: "
                            f"{err.strip() or out.strip()}")
    return int(out.strip()) > 0


def integration_branch(comments: list[dict]) -> str | None:
    found = keyword_comments(comments, KW_INTEGRATION)
    return field(found[-1]["body"], "Branch") if found else None


def format_comment(keyword: str, body: str, sig: str) -> str:
    parts = [keyword]
    if body and body.strip():
        parts.append(body.strip())
    parts.append(f"— {sig}")
    return "\n\n".join(parts)


def label_names(labels) -> list[str]:
    return [l["name"] if isinstance(l, dict) else l for l in labels or []]


def is_wayfinder(labels) -> bool:
    return any(n.startswith("wayfinder:") for n in label_names(labels))


def status_of(labels, cfg: dict) -> list[str]:
    statuses = {s["name"] for s in cfg["status"]}
    return [l for l in label_names(labels) if l in statuses]


def label_problems(labels, cfg: dict, state: str = "OPEN", require_status: bool = True) -> list[str]:
    names = label_names(labels)
    statuses = status_of(names, cfg)
    problems = []
    if any(n.startswith(p) for n in names for p in cfg.get("exempt_prefixes", [])):
        return problems
    if "spec" in names:
        if statuses:
            problems.append(f"A spec carries 'spec' only, not {statuses}")
        return problems
    if len(statuses) > 1:
        problems.append(f"More than one status label: {statuses}")
    if require_status and state == "OPEN" and not statuses and "needs-triage" not in names and "wontfix" not in names:
        problems.append("No status label (use needs-triage if it isn't triaged yet)")
    if statuses and "needs-triage" in names:
        problems.append("needs-triage means 'no status yet' but a status is set")
    return problems


def allowed(src: str, dst: str, cfg: dict) -> bool:
    return dst in cfg["transitions"].get(src, [])


def worktree_path(repo_top: Path, branch: str) -> Path:
    """<workspace>/.worktrees/<repo>/<branch, slashes as dashes>, also when
    called from inside one of the repo's worktrees."""
    top = Path(repo_top).resolve()
    if top.parent.parent.name == ".worktrees":      # <ws>/.worktrees/<repo>/<branch>
        ws, repo = top.parent.parent.parent, top.parent.name
    else:
        ws, repo = top.parent, top.name
    return ws / ".worktrees" / repo / branch.replace("/", "-")


def closing_refs(pr_body: str) -> list[int]:
    return [int(n) for n in re.findall(r"^\s*Closes\s+#(\d+)", pr_body or "", re.M | re.I)]


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40]


def now() -> dt.datetime:
    """The current time; tests replace this to drive the clock."""
    return dt.datetime.now(dt.timezone.utc)


def to_time(iso: str) -> dt.datetime:
    """Parse ISO times from GitHub (Z) and git (%cI, any offset) to aware UTC."""
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(dt.timezone.utc)


def hours_since(iso: str, at: dt.datetime | None = None) -> float:
    return ((at or now()) - to_time(iso)).total_seconds() / 3600
