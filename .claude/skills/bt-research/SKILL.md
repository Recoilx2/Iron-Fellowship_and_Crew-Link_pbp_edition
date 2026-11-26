---
name: bt-research
description: Investigate a question against high-trust primary sources and commit the findings as a Markdown file under docs/research/. Use when the owner wants a topic researched, when docs or API facts are needed before a decision, when a research ticket or wayfinder:research ticket needs resolving, or when reading legwork should go to a background agent.
---
<!-- Derived from mattpocock/skills skills/engineering/research/SKILL.md (computedHash 7662666af51f), merged with the baton override card, 2026-11-13. Regenerate when upstream changes. -->

Spin up a **background agent** to do the research, so you keep working while it reads. Start it with a fresh context window.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Commit it under `docs/research/`, and link it from the research ticket in a signed comment.
