---
title: review-gate non-blocking nits for 'continue-conflict-resurface-from-needs-attention' (Gate 2 approve)
date: 2026-06-11
status: open
slug: continue-conflict-resurface-from-needs-attention
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'continue-conflict-resurface-from-needs-attention' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the re-surface move-only commit uses --allow-empty (and skips git mv on the self-move) so an unchanged-reason continue-conflict re-route still produces a stable, pushable move-only tip instead of erroring on an empty commit. OK as the intended idempotent re-surface behaviour?
  (src/needs-attention.ts routeToNeedsAttention: alreadyInNeedsAttention guards both the skipped `git mv A A` and the added --allow-empty. publishSurfaceCommit reads placement from the commit TREE, so the empty commit still republishes the surface correctly. Not specified by the slice (the slice only asked it not be a NO-OP and not thrash).)
- Ratify: appendReasonBlock now silently skips appending when the body already ends with an identical reason block (idempotency guard), so repeated identical bounces do not accumulate duplicate '## Needs attention' blocks in the item body. Intended user-visible behaviour?
  (src/needs-attention.ts: `if (base.endsWith(block.replace(/\s*$/, ''))) return;` plus the new shared reasonBlockText() helper. Goes slightly beyond the literal 'no thrash' ask but is correct and desirable; the new test asserts exactly one heading remains.)
- Ratify: the not-found refusal message changed from '...not in-progress?' to '...not claimed?' and now also lists work/needs-attention/<slug>.md as a probed source. Acceptable user-facing wording change?
  (src/needs-attention.ts routeToNeedsAttention reasonNotMoved string. Cosmetic and accurate; flagged only because it alters a user-visible error string.)
- Style: wrap the load-bearing `gitIn(['merge-base','--is-ancestor',keptTip,newTip],repo)` in an explicit expect(...) so it is not mistaken for a dead call and removed, silently dropping the fast-forward check.
  (test/centralise-bounce-branch-push.test.ts. gitIn throws on non-zero exit so it IS an assertion, but it is the only unwrapped one among expect(...) siblings.)
