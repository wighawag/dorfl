---
title: "A continue rebase merges a conflict confined to the task's own done record (main's body plus the branch's Decisions); the second narrow exception to never-auto-resolve"
status: accepted
created: 2026-11-20
decided: 2026-11-20
supersedes:
superseded_by:
---

# ADR: a continue rebase merges the task's own done record

## Context

Seen live on dorfl 0.16.0 (rocketh-playground, `do task:<slug> --isolated`, propose mode, arbiter `origin`):

1. The acceptance gate fails on the rebased tip. By then the kept branch already holds the completion commit, which moves `work/tasks/ready/<slug>.md` to `work/tasks/done/<slug>.md` and appends the builder's `## Decisions` block.
2. The surface edits `work/tasks/ready/<slug>.md` on `main` (`needsAnswers: true`) and writes the question sidecar.
3. Applying the answer (`advance`) edits the same file on `main` again: `needsAnswers: false` and an `## Applied answers` section at the end of the body.
4. The next continue rebase replays the done-move onto that `main`. Git pairs the rename with main's edits and conflicts on `work/tasks/done/<slug>.md`, because both sides appended a section at the end of the body. The rebase was aborted ("never auto-resolved"), the item surfaced again, and `requeue --reconcile` retried the same rebase into the same conflict.

The operator resolved it by hand three times, the same way each time: keep main's task body, append the branch's `## Decisions`, delete the ready copy, force-with-lease the work branch. Both sides of that conflict are dorfl's own writes to the item's lifecycle file.

## Decision

1. **`rebaseContinuedBranchOntoMain` resolves a stop whose conflicts are all question sidecars and/or the continued task's OWN done record** (`work/tasks/done/<slug>.md` for the branch `work/task-<slug>`), then continues. The slug comes from the checked-out branch, or is passed explicitly by the detached `requeue --reconcile` worktree.
2. **The merge rule is the one the operator applied by hand:** main's version (the source of truth for the task body, the surfaced question and any applied answer) with every `## Decisions...` section of the branch's version that main does not already carry appended at the end, written at the branch's done path. Git's rename handling removes the pool copy, so one copy remains.
3. **It refuses (aborts as before) when** main already has its own `work/tasks/done/<slug>.md` (the task landed some other way), when either side is missing (main cancelled or deleted the task), when either side still carries conflict markers, or when the stop also conflicts on any other path.
4. The resolution is reported on the clean result (`resolvedRecords`) and as a note wherever sidecar resolutions are reported.

## Considered options

- **Merge the done record at the continue rebase (chosen).** One function, every continue site (in-place `start`, job worktree, `--isolated`, `requeue --reconcile`, the stale-lease push retry), the same place the sidecar exception lives.
- **Never keep the done-move on a branch whose gate failed.** Rejected: the kept done-move is the deliberate continue-build state (ADR `continue-build-already-done-moved`, `source: 'done'`), the completion commit also carries the agent's work (`git add -A`), and splitting it on every red gate would rewrite the kept branch's history and re-open the stranded-done recovery paths that rely on it.
- **Stop appending at the end on one side** (place `## Applied answers` mid-body, as the `## Requeue` note already is). Rejected as the only fix: it narrows the conflict to "both sides edited the same region", which a frontmatter edit on both sides (the surface's `needsAnswers` and the land's residue clear) still hits, and it would not fix branches already kept in the field.

## Consequences

- A surfaced, answered, continued task no longer needs a hand rebase; any number of bounce/answer/continue cycles converge.
- The integration rebase (`rebaseOntoMainWithReconcile`) still does not apply these rules: on a continue, the continue rebase has already absorbed main's edits, and the item is claimed during the run.
- `execution-substrate-decisions` §10 "never auto-resolve" keeps its meaning for content: dorfl picks a side only on its own protocol files (question sidecars, and now the continued task's done record), and never discards a human answer.
