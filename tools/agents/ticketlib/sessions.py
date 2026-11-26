from __future__ import annotations

from pathlib import Path

KEEP_SESSION_LOGS = 20          # session prompts and logs kept per identity; project.json keep_session_logs overrides


def prune_sessions(directory: Path, keep: int, dry: bool = False) -> list[Path]:
    """Sessions are `<seq>.md` and `<seq>.log`; remove those older than the newest `keep` sequence
    numbers (relay.log is the relay's own, never a session). Returns what was, or with `dry` would be, removed."""
    files = [p for p in sorted(directory.iterdir()) if p.suffix in (".md", ".log") and p.stem.isdigit()] \
        if directory.is_dir() else []
    old = set(sorted({int(p.stem) for p in files})[:-keep])
    gone = [p for p in files if int(p.stem) in old]
    if not dry:
        for p in gone:
            p.unlink(missing_ok=True)
    return gone
