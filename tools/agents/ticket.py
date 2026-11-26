#!/usr/bin/env python3
"""ticket.py: the GitHub contract as one command; `ticket.py -h` lists the commands.

This file is the entry point. The code is in ticketlib/ (see MAINTAINING.md), and
ticketlib/cli.py holds the help text and the signature rules.
"""
from __future__ import annotations

import sys
import time  # noqa: F401  (tests reach ticket.time)
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mirror  # noqa: E402,F401  (the disposable local tracker copy)

# The code lives in the ticketlib package (see MAINTAINING.md); every name is
# re-exported here so `ticket.X` keeps working for tests and relay.py.
from ticketlib.model import *  # noqa: E402,F401,F403
from ticketlib.approval import *  # noqa: E402,F401,F403
from ticketlib.github import *  # noqa: E402,F401,F403
from ticketlib.verify import *  # noqa: E402,F401,F403
from ticketlib.claims import *  # noqa: E402,F401,F403
from ticketlib.batch import *  # noqa: E402,F401,F403
from ticketlib.nextjob import *  # noqa: E402,F401,F403
from ticketlib.decisions import *  # noqa: E402,F401,F403
from ticketlib.review import *  # noqa: E402,F401,F403
from ticketlib.merge import *  # noqa: E402,F401,F403
from ticketlib.revert import *  # noqa: E402,F401,F403
from ticketlib.tickets import *  # noqa: E402,F401,F403
from ticketlib.reports import *  # noqa: E402,F401,F403
from ticketlib.audit import *  # noqa: E402,F401,F403
from ticketlib.cli import *  # noqa: E402,F401,F403
from ticketlib.cli import main  # noqa: E402


if __name__ == "__main__":
    sys.exit(main())
