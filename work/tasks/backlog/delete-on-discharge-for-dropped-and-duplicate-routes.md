---
title: Delete-on-discharge for the dropped/delete/duplicate routes (retire resting-state machinery)
slug: delete-on-discharge-for-dropped-and-duplicate-routes
prd: observation-discharge-by-deletion-self-contained-promotion-and-prd-route
blockedBy: []
covers: [2, 7]
---

## What to build

Make a `dropped`/`delete`/`duplicate` disposition discharge an observation by
DELETION (a standalone commit), and retire the resting-state machinery that
currently leaves a "resolved" note in the inbox.

End-to-end behaviour:

- On the apply rung's `dropped`/`delete` route for an OBSERVATION: `git rm` the
  note instead of appending the `## Recommended: delete` body marker. The delete
  is a STANDALONE commit (there is no spawned artifact for a drop), with the
  REASON recorded in the commit message (git history = archive).
- On the conservative auto-disposition `duplicate` route: same — delete the note
  rather than appending a delete-recommendation marker and stamping `triaged:`.
- Retire ONLY the now-dead resting-state machinery for the DROPPED/DUPLICATE
  routes: the `## Recommended: delete` heading (and the `## Recommended: delete
  (duplicate)` variant) and the `triaged:duplicate` stamp (a deleted note is out
  of the pool by being gone, so the drop-out stamp is redundant once the note is
  deleted).
- DO NOT remove `triaged:keep` / the `keep` disposition machinery
  (`resolveWithKeepMarker`): a `keep` answer is the human deciding to RETAIN the
  observation as a live signal (NOT discharge it), so a kept note legitimately
  stays in the inbox stamped `triaged:keep` and must keep working. Only
  `dropped`/`delete`/`duplicate` discharge by deletion; `keep` is untouched.
- Be careful to scope this to the NOTE (observation) paths — do NOT touch the
  `delete` disposition behaviour for WORK ITEMS (tasks/prds) if that shares
  code; a work item has a terminal FOLDER and is not deleted.

Note: WORK ITEMS keep their existing terminal-folder routing, and `keep`
observations keep their `triaged:keep` resting state; this task changes only how
DROPPED/DUPLICATE NOTES leave — by deletion.

## Acceptance criteria

- [ ] A `dropped`/`delete` answer on an observation `git rm`s the note in a
      standalone commit with the reason in the commit message; no
      `## Recommended: delete` body marker and no `triaged:` stamp remain.
- [ ] The auto `duplicate` route deletes the note (does not leave a
      recommend-delete marker + `triaged:duplicate` resting state).
- [ ] The retired machinery (delete-recommendation heading, note `triaged:`
      stamps) is removed and no longer referenced; work-item `delete`/terminal
      behaviour is unchanged.
- [ ] Tests cover the note-deletion behaviour and assert no resting-state
      residue, mirroring the existing apply-persist / triage-persist tests.

## Blocked by

- None — can start immediately. (Touches the apply-persist drop route and the
  triage-persist duplicate route — file-orthogonal to the promote-writer tasks,
  so it can run in parallel with them.)

## Prompt

> Goal: discharge `dropped`/`delete`/`duplicate` observations BY DELETION and
> retire the resting-state machinery, per the PRD
> `observation-discharge-by-deletion-self-contained-promotion-and-prd-route`
> (Defects A + G/US #2,#7; Resolved decision 4: dropped = standalone commit with
> reason in the message).
>
> Where to look (by concept): the apply rung's terminal-disposition route for an
> observation `delete`/`dropped` (in the apply-persist module — today it appends
> a `## Recommended: delete` heading and leaves the file); the conservative
> auto-disposition `duplicate` path (in the triage-persist module — today it
> appends a delete-recommendation block and stamps `triaged:duplicate`). Replace
> both "recommend + keep" behaviours with a `git rm` of the note, reason in the
> commit message. Leave the `keep` disposition (`resolveWithKeepMarker` /
> `triaged:keep`) ALONE — a kept observation is deliberately retained as a live
> signal and must still rest in the inbox; only dropped/delete/duplicate delete.
>
> CRITICAL scope fence: this is about NOTES (observations), which leave by
> deletion (WORK-CONTRACT.md L59/L65/L74). WORK ITEMS (tasks/prds) have terminal
> FOLDERS (`tasks/cancelled/`, `prds/dropped/`) and are NOT deleted — if the
> `delete` disposition code is shared, branch on item type so you change only the
> observation/note path. Do not regress work-item terminal routing.
>
> Why deletion is allowed here (record if you re-confirm): the apply rung applies
> the human's RATIFIED drop answer, so the delete is human-authored, not the
> agent unilaterally destroying a live signal (maintainer ruling, 2026-06-24).
>
> Seams to test at: the drop/duplicate routes over a throwaway git repo; assert
> the note is gone, the reason is in the commit message, and no `## Recommended:
> delete` / `triaged:duplicate` residue remains. Assert that a `keep` answer
> still stamps `triaged:keep` and retains the note, and that a work-item
> `delete`/terminal case (if reachable through the same code) is unchanged.
>
> Companion: WORK-CONTRACT.md L65/L67 is amended by a SEPARATE docs task to
> sanction deletion-on-apply; you do not edit the protocol doc here.
