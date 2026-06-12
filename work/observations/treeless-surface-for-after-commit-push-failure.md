---
title: The after-commit continue-push-failure surface routes through the cwd-bound routeToNeedsAttention (option b), NOT the tree-less #89 ledgerWrite.applyTransition CAS — extend the surface direction to the tree-less CAS so no worktree/checkout is re-materialised
date: 2026-06-12
status: open
slug: stale-lease-retry-all-push-sites-and-treeless-surface
---

## The signal

The `stale-lease-retry-all-push-sites-and-treeless-surface` slice's Part B
permitted two options for surfacing an after-commit continue-path push-failure to
needs-attention:

- (a) PREFERRED — route the `in-progress/ → needs-attention/` ledger move through
  the tree-less `#89` (`requeue-treeless-transition`) `ledgerWrite.applyTransition`
  CAS, the SAME primitive `requeue` uses for `needs-attention/ → backlog/`, so the
  surface touches NO worktree (the work is already committed on the branch; only a
  one-file folder-move + reason needs to reach main).
- (b) FALLBACK — surface via the EXISTING cwd-bound `routeToNeedsAttention`
  (`src/needs-attention.ts`) against whatever clone/worktree the failing path
  already has in hand, ONLY IF a follow-up observation is filed for the tree-less
  surface.

This slice took **option (b)**. The three after-commit surface sites all route
through the cwd-bound `applyNeedsAttentionTransition` / `routeToNeedsAttention`:

- `src/do.ts` (in-place `performDo` step 4b) + `src/run.ts` (`runOneItem` step 2b)
  call `applyNeedsAttentionTransition` with `cwd` = the job worktree / checkout
  (HEAD on the work branch).
- `src/start.ts` (`routeContinuePushFailure`) cuts a throwaway temp branch off
  `<arbiter>/main` and calls `applyNeedsAttentionTransition` with `pushBranch:false`,
  restoring afterward.

So a worktree/checkout IS in hand at each site (the continue path already
materialised one before the push failed) — no NEW worktree is re-materialised, but
the surface is NOT tree-less in the `#89` sense (it does not go through
`ledgerWrite.applyTransition`'s no-checkout CAS).

## Why it matters / fix direction

The SURFACE direction (`in-progress/ → needs-attention/`) is structurally the same
one-file ledger move `#89` made tree-less for the REQUEUE direction
(`needs-attention/ → backlog/`). Extending `routeToNeedsAttention` (or adding a
sibling) to drive the surface move through `ledgerWrite.applyTransition` would let
a future failing path surface a stuck slice WITHOUT needing a checkout at all (the
work is already committed on the branch; only the `.md` git-mv + reason needs to
reach main via the leased CAS fast-forward of a throwaway-off-main ledger commit).
That is the preferred no-worktree outcome the slice flagged but deferred. The
`#89` recipe (`needs-attention.ts` ~L564–604) is the reference: fetch
`<arbiter>/main`, `expectedBase` = the fetched main sha, commit the
`git mv in-progress→needs-attention` + reason onto a THROWAWAY ref cut off the
fetched main, `applyTransition({localBranch:<throwaway>, expectedBase, head})`,
drop the throwaway.

Low priority: option (b) already fixes the observed silent-strand bug (the item now
surfaces to needs-attention with the green branch recoverable). This is the
deferred refinement, not a defect.
