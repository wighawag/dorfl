---
title: 'In CI, the answered-merge agent phase reported a rebase conflict that a plain git rebase of the same branch does not have'
slug: ci-answered-merge-reports-a-conflict-a-plain-rebase-does-not-have
date: 2026-09-29
status: spotted
---

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (private). After answering `merge` on the sidecar of `task:add-a-title-case-helper` (and releasing its propose lock by hand, see `merge-question-surfacer-has-no-production-caller`), run 36532804273's agent job logged `rebasing work/task-add-a-title-case-helper onto current main conflicted (aborted, never auto-resolved)` and surfaced the item. The branch only adds `src/title.js`, `test/title.test.js`, a review-nits note, and renames its task body `tasks/ready -> tasks/done`; the only change on `main` touching the item is the surfacer's `needsAnswers: true` line in that task body. A plain `git -c merge.directoryRenames=false rebase origin/main` of the same branch (the command `rebaseContinuedBranchOntoMain` runs) succeeds cleanly on a local clone.

So the failure is in what the CI agent job rebases onto, not in the content. Two gaps make it undiagnosable from the log: `rebaseContinuedBranchOntoMain` (`continue-branch.ts`) maps ANY non-zero rebase exit to `{kind: 'conflict'}` and discards git's stderr, and the answered-merge `createJob` path rebases onto the job mirror's local `main`, whose freshness in the agent job (private repository, read token passed per command) is not logged. First step: log the rebase stderr and the `main` sha it rebased onto, distinguish a real conflict from any other rebase failure, then reproduce. The genuinely conflicting case (`task:add-truncate-text-max-helper-to-src-strings-js`, which edits the same file as an already-merged task) behaved correctly: needs-attention, kept branch intact, nothing written to `main`.

Also note: when the surfacer's `needsAnswers: true` edit to the task body and the branch's done-move DO meet, git handles the rename plus modify cleanly, so that part is fine.
