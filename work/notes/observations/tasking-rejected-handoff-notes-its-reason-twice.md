---
title: A rejected tasking handoff notes its reason twice in the apply job log
date: 2026-09-29
---

Seen while building `a-handled-surface-exits-green-in-ci`: in `ci-phase-tasking.ts` `applyOwned`, the `rejected` helper calls `note(reason)` and then `surfaceTaskingBlock` (`tasking.ts`) calls `note(reason)` again on a clean surface, so the same rejection reason appears twice in a row in the apply job log (then a third time inside the `>> ` result line). Not verified against a real CI run; `ci-phase-logs-each-line-once` did not cover this path.
