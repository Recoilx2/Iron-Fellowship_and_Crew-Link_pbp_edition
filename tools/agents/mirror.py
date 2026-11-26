#!/usr/bin/env python3
"""mirror.py: a disposable local copy of the GitHub tracker, shared by every
agent and worktree on the machine. GitHub stays the record; this is a cache.

The whole tracker is read once, then kept current by REST delta reads. A fixed
conditional-probe URL (the most recently updated issue or PR) tells us with one
304 request that nothing changed, so idle `next --wait` polling and the many
agents on a project do not spend the GraphQL budget. Delete the file at any
time: the next sync rebuilds it from GitHub. Standard library only.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import sqlite3
import subprocess
from pathlib import Path

SCHEMA = "1"             # bump to force a rebuild when the table layout changes
INTERVAL = "&per_page=100"
SKEW_SECONDS = 120       # re-read a little before last_sync; upserts are idempotent
UNCHANGED = "unchanged"  # the conditional probe answered 304
NOT_MODIFIED = re.compile(r"^HTTP/\S+ 304\b", re.M)  # only a status line, never a header value

PROBE = "repos/{repo}/issues?state=all&sort=updated&direction=desc&per_page=1"
ISSUES = "repos/{repo}/issues?state=all&sort=updated&direction=asc"
COMMENTS = "repos/{repo}/issues/comments?sort=updated&direction=asc"
PULLS = "repos/{repo}/pulls?state=all&sort=updated&direction=desc"


class MirrorError(Exception):
    """The copy could not be refreshed; the caller may fall back to GitHub."""


def common_dir(root: Path) -> Path:
    """The git common dir, shared by every worktree (as job.py computes it)."""
    r = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                       cwd=root, text=True, capture_output=True)
    if r.returncode != 0 or not r.stdout.strip():
        return root / ".work" / "baton"      # not a git repo (tests, offline reads)
    return Path(r.stdout.strip()) / "baton"


def mirror_path(root: Path) -> Path:
    """The one database file on this machine for this git repo."""
    d = common_dir(root)
    d.mkdir(parents=True, exist_ok=True)
    return d / "mirror.sqlite3"


def _connect(path: Path) -> sqlite3.Connection:
    """Wait up to 30 s for another agent's write. WAL is switched on once: changing
    the journal mode needs an exclusive lock that doesn't honour the busy timeout,
    so doing it on every connect made concurrent agents fail with 'database is locked'."""
    conn = sqlite3.connect(str(path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        if conn.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal":
            conn.execute("PRAGMA journal_mode=WAL")
    except sqlite3.OperationalError:
        pass                    # another agent is switching it right now; it'll be WAL
    return conn


def _schema(conn: sqlite3.Connection):
    """Create the tables, or clear them when the layout's version changed."""
    exists = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").fetchone()
    have = conn.execute("SELECT value FROM meta WHERE key='schema'").fetchone() if exists else None
    if have and have[0] == SCHEMA:
        return
    for table in ("meta", "issues", "comments", "pulls"):
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("CREATE TABLE issues(number INTEGER PRIMARY KEY, data TEXT, "
                 "updated_at TEXT, is_pr INTEGER)")
    conn.execute("CREATE TABLE comments(id INTEGER PRIMARY KEY, issue_number INTEGER, "
                 "data TEXT, updated_at TEXT)")
    conn.execute("CREATE TABLE pulls(number INTEGER PRIMARY KEY, data TEXT, updated_at TEXT)")
    conn.execute("INSERT INTO meta VALUES('schema', ?)", (SCHEMA,))


def _meta(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    try:
        row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    except sqlite3.OperationalError:                # a brand-new file, not synced yet
        return default
    return row[0] if row else default


def _set_meta(conn: sqlite3.Connection, key: str, value: str):
    conn.execute("INSERT INTO meta VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                 (key, value))


def _json_stream(text: str) -> list[dict]:
    """gh api --paginate may print one JSON array per page; accept any run of them."""
    out, dec, i = [], json.JSONDecoder(), 0
    while i < len(text):
        while i < len(text) and text[i].isspace():
            i += 1
        if i >= len(text):
            break
        value, i = dec.raw_decode(text, i)
        out.extend(value if isinstance(value, list) else [value])
    return out


def _get(runner, url: str, since: str = "", stop_before: str = "") -> list[dict]:
    """Read every page of a REST list, oldest first. `stop_before` ends the
    unpaginated pulls feed once its (descending) updates predate a sync."""
    sep = "&" if "?" in url else "?"
    since_q = f"&since={since}" if since else ""    # GitHub returns only rows updated since then
    rows = []
    page = 1
    while True:
        full = f"{url}{sep}page={page}{INTERVAL}{since_q}"
        code, out, err = runner.run_result(["gh", "api", full])
        if code != 0:
            raise MirrorError(f"gh api {url} failed: {err.strip() or out.strip()}")
        batch = _json_stream(out)
        if not batch:
            break
        rows.extend(batch)
        if stop_before and any((r.get("updated_at") or "") < stop_before for r in batch):
            break
        if len(batch) < 100:                    # a short page is the last one
            break
        page += 1
    if since:
        rows = [r for r in rows if (r.get("updated_at") or "") >= since]
    return rows


class Probe:
    """What one conditional check found: the tag sent, the new tag, and the stamp."""

    def __init__(self, tag: str, etag: str, stamp):
        self.tag, self.etag, self.stamp = tag, etag, stamp


def probe(runner, repo: str, root: Path | None = None, local: bool = False) -> Probe:
    """The conditional probe. `next --wait` keeps its tag in this process so a
    sync by another agent cannot hide a change from the waiter; sync uses the
    tag stored in the copy. A 200 already seen in this process is reused."""
    path = mirror_path(root or runner.cwd)
    if local:
        tag = getattr(runner, "_baton_wait_tag", "")
    else:
        conn = _connect(path)
        try:
            tag = _meta(conn, "etag")
        finally:
            conn.close()
    cached = getattr(runner, "_baton_probe", None)
    if cached is not None and cached.tag == tag:
        return cached
    if cached is not None and not local and cached.etag == tag:
        return Probe(tag, tag, UNCHANGED)   # this process already fetched that state
    url = PROBE.format(repo=repo)
    code, out, err = runner.run_result(["gh", "api", "-i", "-H", f"If-None-Match: {tag}", url])
    if code != 0:
        if NOT_MODIFIED.search(out):
            return Probe(tag, tag, UNCHANGED)
        raise MirrorError(f"tracker probe failed: {err.strip() or out.strip()}")
    head, _, body = out.partition("\n\n")
    etag = tag
    for line in head.splitlines():
        if line.lower().startswith("etag:"):
            etag = line.split(":", 1)[1].strip()
            break
    rows = _json_stream(body)
    stamp = (rows[0]["number"], rows[0]["updated_at"]) if rows else ()
    result = Probe(tag, etag, stamp)
    runner._baton_probe = result
    if local:
        runner._baton_wait_tag = etag
    return result


def sync(runner, repo: str, root: Path | None = None) -> "Mirror":
    """Refresh the shared copy. Network reads happen before the write lock, so
    a large first fetch cannot hold other agents up; the rows are then upserted
    under BEGIN IMMEDIATE, which is safe even if two processes fetched at once.
    GitHub stays authoritative."""
    path = mirror_path(root or runner.cwd)
    conn = _connect(path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        _schema(conn)
        empty = not conn.execute("SELECT 1 FROM issues LIMIT 1").fetchone()
        synced = _meta(conn, "synced") == "1"
        last = _meta(conn, "last_sync")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    p = probe(runner, repo, root=root)
    if hasattr(runner, "_baton_probe"):
        del runner._baton_probe           # a later sync must probe again, not reuse this answer
    if p.stamp is UNCHANGED and (synced or not empty):
        return Mirror(path)
    full = empty or not last
    since = ""
    if not full:
        t = dt.datetime.fromisoformat(last.replace("Z", "+00:00")) - dt.timedelta(seconds=SKEW_SECONDS)
        since = t.isoformat().replace("+00:00", "Z")
    stop = since or last                  # pulls have no `since`: page until older than the last sync
    issues = _get(runner, ISSUES.format(repo=repo), since)
    comments = _get(runner, COMMENTS.format(repo=repo), since)
    pulls = _get(runner, PULLS.format(repo=repo), stop_before=stop)
    conn = _connect(path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        for r in issues:
            conn.execute("INSERT INTO issues VALUES(?, ?, ?, ?) ON CONFLICT(number) DO UPDATE SET "
                         "data=excluded.data, updated_at=excluded.updated_at, is_pr=excluded.is_pr",
                         (r["number"], json.dumps(r), r.get("updated_at") or "", int("pull_request" in r)))
        for r in comments:
            cid = comment_id(r)
            conn.execute("INSERT INTO comments VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                         "data=excluded.data, updated_at=excluded.updated_at, issue_number=excluded.issue_number",
                         (cid, issue_number(r), json.dumps(r), r.get("updated_at") or ""))
        for r in pulls:
            conn.execute("INSERT INTO pulls VALUES(?, ?, ?) ON CONFLICT(number) DO UPDATE SET "
                         "data=excluded.data, updated_at=excluded.updated_at",
                         (r["number"], json.dumps(r), r.get("updated_at") or ""))
        _set_meta(conn, "etag", p.etag)
        _set_meta(conn, "last_sync", p.stamp[1] if p.stamp not in (UNCHANGED, ()) else "")
        _set_meta(conn, "synced", "1")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return Mirror(path)


def rebuild(runner, repo: str, root: Path | None = None) -> "Mirror":
    """Throw the copy away and read the whole tracker again. Deletions are
    invisible to `since`, so this is how they get corrected."""
    path = mirror_path(root or runner.cwd)
    if path.exists():
        # Clear in place: deleting the file under another agent's open
        # connection breaks it ("disk I/O error" in WAL mode).
        conn = _connect(path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            for table in ("meta", "issues", "comments", "pulls"):
                conn.execute(f"DROP TABLE IF EXISTS {table}")
            conn.commit()
        finally:
            conn.close()
    return sync(runner, repo, root=root)


def issue_number(comment: dict) -> int:
    """A repo-wide comment names its issue in issue_url's last segment."""
    return int(str(comment.get("issue_url") or "").rstrip("/").rsplit("/", 1)[-1])


def comment_id(comment: dict) -> int:
    """GitHub comments have an `id`; fall back to a stable one for test data."""
    if comment.get("id") is not None:
        return int(comment["id"])
    return int(hashlib.sha256(f"{issue_number(comment)}:{comment.get('created_at')}:"
                            f"{comment.get('body')}".encode()).hexdigest()[:12], 16)


def gh_comment(c: dict) -> dict:
    """REST comment → the shape ticket.py reads (`createdAt`, `body`, `url`)."""
    return {"body": c.get("body") or "", "createdAt": c.get("created_at") or c.get("updated_at") or "",
            "url": c.get("html_url") or ""}


def gh_issue(row: dict, comments: list[dict]) -> dict:
    """REST issue → gh's GraphQL shape, with all comments embedded."""
    state = (row.get("state") or "open").lower()
    return {
        "number": row["number"], "title": row.get("title") or "", "body": row.get("body") or "",
        "labels": [{"name": l["name"]} for l in row.get("labels") or []],
        "state": state.upper(),
        "stateReason": (row.get("state_reason") or "").upper() or None,
        "createdAt": row.get("created_at") or "", "updatedAt": row.get("updated_at") or "",
        "comments": comments,
    }


def gh_pr(row: dict, comments: list[dict]) -> dict:
    """REST pull → the shape ticket.py reads, including gh's MERGED state."""
    state = (row.get("state") or "open").lower()
    if state == "closed" and (row.get("merged_at") or row.get("merged")):
        state = "merged"
    merge_sha = row.get("merge_commit_sha")
    return {
        "number": row["number"], "title": row.get("title") or "", "body": row.get("body") or "",
        "state": state.upper(), "headRefName": (row.get("head") or {}).get("ref"),
        "headRefOid": (row.get("head") or {}).get("sha"),
        "baseRefName": (row.get("base") or {}).get("ref"),
        "mergedAt": row.get("merged_at"), "mergeCommit": {"oid": merge_sha} if merge_sha else None,
        "createdAt": row.get("created_at") or "", "updatedAt": row.get("updated_at") or "",
        "comments": comments,
    }


class Mirror:
    """Readers over the local copy. Lists are newest-first, as `gh issue/pr
    list` returns them and as ticket.py's callers assume."""

    def __init__(self, path: Path):
        self.path = path

    def _comments(self, conn, n: int) -> list[dict]:
        rows = conn.execute("SELECT data FROM comments WHERE issue_number=?", (n,)).fetchall()
        return [gh_comment(json.loads(r[0])) for r in rows]

    def issues(self, state: str = "open", label: str | None = None,
               order: str = "created", limit: int | None = None) -> list[dict]:
        conn = _connect(self.path)
        try:
            rows = [json.loads(r[0]) for r in conn.execute(
                "SELECT data FROM issues WHERE is_pr=0").fetchall()]
        finally:
            conn.close()
        if state != "all":
            want = state.upper()
            rows = [r for r in rows if (r.get("state") or "").upper() == want]
        if label:
            rows = [r for r in rows if label in [l["name"] for l in r.get("labels") or []]]
        by = "updated_at" if order == "updated" else "created_at"
        rows.sort(key=lambda r: (r.get(by) or "", r["number"]), reverse=True)
        if limit is not None:
            rows = rows[:limit]
        conn = _connect(self.path)
        try:
            return [gh_issue(r, self._comments(conn, r["number"])) for r in rows]
        finally:
            conn.close()

    def prs(self, state: str = "open", limit: int | None = None) -> list[dict]:
        conn = _connect(self.path)
        try:
            rows = [json.loads(r[0]) for r in conn.execute("SELECT data FROM pulls").fetchall()]
        finally:
            conn.close()
        rows.sort(key=lambda r: (r.get("created_at") or "", r["number"]), reverse=True)
        if state == "merged":
            rows = [r for r in rows if r.get("merged_at")]
        elif state != "all":
            want = state.upper()
            rows = [r for r in rows if (r.get("state") or "").upper() == want]
        if limit is not None:
            rows = rows[:limit]
        conn = _connect(self.path)
        try:
            return [gh_pr(r, self._comments(conn, r["number"])) for r in rows]
        finally:
            conn.close()

    def issue(self, n: int) -> dict | None:
        conn = _connect(self.path)
        try:
            row = conn.execute("SELECT data FROM issues WHERE number=?", (n,)).fetchone()
            return gh_issue(json.loads(row[0]), self._comments(conn, n)) if row else None
        finally:
            conn.close()

    def stats(self) -> dict:
        conn = _connect(self.path)
        try:
            try:
                counts = {name: conn.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
                          for name in ("issues", "comments", "pulls")}
            except sqlite3.OperationalError:                 # file created by a probe, never synced
                counts = {name: 0 for name in ("issues", "comments", "pulls")}
            counts["last_sync"] = _meta(conn, "last_sync") or "(never)"
            counts["size"] = self.path.stat().st_size if self.path.exists() else 0
            return counts
        finally:
            conn.close()


def print_status(root: Path):
    """One line for `ticket.py sync --status`: counts, last sync and file size."""
    path = mirror_path(root)
    if not path.exists():
        print("Local tracker: no copy yet")
        return
    s = Mirror(path).stats()
    print(f"Local tracker: {s['issues']} issues, {s['comments']} comments, {s['pulls']} PRs; "
          f"last sync {s['last_sync']}; {s['size']:,} bytes")
