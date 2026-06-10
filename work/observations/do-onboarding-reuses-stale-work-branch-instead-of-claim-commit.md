---
title: in-place `do` onboarding can land the work branch on a STALE pre-claim commit (slice still in backlog) — the done-move then errors "nothing to complete"; should branch from the EXACT claim commit and fail if absent
date: 2026-06-10
slug: do-onboarding-reuses-stale-work-branch-instead-of-claim-commit
---

## What was spotted

Running `do slice:deploy-send-value-to-payable-constructor` (in-place, in the human's `rocketh` checkout) CLAIMED the slice and BUILT it, then errored at completion:

```
>> CLAIMED 'deploy-send-value-to-payable-constructor' -> work/in-progress/ on origin/main.
>> Start work:  git fetch origin && git switch -c work/deploy-send-value-to-payable-constructor origin/main
error: work/in-progress/deploy-send-value-to-payable-constructor.md (nor work/needs-attention/deploy-send-value-to-payable-constructor.md) found — nothing to complete (already done, or wrong slug?).
```

The claim landed on the arbiter (the slice moved `backlog → in-progress` there, commit `claim: <slug>`), and the agent's implementation WAS produced — but the work branch the agent built on was sitting on a commit where the slice is still in `work/backlog/`, so the done-move could not find `work/in-progress/<slug>.md` LOCALLY. The build was fine; only the protocol bookkeeping (in-progress→done move) had nothing to act on.

## Root cause (confirmed by reflog + code)

Two compounding defects in the in-place onboarding path. Reflog of the failing run (`work/<slug>` reflog in the rocketh checkout):

```
27b7df0  checkout: moving from work/<slug> to origin/main            # onboarding begins; origin/main is 27b7df0
27b7df0  checkout: 27b7df0... to claim/<slug>                        # claim CAS branches claim/<slug> off origin/main (=27b7df0)
c49dd53  commit: claim: <slug>                                       # claim commit created (pushed to arbiter)
27b7df0  checkout: claim/<slug> to work/<slug>                       # cleanup returns to origRef; prepare switches to a PRE-EXISTING work/<slug> @ 27b7df0
27b7df0  checkout: work/<slug> to work/<slug>                        # no-op re-checkout — still 27b7df0, NOT the claim commit c49dd53
```

1. **`origin/main` is not fetched-forward after the claim push.** `claim-cas.ts performClaim`/`attempt` pushes the claim commit through the ledger-write seam (`--force-with-lease=main:<base>` + post-push verify), then `cleanup()` returns to `origRef` — but it never advances the local remote-tracking `origin/main`, which stays at the PRE-claim sha (`27b7df0`). So a subsequent `switch -c work/<slug> origin/main` would cut from a STALE main missing the claim. (`isolation.ts inPlaceStrategy.prepare` does `git fetch --quiet arbiter` itself, but in this run a stale local `work/<slug>` short-circuited even that — see #2.)

2. **The fresh-switch falls back to REUSING a stale pre-existing `work/<slug>` without rebasing.** In `isolation.ts inPlaceStrategy.prepare`, the FRESH branch is:
   ```ts
   const created = gitSoftSwitch(['switch','--quiet','-c',branch,`${arbiter}/main`], checkout, env);
   if (!created) {
     git(['switch','--quiet',branch], checkout, {env}); // ← reuses the existing branch AS-IS
   }
   ```
   A leftover local `work/<slug>` (here from the prior `intake` run, left at `27b7df0`) makes `-c` fail ("branch already exists"), so it falls to plain `switch <branch>` — landing on the STALE branch (slice in backlog), NOT on a branch cut from the claim. There is NO rebase/reset of the reused branch onto the claim in the FRESH path (the rebase-onto-main logic only exists in the CONTINUE/requeue branch above it). So a stale same-named branch silently wins over the just-created claim state, with no error.

The CONTINUE path (a requeued kept branch) DOES `switch -C` (force-reset) + rebase onto fresh main; the FRESH path's `switch <branch>` fallback does neither — that asymmetry is the bug.

Note the SECOND run (after manually requeueing to backlog, deleting the stale local `work/<slug>`, and re-running `do --merge`) succeeded end-to-end: with no stale branch, `-c work/<slug> origin/main` created fresh off an `origin/main` that by then contained the claim. So the failure needs BOTH a stale same-named local branch AND/OR a not-yet-advanced local `origin/main`.

## Why it matters

- **Silent mis-basing → wasted build.** The agent does the full implementation on the wrong base; the work is only discovered un-completable at the very end ("nothing to complete"). The diff is real but orphaned on a stale branch.
- **The "Start work" hint is itself stale-prone.** The printed `git switch -c work/<slug> origin/main` only lands on the claim if local `origin/main` was advanced AND no same-named branch exists — neither guaranteed.

## Scope / candidate fix (the "branch from the EXACT claim commit, fail if absent" idea)

The claim commit sha is KNOWN at claim time (`attempt` computes `head = rev-parse HEAD` for the claim commit and hands it to `ledgerWrite.applyTransition({head})`), but `performClaim`'s `ClaimCasResult` only returns a human `message`, and `do.ts` calls `selectIsolationStrategy(...).prepare({slug, env})` — the claim head is NOT threaded through. Proposed:

1. **Thread the claim commit sha out of `performClaim`** (add it to `ClaimCasResult`) and INTO `prepare` (e.g. `prepare({slug, claimCommit, env})`).
2. **In the FRESH path, branch from the exact claim commit and HARD-FAIL if it is not present/reachable** rather than falling back to a stale same-named branch:
   - `git fetch arbiter` (advance `arbiter/main`), then assert the claim commit is reachable from `arbiter/main` (`git merge-base --is-ancestor <claimCommit> arbiter/main`); error loudly if not.
   - `git switch -C work/<slug> <claimCommit>` (force-reset to the EXACT claim commit, mirroring the CONTINUE path's `-C`) — so a stale same-named branch is RE-POINTED at the claim, never silently reused as-is.
3. **Also advance local `origin/main` after the claim push** (a `git fetch arbiter` in/after `performClaim`), so the printed "Start work" hint and any `arbiter/main`-relative switch are correct.

This makes onboarding deterministic: the work branch is the claim commit, or `do` fails fast with a clear message — never a silent stale-base build.

## References

- `src/claim-cas.ts` — `performClaim` / `runClaim` / `attempt`: branches `claim/<slug>` off `arbiter/main`, commits `claim: <slug>`, pushes via `ledgerWrite.applyTransition({head})`, then `cleanup()` returns to `origRef`. `head` (the claim commit) is computed but not surfaced in `ClaimCasResult`.
- `src/isolation.ts` — `inPlaceStrategy.prepare`: the FRESH `gitSoftSwitch(['switch','-c',branch,`${arbiter}/main`])` → `git switch <branch>` fallback (the stale-reuse path); contrast the CONTINUE path's `switch -C` + `rebaseContinuedBranchOntoMain`.
- `src/do.ts` (~L598–620) — `performClaim(...)` then `selectIsolationStrategy({checkout, arbiter}).prepare({slug, env})`: the claim head is not passed to `prepare`.
- Surfaced by: `do slice:deploy-send-value-to-payable-constructor` in `wighawag/rocketh` (first run errored "nothing to complete"; reflog showed the work branch on the pre-claim `27b7df0`, not the claim commit `c49dd53`). Manual requeue + stale-branch delete + re-run then succeeded.
