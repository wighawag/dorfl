---
title: Finish the needs-attention folder cutover - remove the orphaned legacy folder-recovery readers/transitions
slug: finish-needs-attention-folder-cutover-remove-legacy-recovery-readers
blockedBy: []
covers: []
---

## What to build

The per-item-lock cutover moved the stuck state OFF the `work/needs-attention/`
folder and ONTO the lock ref (`state: stuck`). A prior task already removed the
dead READ-surface (`resolveFromNeedsAttention`, `readNeedsAttentionItems`, the
`ledger-read` folder arm, `status`'s always-empty field, all verified GONE). What
REMAINS orphaned is the folder-RECOVERY transition code: paths that still PROBE
`work/needs-attention/` as a SOURCE folder, even though nothing writes those
files anymore. This task finishes the NEEDS-ATTENTION half of the cutover by
removing those legacy recovery readers/transitions, after proving each is
genuinely unreachable.

SCOPE FENCE (needs-attention only; `in-progress` is NOT bundled in):
The diagnosis below was run for the `work/needs-attention/` folder specifically.
The stray `work/in-progress/` folder is a SEPARATE, larger, and SEPARATELY-staged
concern: `start.ts` still makes a LIVE FOLDER-BASED decision on `in-progress`
(the `--resume` refusal, `start.ts` ~L125 "the decision is folder-based"), so it
is NOT a co-equal throwaway and has NOT been diagnosed the same way. DO NOT remove
`in-progress` folder probes in this task. If you confirm (with the same writer
hunt) that `in-progress` is also fully unwritten, RECORD that as a finding /
follow-up observation for its own task; do not expand this task's scope into
`start.ts`/`intake.ts` recovery logic.

Diagnosis already done for NEEDS-ATTENTION (2026-06-25, RE-VERIFY before deleting):
- No live code WRITES `work/needs-attention/<slug>.md` as a file (the bounce is a
  lock amend; claim leaves the body in `tasks/backlog/`). Grep for an actual
  `git mv`/writeFile INTO that folder returns only comments and the
  `source`-parameterised done-move (whose source is never `needs-attention` once
  nothing writes it there).
- So the readers that probe `needs-attention/` can no longer match in the normal
  flow. `work-layout.ts` itself documents them as "legacy/recovery readers" and
  the states as "really lock-ref state, NOT durable folders".

This is NOT a uniform grep-and-delete. It is a judgement-heavy cleanup: some
probes are pinned by tombstone tests, one removal changes a default fallback
branch, there is a same-name field that must NOT be touched, and some references
are deliberately-historical prose that must STAY. Read the per-area notes.

The end state: the live stuck/recovery surface is unchanged (stuck items still
surface via lock refs; a good-but-stuck item is still recoverable), but the dead
`needs-attention/`-as-folder recovery probes are gone, with each kept/cut choice
recorded. `in-progress/` probes are deliberately LEFT for a separate task (see
the scope fence).

## Acceptance criteria

- [ ] REPO-WIDE CLOSURE (the real definition of done): no EXECUTABLE folder probe
      of `work/needs-attention/` remains anywhere in `packages/dorfl/src/`. A
      probe = an `existsSync`/`source`-resolution/`workItemPath(..., 'needs-attention', ...)`
      read that can drive control flow. The probe sites are spread across MORE
      files than the named seams below (verified 2026-06-25:
      `complete.ts`, `do.ts`, `status.ts`, `recover-isolated.ts`, `integrator.ts`,
      and `integration-core.ts`); audit ALL of them, not only the headline ones.
      EXCLUDED from this closure (must NOT be touched): `run.ts`'s `needsAttention`
      job counter, deliberately-historical comments/ADR citations, and ALL
      `in-progress` probes (out of scope per the scope fence).
- [ ] `complete.ts`'s source-folder resolution no longer falls back to a
      `work/needs-attention/` FILE probe that cannot be produced: the
      `existsSync(needsAttention)` / `onNeedsAttention` -> `source: 'needs-attention'`
      branch (and the `complete-from-needs-attention` re-gate-from-folder path) is
      either removed or proven still-reachable. If removed, the resolution's
      DEFAULT/else branch is made explicit and correct (decide: refuse with
      "nothing to complete", or fall to `tasks-backlog`) and that choice is
      RECORDED. (This is a behavioural decision, not a mechanical delete -
      justify it.) Leave its `onInProgress` arm alone (in-progress is out of scope).
- [ ] The `needs-attention.ts` requeue/return-to-backlog resolver's folder probe
      (`['tasks-backlog','in-progress','needs-attention']` source search) has its
      `needs-attention` arm removed (proven dead) or documented if kept; the
      `in-progress` and `tasks-backlog` arms are LEFT as-is (in-progress is out of
      scope; `tasks-backlog` is the live source). Once the `needs-attention` arm
      is gone, also reconcile the `cli.ts` `requeue` help (~L3207) so it no longer
      claims recovery from a `work/needs-attention/<slug>.md` file (this is the
      `cli.ts` edit the sibling string task deliberately deferred to here).
- [ ] `integration-core.ts`'s `needs-attention/` recovery/re-gate branches are
      reconciled the same way (removed if dead, documented if kept). The live
      done-move (`git mv work/<source>/<slug>.md -> work/done/<slug>.md`) and the
      `reconcileDoneMoveAgainstArbiter` ghost-removal are NOT broken.
- [ ] SAME-NAME COLLISION respected: `run.ts`'s `updateJobRecord({state:
      'needs-attention', ...})` and any `RunOnceResult.needsAttention` outcome
      counter are a JOB-record / per-run-tally concern, UNRELATED to the work-item
      folder. They are UNTOUCHED; a diff of `run.ts` shows no change to them.
- [ ] Deliberately-HISTORICAL references are KEPT, not grep-deleted: ADR-§12
      citations, the "there is NO `git mv` to needs-attention/" negative framing
      in `needs-attention.ts`, and the `work-layout.ts` notes explaining the
      transient states are lock-ref state. Removing correct history just to empty
      a grep is a FINDING, not done.
- [ ] `in-progress` is UNTOUCHED: no `work/in-progress/` probe is removed or
      altered in this task (it is a separate concern; `start.ts` makes a live
      folder-based decision on it). If you find `in-progress` is also fully
      unwritten, capture that as a follow-up observation/task, do not act on it
      here.
- [ ] No BEHAVIOUR change to the live stuck surface: `dorfl status`/`scan` still
      list stuck items from the lock refs; a good-but-stuck item is still
      completable and a give-up item still requeues. The behavioural tests that
      pin these (`complete-from-needs-attention.test.ts`,
      `requeue-treeless-transition.test.ts`,
      `needs-attention-as-stuck-lock-state.test.ts`, the relevant
      `integration-core.test.ts` cases) are retargeted to the lock model where
      they set up a folder fixture, NOT deleted to make the build pass - each must
      still assert its real capability.
- [ ] Tombstone tests (any that intentionally assert "the folder stays empty /
      is retired") are handled by an explicit keep-or-retarget DECISION, recorded;
      none is left asserting on a removed symbol.
- [ ] Non-obvious in-scope decisions are recorded: if a choice is hard to reverse
      and surprising (the `complete` default-branch behaviour, deleting a recovery
      capability), write it as an ADR in `docs/adr/`; otherwise a `## Decisions`
      note in the done record. An un-recorded keep/cut is a review finding.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green (run
      `pnpm format` first). No `.github/workflows/*` file touched.

## Blocked by

- None, can start immediately. (Independent of the sibling
  `reconcile-stuck-notice-strings-to-lock-state-model`; either can land first.)

## Prompt

You are FINISHING a migration the codebase started but did not complete. The
per-item-lock cutover (`cutover-needs-attention-becomes-lock-stuck-recovery-surface`,
`needs-attention-as-stuck-lock-state`, and the already-done
`remove-dead-needs-attention-folder-readers-after-lock-cutover`) moved the
"stuck / needs-attention" state OFF a `work/needs-attention/` folder and ONTO the
per-item lock ref (`state: stuck`), and moved claim OFF writing `work/in-progress/`.
The READ surface was already cleaned. What is LEFT is the orphaned folder-RECOVERY
code: `complete.ts` / `integration-core.ts` / `needs-attention.ts` (and a wider
set of files, see WHERE TO LOOK) still PROBE `work/needs-attention/` as a SOURCE
folder, even though nothing writes those files anymore. Remove the genuinely-dead
needs-attention probes and document any you keep. SCOPE FENCE: `work/in-progress/`
is OUT of this task (a separate, undiagnosed concern with a LIVE folder-based
decision in `start.ts`); do not remove its probes, even though it looks similarly
dead - capture it as a follow-up if you confirm it is unwritten.

GROUND TRUTH to confirm first (do NOT trust this snapshot blindly - a sibling
sweep finding was wrong about a rename direction, so verify):
- Nothing WRITES `work/needs-attention/<slug>.md` as a file. Confirm: grep for a
  real `git mv`/`writeFile` INTO that folder and expect only comments (the
  `source`-parameterised done-move never sources `needs-attention` once nothing
  writes it there). The bounce is `applyNeedsAttentionTransition` (a lock amend);
  claim leaves the body in `tasks/backlog/`. (Do NOT extend this deletion to
  `work/in-progress/` - that is a separate task; see the scope fence.)
- Therefore `complete.ts`'s `existsSync(needsAttention)` fallback (the final else
  of its `source` chain) and the `complete-from-needs-attention` re-gate-from-
  folder path can no longer fire in the normal flow. Prove it before deleting,
  and decide what the resolution's default branch should be once the dead arm is
  gone (refuse vs fall to `tasks-backlog`).
- `needs-attention` is CURRENT vocabulary for the stuck STATE (WORK-CONTRACT.md);
  the word stays where it names the lock state. You are removing the FOLDER
  implementation, not the concept.

WHERE TO LOOK (by symbol/concept, line numbers drift). The `needs-attention`
folder-probe sites are spread WIDER than the headline seams - audit the FULL set,
not just the obvious ones (verified 2026-06-25 these carry executable
needs-attention probes): `complete.ts` (the `onNeedsAttention` /
`source: 'needs-attention'` chain + the `complete-from-needs-attention` recovery
doc-comment), `needs-attention.ts` (the requeue resolver's
`['tasks-backlog','in-progress','needs-attention']` probe - remove the
needs-attention arm only), `integration-core.ts` (the needs-attention re-gate
branches), `do.ts`, `status.ts`, `recover-isolated.ts`, `integrator.ts`. Also the
folder-set constants in `work-layout.ts` / `item-path.ts` and the export surface
`index.ts`, and the `cli.ts` requeue help (~L3207). The repo-wide grep
`grep -rn "needs-attention" packages/dorfl/src/` is your CLOSURE check (every
remaining hit must be either historical prose, the `run.ts` counter, or an
in-progress reference). Behavioural tests: `complete-from-needs-attention.test.ts`,
`requeue-treeless-transition.test.ts`, `needs-attention-as-stuck-lock-state.test.ts`,
`integration-core.test.ts`, `needs-attention.test.ts`.

FOUR traps that will make this go wrong if ignored:
1. NAME COLLISION: `run.ts` has its OWN `needsAttention` (a per-run outcome
   counter `needsAttention: number`, and `updateJobRecord({state: 'needs-attention'})`
   job state). It is UNRELATED to the work-item folder and must stay untouched.
   Verify each `needsAttention` hit's MEANING before touching it.
2. IN-PROGRESS IS OUT OF SCOPE: this task removes the `needs-attention` folder
   probes ONLY. `work/in-progress/` is a separate concern with LIVE folder-based
   decisions (`start.ts`); do not remove its probes here, even though it looks
   similarly dead. Capture it as a follow-up if you confirm it is unwritten.
3. TOMBSTONE / BEHAVIOURAL TESTS: tests that set up a `work/needs-attention/`
   fixture are pinning a real capability (recover a stuck item) or guarding "the
   folder stays empty". Retarget them to the lock model so they still assert the
   capability; do NOT delete a test just to make the build green.
4. HISTORICAL PROSE: keep the "no `git mv` to needs-attention/" negative framing,
   ADR-§12 citations, and `work-layout.ts`'s lock-ref-state explanations. A grep
   that hits zero is NOT the goal; correct history must survive.

If you find a probe that is NOT provably dead (something CAN still produce the
file it reads), do NOT force the deletion: STOP and route to needs-attention
(mark the lock `state: stuck`) with the specific reachable producer as the
reason - that means the cutover is less complete than this task assumes.

RECORD the non-obvious decisions: the `complete` default-branch behaviour after
the dead arm is removed, and any recovery capability you cut. ADR if hard to
reverse and surprising; otherwise a `## Decisions` note.

Done = the dead folder-recovery probes are gone, every kept probe is documented
as an intentional legacy reader, the live stuck/recover/requeue capabilities are
unchanged and still test-pinned (against the lock model), `run.ts`'s job-state
and historical prose are untouched, and
`pnpm -r build && pnpm -r test && pnpm format:check` is green.

Provenance: sidecar rebuild sweep finding C and the human's "should we not finish
the move and remove transitions code?"; diagnosis 2026-06-25 confirmed no live
writer of the needs-attention folder (in-progress is a separate, undiagnosed
follow-up). Companion to the prose-only
`reconcile-stuck-notice-strings-to-lock-state-model`. Builds on the careful
precedent set by done task
`remove-dead-needs-attention-folder-readers-after-lock-cutover` (same judgement
traps).

---

### Claiming this task

```sh
dorfl claim finish-needs-attention-folder-cutover-remove-legacy-recovery-readers --arbiter <remote>
git fetch <remote> && git switch -c work/finish-needs-attention-folder-cutover-remove-legacy-recovery-readers <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/finish-needs-attention-folder-cutover-remove-legacy-recovery-readers.md work/tasks/done/finish-needs-attention-folder-cutover-remove-legacy-recovery-readers.md
```
