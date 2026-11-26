---
name: bt-pr
description: "Write and open a pull request body from docs/agents/templates/pr.md. Use whenever opening or rewriting a PR: steps/build.md step 8, each ticket PR in a batch, the integration PR to main (steps/ship.md), or when asked for a PR description."
---
<!-- Derived from mattpocock/skills skills/engineering/pr/SKILL.md (computedHash a66195583d0f), merged with the baton override card, 2026-11-13. Regenerate when upstream changes. 2026-11-21: Evidence now pastes the command and trimmed real output, red then green, including the revert-and-fail run from build.md, because pseudocode cannot prove a test ran. -->

Write the PR body on `docs/agents/templates/pr.md`, keeping its header lines and signature:

```markdown
## Summary

<diagram, diff-sketch, or tree>

## Evidence

- **Before:** <command> → <trimmed red output>
  **After:** <same command> → <trimmed green output>

## Merge Danger

**Door:** <one-way or two-way>

<optional: description>

**Blast Radius:** <one-word description>

<optional: potential ramifications of merge>
```

Skip all preambles and keep prose brief. Use the project's domain language from `GLOSSARY.md`.

### Summary

Pick the smallest view that makes the key point clear.

- Show logic or an algorithm as pseudocode:

```text
on(save)
  if content is unchanged
    return cached result
  write new content
  return fresh result
```

- Show runtime control flow as a call tree:

```text
submitForm
  createSession
    persistPrompt
    launchAgent
  navigateToSession
```

- Show UI structure as a component tree, including state and module boundaries that matter:

```text
<SessionPage> (apps/example/src/routes/session.tsx)
  useSessionEvents()
  <SessionToolbar>
    <RunSkillButton> (packages/ui)
```

- Show file responsibility or a broad refactor as a shallow file tree:

```text
src/
├── commands/       # parses user actions
├── sessions/       # owns session state
└── transport/      # sends API requests
```

- Show component interaction, control flow, or data flow with Mermaid:

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Daemon
    User->>UI: choose command
    UI->>Daemon: send expanded prompt
    Daemon-->>UI: stream result
```

- Use `diff` when the point is what changes and the surrounding shape already exists. Match the diff shape to the topic.

For a component change:

```diff
 <SessionPage>
   useSessionEvents()
   <SessionToolbar>
+    <RunSkillButton />
   <SessionTimeline>
+    <SkillResultCard />
```

For a file-layout change:

```diff
 src/
 ├── commands/
+│   └── show-me.ts       # expands the slash command
 ├── sessions/
-└── transport.ts
+└── transport/
+    ├── client.ts
+    └── stream.ts
```

For a call-tree or call-stack change:

```diff
 submitForm
   createSession
     persistPrompt
+    expandSkillMention
     launchAgent
-  navigateToSession
+  navigateToSession
+    subscribeToEvents
```

For a state or control-flow change:

```diff
 on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write new content
+  invalidate cache
```

- Show the whole block when most of it is new, when omitted context would hide ownership or order, or when the reviewer needs a copyable target shape:

```ts
function expandSkill(command: string): string {
  const skillName = command.slice(1);
  return `use the ${skillName} skill`;
}
```

#### Guidance

Place each visual next to the short text it supports. Keep only the calls, files, props, states, and boundaries needed to show the reviewer what changed.

You may use one of these, you may use several, it is unlikely you will use all of them. Use your judgement and don't overwhelm the reviewer.

### Evidence

Concrete evidence that the change works: **paste the command and the trimmed real output, red then green** — the failing run before the fix, then the same command passing after it. Trim to the lines that carry the signal; don't retype, invent or turn the output into pseudocode. For a bug fix, paste the failing run from before the fix. For a long suite, the `job.py wait` receipt line is the green output. "Tests are green" alone isn't evidence.

Screenshots are S-tier - when the environment is set up for it and the change is visual.

Execution-based evidence is A-tier: a command and its real output, not a description of them.

### Merge Danger

Describe whether it's a one-way or two-way door. You can walk back through two-way doors, but not one-way doors. A PR that is cheap to roll back is lower risk. Changes that involve destructive actions or hard-to-reverse decisions are one-way doors.

The blast radius is the potential impact or scope of the changes introduced by this PR. Consider all possibilities. Examples are layout shift, breakages for consumers, mobile responsiveness, etc.
