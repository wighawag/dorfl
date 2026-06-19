---
title: a folder-rename slice's Gate-2 review-nits file lands in the PRE-rename folder (binary-vs-branch work-layout)
date: 2026-06-19
status: open
priority: low
---

## What was noticed

While driving the `folder-taxonomy-reorg-and-rename` migration (drive-backlog),
slice `regroup-notes-and-task-board-rename` (PR #177) renamed
`observations/ -> notes/observations/`. The agent moved all 70 pre-existing
observation files correctly, but the merged branch STILL had a stray top-level
`work/observations/` containing exactly ONE file:
`review-nits-regroup-notes-and-task-board-rename-2026-06-19.md`.

Cause: the Gate-2 review gate writes its `review-nits-<slug>.md` via
`integration-core.ts` `writeReviewNitsObservation` ->
`workFolderPath(cwd, 'observations')`, resolved through the runner BINARY's
`work-layout`. During a rename slice the binary is still the PRE-rename one (the
new `observations -> 'notes/observations'` value only lives on the slice BRANCH,
not yet on main), so the gate writes the note to the pre-rename `work/observations/`
AFTER the agent's `git mv` already emptied it. That recreates a top-level
`work/observations/` the migration is meant to eliminate.

The conductor caught it at Gate-3 and fixed it with a one-file `git mv` on the work
branch (commit `7c75862`), so the MERGED tree is clean.

## Why it is low-priority / self-correcting

- It is a SINGLE runner-generated artifact, not agent error, and not a ledger
  (status) file: `observations/` is a capture bucket that leaves by deletion.
- It self-corrects: once the rename slice lands, the binary's `observations` value
  becomes `notes/observations`, so all future review-nits go to the right place.
- The fix is a trivial deterministic `git mv` at Gate-3.

## Heads-up for the sibling rename slices

The SAME one-file artifact will appear on any rename slice whose Gate-2 runs while
the binary is still pre-rename and whose `observations`/terminal folder is being
renamed. In particular `brief-regime-rename-and-dropped-migration` (slice 4) and
the vocabulary cutover may each leave a stray `review-nits-<slug>.md` in the
pre-rename observations folder; expect to re-home it to `notes/observations/` at
Gate-3 (a one-line `git mv` on the work branch), exactly as PR #177's fixup
`7c75862` did.

## Suggested disposition

Keep as a low-priority follow-up. A clean fix would make the review-nits writer
resolve its target folder layout-agnostically for a self-renaming slice (or have
the gate run with the branch's layout), but that is the same binary-vs-branch
class addressed for the done-move in PRs #175/#176 and is not worth a dedicated
change for a single self-healing artifact. The Gate-3 one-file `git mv` is
sufficient.
