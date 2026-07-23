---
title: 'Reconcile the stale "routed to work/needs-attention/" user-facing strings to the lock state:stuck model'
slug: reconcile-stuck-notice-strings-to-lock-state-model
blockedBy: []
covers: []
---

## What to build

After the per-item-lock cutover (`cutover-needs-attention-becomes-lock-stuck-recovery-surface`),
a stuck bounce is a LOCK AMEND (`state: stuck` on the item's lock ref), NOT a
`git mv` into a `work/needs-attention/` folder. The bounce seam itself is already
cut over (`do.ts` calls `applyNeedsAttentionTransition`, the lock-amend seam),
but a handful of USER-FACING strings in `do.ts` still tell the human the item was
"routed to work/needs-attention/", a folder path that no longer exists. This task
is a PROSE-ONLY reconcile of those `do.ts` strings (and the one stale `do.ts`
comment beside them) so the message matches reality (the item is marked stuck on
its lock). No behaviour change, no machinery touched.

This is deliberately scoped SMALL and separate from the larger dead-folder-reader
removal (see the sibling task
`finish-needs-attention-folder-cutover-remove-legacy-recovery-readers`): this one
only edits human-visible `do.ts` message text and is safe to land on its own.

SCOPE FENCE (why `cli.ts` is NOT here): the `requeue` command help in `cli.ts`
ALSO names a `work/needs-attention/<slug>.md` file, but that help text is
ACCURATELY describing current code: the requeue resolver (`returnToBacklog` in
`needs-attention.ts`) STILL has a live `needs-attention/` probe arm. Whether that
help should be reworded depends on whether the sibling task KEEPS or REMOVES that
probe, so the `cli.ts` requeue help is the sibling task's job, NOT this one. This
task touches `do.ts` ONLY (the build-failure notices, which fire purely as
post-bounce reporting of the lock amend and depend on no folder probe).

IMPORTANT vocabulary (verify against the code, a sibling sweep finding had a
rename direction backwards): `needs-attention` is the CURRENT name for the stuck
STATE; it now lives as the per-item lock `state: stuck` (WORK-CONTRACT.md
"`needs-attention` - the post-claim 'stuck' state (the lock `state: stuck`)").
So the fix is NOT to delete the word "needs-attention", it is to stop describing
it as a FOLDER/PATH the user can open. Phrase it as the lock state, e.g. "marked
stuck on its lock (reason: ...)".

## Acceptance criteria

- [ ] The `do.ts` build-failure notice strings that read "routed it to
      work/needs-attention/ (...)" / "could not route to work/needs-attention/
      (...)" (currently around lines 1432/1434/1547/1550/2432/2434, locate by the
      string, not the number) describe the lock-state outcome instead (the item
      was marked stuck on its lock, or the stuck-mark failed), preserving the
      existing interpolations (`report.fragment`, `routed.reasonNotMoved`,
      `reason`).
- [ ] The stale `do.ts` COMMENT beside those notices (currently ~line 1415,
      "`git mv` the item to needs-attention/ with the reason in the body ...") is
      reconciled too: the bounce is a lock amend, not a `git mv`, so the comment
      should describe the lock-amend reality.
- [ ] `cli.ts` is NOT touched by this task (the `requeue` help is the sibling
      reader-removal task's job; see the scope fence above). A diff shows no
      change to `cli.ts`.
- [ ] No CODE path, type, or control flow is changed: this is `do.ts` string +
      comment text only. A diff shows only string-literal and comment edits in
      `do.ts`.
- [ ] Deliberately-HISTORICAL references are LEFT ALONE: ADR-§12 citations, the
      "there is NO `git mv` to needs-attention/" negative framing in
      `needs-attention.ts`, and `run.ts`'s `state: 'needs-attention'` JOB-record
      field (a per-run outcome counter, unrelated to the work-item folder) are
      NOT touched.
- [ ] Existing tests still pass; if any test asserts on the EXACT old message
      text, retarget that assertion to the new wording (do not weaken it to a
      substring that hides the change).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green (run
      `pnpm format` first).

## Blocked by

- None, can start immediately. (Independent of the sibling reader-removal task;
  either can land first.)

## Prompt

Goal: make the user-facing "stuck" messages tell the truth. After the per-item
lock cutover, a build-failure bounce records `state: stuck` on the item's lock
ref (the lock-amend seam `applyNeedsAttentionTransition`); it does NOT move the
item into a `work/needs-attention/` folder (that folder is retired). But several
human-visible strings still say "routed it to work/needs-attention/", pointing
the user at a path that does not exist. Reconcile ONLY those strings.

Vocabulary you must get right (verify against the code, do not trust prose
blindly): `needs-attention` is the CURRENT word for the stuck STATE, now carried
as the per-item lock `state: stuck` (see WORK-CONTRACT.md). The bug is that the
strings describe it as a FOLDER. Do NOT remove the concept or the word where it
correctly names the state; just stop implying a folder/path. Suggested phrasing:
"marked '<slug>' stuck on its lock (reason: ...)" and, for the failure branch,
"could not mark '<slug>' stuck (...)".

Where to look (by string, re-confirm line numbers, they drift):
- `packages/dorfl/src/do.ts`: the build-failure notice template literals around
  1432/1434/1547/1550/2432/2434 ("... routed it to work/needs-attention/ ..." /
  "... could not route to work/needs-attention/ ..."). These are produced right
  after the `applyNeedsAttentionTransition` (lock-amend) call, so the folder
  wording is the stale part; keep the `report.fragment` / `routed.reasonNotMoved`
  / `reason` interpolations. Also reconcile the adjacent stale comment (~1415)
  that still says "`git mv` the item to needs-attention/".
- Do NOT edit `cli.ts`. The `requeue` help there names a needs-attention file
  because the requeue resolver STILL probes that folder; rewording it is the
  sibling reader-removal task's call (it depends on whether that probe survives).

Do NOT touch: `run.ts`'s `updateJobRecord({state: 'needs-attention', ...})` (a
JOB-record state for the `jobs` dashboard, unrelated to the work-item folder);
the deliberately-historical "no `git mv` to needs-attention/" comments; any ADR
citations. This is text-only; no control flow, types, or folder probes change
(that is the sibling reader-removal task's job).

Seam to test at: if a test pins the exact failure-notice text, update it to the
new wording (keep it strict). Otherwise no new test is needed for a string-only
change; the build/test/format gate is the floor.

FIRST, check this task against current reality (launch snapshot, may have
drifted): confirm the `do.ts` strings still say "work/needs-attention/" and that
the bounce is the lock-amend seam. If the strings are already reconciled, this
task is overtaken, say so and discharge rather than inventing work.

Done = the listed `do.ts` strings + the adjacent stale comment describe the
lock-stuck reality, `cli.ts` is untouched, no code/types/flow changed, historical
references and `run.ts`'s job-state untouched, and
`pnpm -r build && pnpm -r test && pnpm format:check` is green.

Provenance: sidecar rebuild sweep finding C, source observation
`stale-needs-attention-folder-prose-in-ledger-write-and-do-after-lock-cutover-2026-06-22`;
diagnosis confirmed (2026-06-25) that no live code writes the
`work/needs-attention/` folder, so these strings are stale, not describing live
behaviour.

---

### Claiming this task

```sh
dorfl claim reconcile-stuck-notice-strings-to-lock-state-model --arbiter <remote>
git fetch <remote> && git switch -c work/reconcile-stuck-notice-strings-to-lock-state-model <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/reconcile-stuck-notice-strings-to-lock-state-model.md work/tasks/done/reconcile-stuck-notice-strings-to-lock-state-model.md
```
