---
title: advance surfaces a stuck lock as a question, and an apply pass self-clears it
status: idea
created: 2026-06-18
relatesTo: [ledger-status-per-item-lock-refs, advance-rung-surface, advance-rung-apply, advance-sidecar-contract, surface-questions-skill]
---

## The idea

Once `needs-attention` is the per-item lock `state: stuck` (PRD
`ledger-status-per-item-lock-refs`, decision (i+): the lock entry carries the full
reason prose + any agent-surfaced questions), make a STUCK lock a first-class INPUT
to the autonomous `advance` loop, so a human's whole interaction with a stuck item
collapses to "answer a question":

- The advance **surface** rung renders a stuck lock's reason + questions into a
  `work/questions/<entry>.md` sidecar (the existing surface-questions mechanism),
  exactly as it already surfaces a `needsAnswers` item. Even a degenerate question
  ("this item is stuck for <reason>; unstick it? resume / requeue / release") is
  enough.
- The human answers the sidecar (the only thing they have to do).
- The advance **apply** rung consumes the answer and performs the LOCK TRANSITION
  automatically: `stuck -> active` (resume), `stuck -> (released)` (requeue /
  release), per the answer. No human runs `resume` / `requeue` / `release-lock` by
  hand; the apply pass clears the lock.

This makes stuck-state not a passive inbox a human must go drain, but a self-
surfacing, self-clearing rung of the loop — the `advance`/`advance-loop` philosophy
(the human's only job is to answer).

## Why it composes cleanly

- The lock `stuck` state + the `reason`/questions on the entry are landed by the
  `ledger-status-per-item-lock-refs` slices (esp. the 9b recovery surface).
- The surface/apply rungs already exist (`advance-rung-surface`,
  `advance-rung-apply`, `advance-sidecar-contract`, `surface-questions-skill` in
  `work/done/`); this EXTENDS them to also read/write the lock `stuck` state, it does
  not invent new machinery.
- The lock transitions it needs (`resumeItemLock` / `requeueItemLock` /
  `releaseItemLock`) are the slice-2 state-machine transitions, already built.

## The one subtlety to get right (so a future slicer does not re-derive it wrong)

The apply rung clearing a stuck lock is a TREE-LESS op (it amends/deletes the lock
ref, no inner `do`), so under the option-(a) advance-tick rule
(`advancing-acquires-unified-lock`) the apply rung legitimately takes the unified
lock for tree-less rungs. BUT the item it operates on is ALREADY lock-held (it is
stuck) — so the apply-on-stuck path is a TRANSITION on the existing held entry
(`stuck -> active` / `stuck -> released` via `resume`/`requeue`/`release`), NOT a
create-only `acquire` (which would lose against the held stuck lock). Use the
existing amend/release transitions, not a fresh acquire.

## Scope note

NOT part of `retire-transient-folders-and-drop-rebase` (#9 / 9a-9d), which only
finishes the substrate cut-over (stuck = lock state, human-driven recovery verbs,
folders retired, drop-rebase gone). This idea is the NEXT layer: question-driven,
apply-cleared stuck recovery. Promote to a PRD/slice after the lock substrate
fully lands.
