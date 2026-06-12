---
title: treeless-surface-for-after-commit-push-failure — drive the after-commit continue-push-failure SURFACE (`in-progress/ → needs-attention/`) through the tree-less `#89` `ledgerWrite.applyTransition` CAS (the SAME no-checkout primitive `requeue` uses for `needs-attention/ → backlog/`), instead of the cwd-bound `applyNeedsAttentionTransition`, so a stuck slice surfaces with NO worktree/checkout in hand
slug: treeless-surface-for-after-commit-push-failure
blockedBy: []
covers: []
---

> Self-contained REFINEMENT slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal (discharged into this slice on authoring): `work/observations/treeless-surface-for-after-commit-push-failure.md` (2026-06-12). This is the DEFERRED option-(a) the `stale-lease-retry-all-push-sites-and-treeless-surface` slice (in `done/`) flagged: its Part B took option (b) (cwd-bound surface) ONLY ON CONDITION this follow-up was filed. It is LOW PRIORITY — option (b) already fixed the silent-strand bug; this is the no-worktree polish, NOT a defect fix.

## The gap (verify against current code)

The `#89`/`requeue-treeless-transition` work made the REQUEUE direction (`needs-attention/ → backlog/`) TREE-LESS: it fetches `<arbiter>/main`, builds the one-file ledger move on a scratch index (`read-tree base` → `update-index` the `.md` move → `commit-tree`), points a throwaway local ref at it, and CAS-pushes via `ledgerWrite.applyTransition({localBranch:<throwaway>, expectedBase, head})` — touching NO worktree (recipe in `src/needs-attention.ts` ~L564-686, inside `returnToBacklog`).

The SURFACE direction (`in-progress/ → needs-attention/`) for an AFTER-COMMIT continue-push-failure is structurally the SAME one-file ledger move, but it still goes through the CWD-BOUND `applyNeedsAttentionTransition` / `routeToNeedsAttention` (option b). Verify the three after-commit surface sites:

- `src/start.ts` `routeContinuePushFailure` (~L781-815): cuts a throwaway temp branch off `<arbiter>/main`, calls `applyNeedsAttentionTransition({cwd, …, pushBranch:false})`, restores afterward — so it ALREADY avoids re-materialising a fresh worktree, but it still drives the move through the cwd-bound seam (needs a checkout in hand), not the tree-less `applyTransition` CAS.
- `src/do.ts` continue-push-failure route (~L681-687, the `tree.continuePushFailure !== undefined` branch) + `src/run.ts` `runOneItem` step 2b: call `applyNeedsAttentionTransition` with `cwd` = the job worktree / checkout (HEAD on the work branch).

The work is ALREADY committed on the branch at each site; only the `.md` git-mv + reason needs to reach `main`. So the surface NEEDS no worktree — yet it uses the cwd-bound path. That is the structural inconsistency: `#89` made the requeue move tree-less, but the sibling surface move was left cwd-bound.

## What to build

Extend the tree-less ledger-move primitive to the SURFACE direction so an after-commit continue-push-failure surfaces WITHOUT a checkout, reusing the `#89` mechanism rather than inventing a second.

1. **Add a tree-less SURFACE transition** (`in-progress/ → needs-attention/`, with the reason appended to the item body) that mirrors `returnToBacklog`'s tree-less recipe (`src/needs-attention.ts` ~L564-686): given `{cwd (origin source only), slug, reason, arbiter, env}`, fetch `<arbiter>/main`, `expectedBase = rev-parse <arbiter>/main`, build the one-file move on a SCRATCH INDEX (`read-tree base` → `update-index --force-remove work/in-progress/<slug>.md` → `update-index --add --cacheinfo` the same blob (with the reason appended to its body) at `work/needs-attention/<slug>.md`) → `commit-tree` (threading the caller's ambient identity for attribution) onto a THROWAWAY ref cut off `base` → `applyTransition({localBranch:<throwaway>, expectedBase: base, head})` → drop the throwaway ref. Refetch-and-retry on a contention rejection exactly as the requeue path does. Decide in a `## Decisions` block whether this is a new sibling fn in `needs-attention.ts` or a parameterisation of the existing tree-less plumbing (prefer FACTORING the shared scratch-index/commit-tree/applyTransition core so requeue-direction and surface-direction share ONE tree-less mechanism, not two copies).
2. **Route the after-commit continue-push-failure surface sites onto it.** `start.ts routeContinuePushFailure`, the `do.ts` `tree.continuePushFailure` branch, and `run.ts` step 2b call the new tree-less surface instead of the cwd-bound `applyNeedsAttentionTransition`. These are PROVABLY ledger-only surfaces — `routeContinuePushFailure` already calls the cwd path with **`pushBranch: false`** (`src/start.ts` ~L817, comment: "the recoverable kept work/<slug> is already on the arbiter") and wraps it in a `try { git switch <temp> … } finally { git switch <startRef> }` dance. The tree-less path ELIMINATES that temp-branch switch-and-restore entirely: the recoverable `work/<slug>` is already on the arbiter (the FAILED push was of the rebased tip; the prior kept branch is intact on the arbiter — the durable work is safe), so the surface is PURELY the one-file ledger `.md` move + reason, needing NO `pushBranch` and NO worktree. The tree-less move touches only `work/<slug>.md`, independent of the work-branch tip.
3. **Scope strictly to the AFTER-COMMIT continue-push-failure surface.** Do NOT convert the OTHER `applyNeedsAttentionTransition` callers (the gate-failed / agent-failed / wip-save routes in `do.ts` ~L1054/L1147/L1531, `run.ts`) — those may have UN-committed wip work that legitimately needs the cwd path to commit it first (a `git add -A` wip commit and/or a `pushBranch` of the work branch), which the tree-less move CANNOT do (it only relocates a committed `.md` ledger file). The discriminator: a site that surfaces with `pushBranch: false` AND whose work is already committed (the continue-push-failure case) is tree-less-safe; a site that commits wip / pushes the branch is NOT. This slice is ONLY the after-commit continue-push-failure case, where the work is provably committed and the surface is ledger-only.

## Scope

- IN: a tree-less SURFACE transition (`in-progress/ → needs-attention/`) reusing the `#89` scratch-index/commit-tree/`applyTransition` mechanism (factored to share, not duplicate); routing the three after-commit continue-push-failure sites onto it; the reason still appended to the item body.
- OUT: converting the wip-save / gate-failed / agent-failed surface routes (those may carry uncommitted work and need the cwd commit path); changing the requeue-direction tree-less path; changing what the surface RECORDS (reason in body) or the recoverable-branch handling (already on the arbiter at these sites); a new lock/CAS primitive (reuse `applyTransition`).

## Acceptance criteria

- [ ] An after-commit continue-push-failure surfaces `in-progress/ → needs-attention/` via the tree-less `applyTransition` CAS (fetch + scratch-index move + throwaway-ref + leased fast-forward push), touching NO worktree — `start.ts routeContinuePushFailure`, the `do.ts` `tree.continuePushFailure` branch, and `run.ts` step 2b route through it. Tested: the surface lands the `.md` move + reason on `<arbiter>/main` with no working-tree mutation.
- [ ] The shared tree-less core (scratch-index / commit-tree / `applyTransition` / contention-retry) is FACTORED so the requeue-direction (`needs-attention/ → backlog/`) and the new surface-direction (`in-progress/ → needs-attention/`) use ONE mechanism, not two copies. Verified by inspection.
- [ ] A contention rejection (main advanced under us) refetches + rebuilds + retries, exactly as the requeue tree-less path does. Tested.
- [ ] The OTHER surface routes (gate-failed / agent-failed / wip-save, which may carry uncommitted work) are UNCHANGED — they keep the cwd-bound path that can commit wip first. Verified by inspection (this slice touches only the after-commit continue-push-failure sites).
- [ ] The reason is still appended to the item body on the move; the recoverable branch handling is unchanged (already on the arbiter at these sites). Tested.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. The `#89` tree-less primitive it reuses is already landed (`needs-attention.ts returnToBacklog` + `ledgerWrite.applyTransition`); this extends it to the surface direction for the after-commit case.

## Prompt

> Make the AFTER-COMMIT continue-push-failure SURFACE (`in-progress/ → needs-attention/`) TREE-LESS, reusing the `#89` mechanism `requeue` already uses for the reverse direction \u2014 so a stuck slice surfaces with NO worktree/checkout. LOW PRIORITY (option (b) already fixed the silent-strand bug; this is the no-worktree polish the `stale-lease-retry-all-push-sites-and-treeless-surface` slice deferred and REQUIRED be filed as a follow-up). The work is ALREADY committed on the branch at these sites \u2014 only the one-file `.md` ledger move + reason needs to reach `main`, so no checkout is needed.
>
> THE GAP (verify first): `#89`/`requeue-treeless-transition` made the REQUEUE direction tree-less (`src/needs-attention.ts` `returnToBacklog` ~L564-686: fetch `<arbiter>/main` → scratch-index `read-tree base` + `update-index` move + `commit-tree` → throwaway ref → `ledgerWrite.applyTransition({localBranch, expectedBase, head})` → drop ref). But the SURFACE direction for an after-commit continue-push-failure still uses the CWD-BOUND `applyNeedsAttentionTransition`: `src/start.ts routeContinuePushFailure` (~L781-815, cuts a temp branch + `pushBranch:false`), `src/do.ts` (~L681-687, the `tree.continuePushFailure` branch), `src/run.ts` step 2b.
>
> BUILD: (1) add a tree-less SURFACE transition mirroring `returnToBacklog`'s recipe but for `in-progress/ → needs-attention/` (reason appended to the body). FACTOR the shared scratch-index/commit-tree/`applyTransition`/contention-retry core so requeue-direction and surface-direction use ONE mechanism (decide new-sibling-fn vs parameterise in a `## Decisions` block). (2) route `routeContinuePushFailure`, the `do.ts` `continuePushFailure` branch, and `run.ts` step 2b onto it (no `pushBranch`, no worktree \u2014 the recoverable branch is already on the arbiter). (3) STRICTLY scope to the after-commit continue-push-failure surface \u2014 do NOT touch the gate-failed / agent-failed / wip-save surface routes (`do.ts` ~L1054/L1147/L1531, `run.ts`): those may carry UNCOMMITTED wip that needs the cwd commit path, and the tree-less move only works when the work is already committed.
>
> READ FIRST: `src/needs-attention.ts` (`returnToBacklog` ~L564-686 \u2014 the tree-less recipe to reuse/factor; `applyNeedsAttentionTransition`/`routeToNeedsAttention` \u2014 the cwd-bound path being replaced for this case); `src/ledger-write.ts` (`applyTransition` \u2014 the push+lease+verify CAS); `src/start.ts` (`routeContinuePushFailure` ~L781-815); `src/do.ts` (the `tree.continuePushFailure` branch ~L681-687, and the OTHER surface routes ~L1054/L1147/L1531 to LEAVE ALONE); `src/run.ts` (step 2b). Source signal: `work/observations/treeless-surface-for-after-commit-push-failure.md`. Cross-ref: `work/done/stale-lease-retry-all-push-sites-and-treeless-surface.md` (the slice that deferred this), `work/done/requeue-treeless-transition.md` / the `#89` work.
>
> SCOPE FENCE: only the after-commit continue-push-failure surface (work provably committed); do NOT convert the uncommitted-wip surface routes; reuse `applyTransition` (no new CAS primitive); factor the shared tree-less core rather than copying it; the reason still lands in the body; the recoverable branch handling is unchanged. "Done" = the after-commit continue-push-failure surfaces tree-lessly (no worktree mutation, tested), one shared tree-less core serves both directions, the other surface routes are untouched, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

### Claiming this slice

```sh
agent-runner claim treeless-surface-for-after-commit-push-failure --arbiter origin
git fetch origin && git switch -c work/treeless-surface-for-after-commit-push-failure origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/treeless-surface-for-after-commit-push-failure.md work/done/treeless-surface-for-after-commit-push-failure.md
```
