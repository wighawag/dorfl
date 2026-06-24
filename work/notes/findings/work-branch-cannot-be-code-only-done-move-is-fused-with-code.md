---
title: The "make work branches code-only to dissolve the conflict class" root-fix alternative is IMPOSSIBLE — the done-move is FUSED into the code commit by construction (that IS the atomicity invariant), so slices 1+2 treat the right thing, not a symptom
date: 2026-06-15
status: verified
---

## Why this finding exists

While reviewing the three dorfl fix slices (continue-rebase auto-resolve, mirror write-through, fail-fast gate), the question arose: are these slices COMPENSATING for a deeper design flaw (bookkeeping `.md` moves living on the work branch), such that a more radical root fix — "make the work branch carry ONLY code, never any `work/**` move" — would dissolve the whole rebase-conflict class instead of reconciling it at two sites? This finding records the answer (NO, that alternative is impossible) with the evidence, so it is not re-litigated.

## Verified facts (against `integration-core.ts` + the live commit history)

1. **The done-move is FUSED with the code, not a separate commit.** `integration-core.ts` (~L718-745) does `git mv work/<source>/<slug>.md → work/done/<slug>.md` and then `git add -A` + ONE `git commit`, which folds **the agent's uncommitted code + the `.md` move into a SINGLE atomic commit**. Verified across the last 5 `; done` commits on the arbiter: EVERY one contains code files AND exactly 2 `work/` files (the rename source+dest) in the same commit (e.g. `f7d4c3f`: 7 code + 2 work/; `8eb7d8a`: 1 code + 2 work/). There is NO standalone done-move commit to "remove from the branch".

2. **This fusion IS the atomicity invariant.** `done/<slug>.md` reaching `main` WITHOUT the code is impossible precisely because they are the same commit — it lands via the merge or not at all. So the done-move MUST be on the branch; moving it "off" would BREAK the invariant. The PRD slicing move (`slicing→prd-sliced` + emitted backlog files) is the same shape via the `IntegrationLifecycle.stage()` seam.

3. **The ONLY separate, on-branch, move-only commits are the BOOKKEEPING surfaces.** Enumerating every commit touching ONLY `work/*.md` across 300 commits, the kinds are: `surface needs-attention on main` (16) and `return to backlog` (11) — both TREE-LESS on `main` (never on a work branch, so never rebased, never a self-conflict source); `route to needs-attention` (4) — the ON-BRANCH gate-failed surface (`applyNeedsAttentionTransition`), which IS the conflict source; plus a handful of one-off human/recovery chores. So the autonomous on-branch move-only class is EXACTLY `chore(<slug>): route to needs-attention`.

## Conclusion (why slices 1+2 are the right shape, not symptom-treatment)

- "Make work branches code-only" is a non-starter: the done-move can't be separated from the code (that fusion is the invariant). There is no separate done-move commit to eliminate.
- The real conflict class is narrow and exact: the on-branch `chore(<slug>): route to needs-attention` move-only commits (slice 1 drops them; slice 1 Part 1 stops the gate-failed path committing them on the branch in the first place) plus stale local tracking refs (slice 2's write-through + arbiter-authoritative read).
- The existing `dropMoveOnlySequenceEditor` matcher (`chore(<slug>): route to needs-attention`) is therefore COMPLETE for the autonomous flow — it matches exactly the on-branch move-only commits that exist.

So the three slices target the actual, minimal cause. The deeper "root fix" I worried about does not exist because the architecture ALREADY fuses the load-bearing move (done) with the code, and already makes the OTHER bookkeeping moves tree-less on main — leaving only the gate-failed surface as the one place a bookkeeping move wrongly lands on a branch (slice 1 Part 1) and the stale-ref drift (slice 2).

## Caveat still open (not resolved by this finding)

Slice 1's POST-DROP done-move source resolution remains the one un-traced interaction: after dropping the bookkeeping commits at onboard, the branch is already in `done/`, but `complete.ts` resolves the done-move source as `in-progress`/`needs-attention`. This finding does NOT close that — it is an explicit must-trace-and-test requirement in slice 1. The finding only establishes that the slices' overall SHAPE is correct (not symptom-treatment); the specific post-drop integration path still needs the implementer's verification.
