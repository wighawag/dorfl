---
title: review-gate non-blocking nits for 'autonomous-path-auto-recovers-already-committed-stranded-branch' (Gate 2 approve)
date: 2026-06-16
status: open
slug: autonomous-path-auto-recovers-already-committed-stranded-branch
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'autonomous-path-auto-recovers-already-committed-stranded-branch' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The slice explicitly required a `## Decisions` block recording (a) the chosen seam, (b) the no-front-gate-ancestry decision, (c) `do --remote` parity, (d) composition with the `humanOnly` `branch-carries-code-not-ledger-status-main-owns-status` PRD, (e) the `already-integrated → CompleteOutcome` mapping. No such block was added to the slice file or the PR/commit message — should the human ratify the choices below from code comments alone, or should the agent be asked to backfill the Decisions block on the next pass?
  (All five decisions ARE captured as inline comments in `complete.ts` and `do.ts` (the `STRANDED-DONE AUTO-RECOVER` block, the `Mutually exclusive with…` line, the two `performDo`/`performDoRemote` comment blocks, the `CompleteOutcome 'already-integrated'` doc line). The information exists; the protocol-shaped artifact does not.)
- Ratify: on the `already-integrated` no-op, `performComplete` returns EARLY before its tail (switch-to-main / ff / delete-branch), so the operator/CI is left on whatever branch HEAD was on at entry rather than being moved to `main`. Is that the intended UX for a re-claimed already-merged slug on the autonomous path, or should the no-op still perform the post-integration cleanup?
  (`complete.ts` ~L607 returns `{outcome: 'already-integrated', exitCode: 0}` immediately; the comment explains 'the work is already integrated and the branch may or may not still exist locally.' For an autonomous re-claim the worktree is typically disposable, so the choice is defensible — but it does diverge from the normal `completed` tail (which switches + deletes), and a future operator-facing `complete` invocation hitting this path would be left on the work branch.)
- Ratify: the front-gate is purely folder-shape (`!onInProgress && !onNeedsAttention && onDone`). If a developer (or a future slice) ever lands a branch tree where `done/<slug>.md` legitimately co-exists with `in-progress/<slug>.md` or `needs-attention/<slug>.md` (a corrupt-ledger shape), the auto-recover does NOT fire and the normal path runs — is that the intended priority, or should the invariant-violation path own that case first?
  (The integration core already has a one-slug-one-folder invariant guard (`core.outcome === 'invariant-violation'` in `complete.ts`) that would catch arbiter-side duplication, but the branch-tree pre-check here silently prefers the build path when ANY of in-progress/needs-attention is present. The slice's CI repro never lands in that shape so behaviour is correct for the targeted incident; just worth a ratification note.)
