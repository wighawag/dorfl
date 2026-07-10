---
title: reap-merged-remote-work-branches — delete a propose-mode PR's remote `work/<slug>` branch once it is PROVABLY MERGED (ancestor of `<arbiter>/main`), via (a) a provider-agnostic `gc` sub-mode SWEEP guarded by the same ancestor predicate `gc` already uses, (b) an INLINE delete in auto-merge mode when WE perform the merge, and (c) install-ci wiring a scheduled trigger for the sweep (+ optionally enabling GitHub's auto-delete-head-branch) — WITHOUT ever touching an un-merged in-flight branch (the never-delete invariant protects only the PRE-merge recovery point)
slug: reap-merged-remote-work-branches
blockedBy: []
covers: []
---

> Self-contained HYGIENE slice — derives from NO SPEC (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal (discharged into this slice on authoring): `work/observations/propose-pr-remote-work-branch-not-deleted-after-merge.md` (2026-06-09; maintainer: "the remote PR branch should be closed when merged").
>
> MAINTAINER DECISIONS (settled 2026-06-12 — implement, do not re-open):
> - **Q1 = (a) provider-agnostic sweep** (NOT relying on the GitHub setting alone): delete a merged `<arbiter>/work/<slug>` via `git push --delete`, guarded by the ancestor predicate, so it works on a `--bare` arbiter and any provider.
> - **Q2 = a `gc` sub-mode** for the sweep (the out-of-band human/UI merge has no event to hook, so a sweep is the right shape), AND **install-ci wires a scheduled trigger** so the sweep runs automatically (an option, on by default with an opt-out). Optionally install-ci ALSO enables GitHub's repo-level auto-delete-head-branch as a zero-code belt-and-suspenders for GitHub arbiters.
> - **Q3 = yes:** in auto-merge mode (dorfl performs the merge), delete the head branch INLINE as part of the merge step (we know the exact merge moment — no sweep needed for that case).

## The gap (verify against current code)

In propose mode, `do --propose` / `complete --propose` pushes `work/<slug>` to the arbiter and opens a PR (`src/integrator.ts` `integrate`, mode `propose` → push the branch + `provider.openRequest`). When that PR later MERGES (GitHub UI / `gh`, often out-of-band), NOTHING in dorfl deletes the remote `work/<slug>` branch. Verified:

- `src/github.ts` (the only provider) opens the PR + posts a review COMMENT and has ZERO branch-deletion capability (grep: no `gh pr merge --delete-branch`, no `git push --delete`, no auto-delete setting). Confirmed still true.
- No merged-remote-branch reap/sweep exists anywhere: `gc` (`src/gc.ts` `gc()` ~L245, CLI `src/cli.ts` ~L2076) reaps job WORKTREES under `workspacesDir/work/*`, NOT remote `work/*` branches on the arbiter. The ONLY existing remote-branch deletion is `requeue --reset` (`src/cli.ts` ~L2207) — the one sanctioned UN-merged deletion (deliberate + guarded).
- `advance-install-ci` did NOT enable GitHub's auto-delete setting (verified: `docs/ci/` carries no delete-branch config).

So merged `work/*` branches accumulate forever on the arbiter — the exact thing GitHub's "auto-delete head branches" exists to prevent.

## The invariant tension (why a DECISION, now decided)

There is a documented never-delete-the-remote-branch invariant (ADR §4 deletion-safety; `requeue --reset` is called out as "a deliberate departure" from it). It exists because the remote `work/<slug>` branch is the cross-machine RECOVERY point: `requeue` (keep+continue) and continue-detection read `<arbiter>/work/<slug>` ahead of main to resume saved work. BUT the invariant protects a branch only while it is IN-FLIGHT / UN-merged. Once the PR is MERGED, the branch's commits are on `main` — it is NO LONGER a recovery point, so deleting it is SAFE (work preserved on main) and DESIRABLE (PR hygiene). This slice deletes ONLY provably-merged branches, so it COMPLEMENTS the invariant rather than violating it ("never delete an un-merged branch" stays absolute).

## What to build

The safety predicate is the lynchpin: a remote `work/<slug>` branch is reapable IFF it is PROVABLY MERGED — `git merge-base --is-ancestor <work-branch-tip> <arbiter>/main` succeeds. This is the SAME reachability check `gc` already uses for worktrees (`isAncestor`, `src/gc.ts` ~L403-411) — REUSE it, do not invent a second. A merely-pushed-but-not-merged branch is NOT an ancestor of main, so the predicate AUTOMATICALLY excludes the in-flight recovery point the invariant protects (an in-flight kept-for-continue branch is never an ancestor of main).

> WIRING NUANCE (verify): `isAncestor` (`src/gc.ts` ~L403-411) is currently a PRIVATE function taking a local `dir` to run git in — it compares two refs REACHABLE in that local repo. For the REMOTE sweep, the work-branch tip and `<arbiter>/main` must both be resolvable locally before the check: fetch them into the bare hub mirror (or read the tips via `git ls-remote --heads <arbiter>` and the mirror's `main`) and run the ancestor check there. So the builder will likely EXPORT/relocate `isAncestor` (or a small shared sibling) and run it against the hub mirror, not invent a second predicate. Decide + document this in the `## Decisions` block.

1. **(a) Provider-agnostic `gc` merged-branch SWEEP.** Add a `gc` sub-mode (a new flag, e.g. `gc --remote-branches` / a unified `gc` that also sweeps, decide in a `## Decisions` block) that, against an arbiter, enumerates remote `work/*` branches (`git ls-remote --heads <arbiter> 'work/*'` or against the hub mirror) and, for each whose tip is `--is-ancestor` of `<arbiter>/main`, deletes it via `git push <arbiter> --delete work/<slug>` (NEVER `--force`; deletion of a fully-merged ref needs no force). Report each: deleted (merged) / retained (not an ancestor ⇒ still in-flight) with the reason — mirroring the existing per-job retained-with-reason output. This works on a `--bare` arbiter and any provider (plain git). Do NOT touch a branch that is not provably an ancestor of main.

2. **(b) Inline delete in auto-merge mode (Q3).** When dorfl ITSELF performs the merge (auto-merge mode, `src/integrator.ts` `integrate` mode `merge` / the auto-merge path), delete the head `work/<slug>` branch as part of the merge step — AFTER confirming the merge landed (the commits are now on main, so the ancestor predicate trivially holds) via the same `git push --delete` (or `gh pr merge --delete-branch` on the GitHub provider, decide which keeps the seam simplest). This needs no sweep because we know the exact merge moment. Mode `merge` that pushes `work/<slug>:main` (no separate remote head) is unaffected; the propose+we-merge path is where the remote head exists to reap.

3. **(c) install-ci wires the sweep trigger (+ optional GitHub setting).** Update the install-ci deliverable (`docs/ci/advance-loop.yml.template` — it already has a `schedule:` cron ~L48-51) so the scheduled CI tick ALSO runs the `gc` merged-branch sweep (an option, ON by default with a documented opt-out), so out-of-band human/UI merges get their branches reaped automatically on the next tick. OPTIONALLY: install-ci / `setup` may ALSO enable GitHub's repo-level "auto-delete head branches" (`delete_branch_on_merge`) as a zero-code belt-and-suspenders for GitHub arbiters — document it as an additive convenience, NOT a replacement for the provider-agnostic sweep (which is the general home and the only thing that works on `--bare` arbiters / non-GitHub providers).

## Scope

- IN: the ancestor-guarded provider-agnostic `gc` merged-remote-branch sweep (reusing `isAncestor`); the inline head-branch delete in auto-merge mode; install-ci wiring the scheduled sweep (on by default, opt-out) and optionally enabling GitHub's auto-delete setting; report deleted-vs-retained with reasons; tests proving an in-flight (non-ancestor) branch is NEVER deleted.
- OUT: deleting any un-merged/in-flight branch (the invariant stays absolute — only ancestor-of-main branches are reaped); `--force` deletion (a merged ref deletes without force); changing `requeue --reset`'s sanctioned un-merged deletion; worktree reaping (the existing `gc` job-worktree path is unchanged — this ADDS the remote-branch counterpart); a non-GitHub provider's auto-delete-equivalent setting (the sweep covers them already).

## Acceptance criteria

- [ ] A `gc` sub-mode sweeps remote `work/*` branches on the arbiter and deletes (via `git push --delete`, NEVER `--force`) exactly those whose tip is `git merge-base --is-ancestor <tip> <arbiter>/main` (provably merged), reusing `gc`'s existing `isAncestor` predicate (`src/gc.ts` ~L403-411). Each branch is reported deleted-merged / retained-with-reason.
- [ ] An UN-merged in-flight branch (tip NOT an ancestor of `<arbiter>/main`, e.g. a kept-for-continue `requeue` branch) is NEVER deleted by the sweep. Tested explicitly: a merged branch ⇒ deleted; a pushed-but-unmerged branch ⇒ retained (the recovery point is safe).
- [ ] In auto-merge mode, when dorfl performs the merge, the remote head `work/<slug>` is deleted INLINE after the merge lands (confirmed merged), via the same ancestor-safe deletion. Tested. (Mode `merge` that pushes `work/<slug>:main` with no remote head is unaffected.)
- [ ] install-ci (`docs/ci/advance-loop.yml.template`) runs the `gc` merged-branch sweep on its scheduled tick (ON by default, with a documented opt-out), so out-of-band merges are reaped automatically. Optionally documents enabling GitHub's `delete_branch_on_merge` as an additive GitHub-only convenience (NOT a replacement for the sweep).
- [ ] Works on a `--bare` (local) arbiter and any provider (the sweep is plain git, no `gh` dependency). Tested against a `--bare` arbiter fixture.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. Reuses the existing `gc` `isAncestor` predicate + the integrator merge path; install-ci's template already exists with a schedule to extend.

## Prompt

> Reap a propose-mode PR's remote `work/<slug>` branch once it is PROVABLY MERGED, so merged work branches stop accumulating on the arbiter. MAINTAINER DECISIONS (settled — implement): (a) a PROVIDER-AGNOSTIC sweep (not the GitHub setting alone); (Q2) a `gc` SUB-MODE for the sweep + install-ci wiring a SCHEDULED trigger (on by default, opt-out); (Q3) ALSO delete inline in AUTO-MERGE mode when WE perform the merge. The safety lynchpin: delete a remote `work/<slug>` IFF `git merge-base --is-ancestor <tip> <arbiter>/main` (provably merged) — reuse `gc`'s existing `isAncestor` (`src/gc.ts` ~L403-411), NEVER `--force`, and NEVER touch a branch that is not an ancestor of main (an in-flight/un-merged branch is the recovery point the never-delete invariant protects, ADR §4 — the predicate auto-excludes it).
>
> THE GAP (verify first): `src/github.ts` has ZERO branch-delete capability; no merged-remote-branch sweep exists (`gc` reaps job WORKTREES under `workspacesDir/work/*`, NOT remote branches); the only remote-branch deletion is `requeue --reset` (the sanctioned UN-merged case). So merged `work/*` branches linger forever.
>
> BUILD: (1) a `gc` sub-mode (decide the flag shape in a `## Decisions` block) that enumerates remote `work/*` (`git ls-remote --heads <arbiter> 'work/*'` or via the hub mirror), deletes via `git push <arbiter> --delete work/<slug>` exactly those provably merged (ancestor-of-main), reports deleted-vs-retained-with-reason. (2) In auto-merge mode (`src/integrator.ts` `integrate` mode `merge` / the auto-merge path), delete the head branch inline AFTER the merge lands (`git push --delete` or `gh pr merge --delete-branch` — keep the seam simple). (3) install-ci (`docs/ci/advance-loop.yml.template`, schedule ~L48-51) runs the sweep on its scheduled tick (on by default, opt-out); OPTIONALLY enable GitHub `delete_branch_on_merge` as an additive GitHub-only convenience (NOT a replacement for the sweep).
>
> READ FIRST: `src/gc.ts` (`gc()` ~L245, the per-job sweep structure to mirror; `isAncestor` ~L403-411 — the predicate to REUSE; the retained-with-reason reporting to mirror); `src/cli.ts` (`gc` command ~L2076 — add the sub-mode flag; `requeue --reset` ~L2207 — the only existing remote-branch delete, the un-merged complement); `src/integrator.ts` (`integrate` propose vs merge, the `Provider` interface — the inline auto-merge delete site); `src/github.ts` (no delete today — add the GitHub delete if used); `docs/ci/advance-loop.yml.template` (the schedule to extend). Source signal: `work/observations/propose-pr-remote-work-branch-not-deleted-after-merge.md`.
>
> SCOPE FENCE: NEVER delete an un-merged/in-flight branch (only ancestor-of-main); no `--force` (a merged ref needs none); do not change `requeue --reset` or the worktree `gc` path; the GitHub auto-delete setting is additive, NOT a replacement for the provider-agnostic sweep (which must work on a `--bare` arbiter). "Done" = the `gc` sub-mode deletes only provably-merged remote `work/*` branches (in-flight branches provably untouched, tested), auto-merge deletes the head inline after merging, install-ci runs the sweep on schedule (on by default, opt-out), it works on a `--bare` arbiter, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

### Claiming this slice

```sh
dorfl claim reap-merged-remote-work-branches --arbiter origin
git fetch origin && git switch -c work/reap-merged-remote-work-branches origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/reap-merged-remote-work-branches.md work/done/reap-merged-remote-work-branches.md
```
