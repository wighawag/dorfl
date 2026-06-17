---
title: a kept work/<slug> branch can carry BOTH a stale work/advancing/ marker (inherited from a main that had the lock committed at claim-time) AND an on-branch route-to-needs-attention move — and the continue-rebase drop-set only strips the latter, so a continue/rebase hits a rename/rename ledger conflict
type: observation
status: spotted
spotted: 2026-06-17
slug: work-branch-carries-stale-advancing-marker-and-on-branch-needs-attention-move-not-dropped-on-continue
---

## What was seen

The slice `autonomous-integration-refusal-surfaces-not-strands-in-progress` was
requeued + continued. The continue agent correctly fixed the Gate-2 nit (all
green) but left edits uncommitted; the option-D dirty-continue gate
(`complete.ts` ~L500-515) refused to silently auto-recover, saved the work, and
surfaced to needs-attention. The kept branch tip then carried, in its `work/`
tree, BOTH:

- `work/needs-attention/<slug>.md` (the on-branch route-to-needs-attention
  move-only commit, `Agent-Runner-Bookkeeping: route-to-needs-attention` trailer);
- `work/advancing/slice-<slug>.md` (a STALE advancing-lock marker).

A rebase of the branch onto current `main` then FAILED with a rename/rename
ledger conflict (the slug renamed to `done/` on the branch's history,
`needs-attention/` on main + branch, never reconciled). The SOURCE code diff
applies cleanly onto main (verified) — ONLY the `work/` ledger bookkeeping
conflicts.

## Root cause (VERIFIED against the branch history + code, 2026-06-17)

Two independent things compound:

1. **The on-branch route-to-needs-attention move is BY CURRENT DESIGN** (transient,
   trailer-stamped). `complete.ts`'s option-D surface routes via
   `ledgerWrite.applyNeedsAttentionTransition`, which commits the agent's wip BELOW
   a move-only `git mv → needs-attention/` commit on the work branch, then surfaces
   on main. `drop-bookkeeping-rebase.ts` is DESIGNED to strip that move-only commit
   on the next continue (by the `Agent-Runner-Bookkeeping: route-to-needs-attention`
   trailer). So `needs-attention/` on the branch is the not-yet-removed transient
   the `branch-carries-code-not-ledger-status-main-owns-status` PRD aims to delete;
   it is droppable ON CONTINUE.

2. **The stale `work/advancing/` marker is NOT droppable and NOT design.** The branch
   was cut from base `79c143cb`, whose `main` tree ALREADY contained
   `work/advancing/slice-<slug>.md` (an advancing-lock marker committed onto main
   while the lock was held during the claim — the lock/release thrash visible in the
   branch's ancestry under high contention). The branch inherited that marker into
   its tree and never cleared it. `drop-bookkeeping-rebase.ts` ONLY recognises
   `route-to-needs-attention` commits — it has NO knowledge of advancing markers — so
   on a continue it would strip the needs-attention move but LEAVE the stale
   advancing marker, which then participates in the ledger rename/rename conflict.

So even a proper requeue-CONTINUE (which runs the drop-rebase) would not fully clean
this branch: the advancing marker survives. A plain human rebase (what exposed it)
drops nothing and hits the conflict immediately.

## Why it matters

- A kept branch can become UN-continuable by the normal path because of a stale
  advancing marker the drop-set does not cover — the recovery story
  (`continue`/`complete --isolated`) silently does not clean it.
- It is a second instance of the deeper smell: ledger STATUS files (advancing
  markers, needs-attention moves) living in the branch TREE at all. The
  `branch-carries-code-not-ledger-status-main-owns-status` PRD is the real fix
  (branch = code only; main owns all status via tree-less CAS); until it lands, the
  drop-set is a partial compensation that does not cover advancing markers.

## Suggested directions (decide when slicing — NOT pre-decided)

- SHORT TERM: extend the continue-rebase drop-set (`drop-bookkeeping-rebase.ts`) to
  also strip/clean stale `work/advancing/` markers from the kept branch tree (they
  are never legitimately part of a kept branch's code), OR have the advancing-lock
  acquire NOT commit its marker into a tree that a claim then branches from.
- ROOT FIX: land `branch-carries-code-not-ledger-status-main-owns-status` so NO
  ledger-status file (advancing OR needs-attention) is ever committed on a work
  branch — main owns status via tree-less CAS, the branch is pure code. This makes
  the drop-set unnecessary and this whole class of rename/rename ledger conflict
  impossible.
- Tie-in: the advancing markers being committed onto `main` at all is also what
  couples them to the contended `main` CAS — see
  `work/observations/advancing-lock-cas-false-conflicts-on-shared-main-ref-under-high-parallelism.md`.
  A per-ref lock redesign (markers OFF main) would remove BOTH the contention AND
  this stale-marker-on-branch inheritance.

## Refs

- Branch `work/slice-autonomous-integration-refusal-surfaces-not-strands-in-progress`
  tip: `work/advancing/slice-<slug>.md` + `work/needs-attention/<slug>.md` both in tree;
  base `79c143cb` already carried the advancing marker.
- `src/complete.ts` ~L500-540 (option-D dirty-continue surface via
  `applyNeedsAttentionTransition`).
- `src/drop-bookkeeping-rebase.ts` (drops ONLY `route-to-needs-attention` commits by
  trailer; no advancing-marker handling).
- `src/advancing-lock.ts` (commits `work/advancing/<entry>.md` onto main during the
  lock).
- PRD `branch-carries-code-not-ledger-status-main-owns-status` (the root fix; not
  fully landed).
