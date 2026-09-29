---
title: 'A hold/drop answer on an unlocked work branch resolves the sidecar, so the next pass re-asks and the task becomes buildable again'
slug: merge-question-hold-on-an-unlocked-branch-re-asks-and-re-opens-the-build
date: 2026-09-29
status: spotted
---

Seen while wiring the merge-question surfacer (task `wire-merge-questions-into-the-advance-tick`). When a merge question is asked about a branch whose lock is free (no propose-kept lock), a `hold` or `drop` answer goes through the normal apply path (`advance.ts` `maybeRunMergeAction` falls through to `applyAnsweredQuestions`), which deletes the sidecar and clears `needsAnswers`. The next surfacer pass (now every CI tick, via the `surface-merge-questions` job) asks the same question again, and in between the task sits in `tasks/ready/` with no gate, so it is eligible for a rebuild that continues from a branch already carrying its done-move. On a propose-kept lock this does not happen (the answered hold stays parked: selection only lets an answered `merge` through the held lock, and the surfacer skips an answered merge question). What `hold` and `drop` should leave behind on an unlocked branch is undecided.
