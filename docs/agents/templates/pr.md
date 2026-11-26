Closes #<n>
Part of #<parent>
Probes: <command> <green|red + reason>
<!-- Probes: the command you ran and its result; it becomes the merge commit's body. -->

## Summary
<!-- The smallest picture of the change: call tree, file tree, shaped diff or a short diagram, plus a few lines. -->

## Evidence
<!-- Before and after: the failing-then-passing test, or changed output. "Tests are green" alone isn't evidence. -->

## Merge Danger
<!-- One-way or two-way door (can it be undone?), and blast radius (what it reaches). -->

— <role>

## Filled example

```
Closes #42
Part of #10
Probes: python3 -m unittest tests/test_chapters.py green 41/41

### Summary
Chapter count now comes from the story-unit list, not a fixed 12.

### Evidence
Before (red):
$ python3 -m unittest tests/test_chapters.py
...
FAIL: test_one_chapter_per_unit (tests.test_chapters.ChapterTest)
AssertionError: 12 != 55
FAILED (failures=1)

After (green):
$ python3 -m unittest tests/test_chapters.py
...
Ran 41 tests in 0.31s
OK

### Merge Danger
Two-way door: only the planner reads this field, so a revert is one commit.

— implementer
```
