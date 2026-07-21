---
'dorfl': patch
---

Render a task's spec-user-story coverage as `US-<n>` (not `US #<n>`) in the propose-mode tasking PR body.

`composeTaskingProposeBody` emitted each task's coverage map as `US #<n>`. On GitHub a bare `#<n>` in a PR body autolinks to issue/PR #<n> — a confusing false reference, since the number is a spec user-story index, not an issue (observed live on wighawag/rocketh#45). The hyphenated `US-<n>` form carries the same meaning without tripping GitHub's autolinker.
