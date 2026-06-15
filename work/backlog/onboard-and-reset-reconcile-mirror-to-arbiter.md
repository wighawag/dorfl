---
title: do/run onboard and requeue --reset must reconcile the hub MIRROR to the arbiter — a stale mirror work/<slug> ref resurrects a deleted branch and makes --reset a no-op
slug: onboard-and-reset-reconcile-mirror-to-arbiter
blockedBy: [continue-rebase-auto-resolves-protocol-bookkeeping-conflicts]
covers: []
---

## What to build

`do --isolated`/`run` derive "does a kept `work/<slug>` branch exist?" from the **hub mirror** (`~/.agent-runner/repos/<host>/<owner>/<repo>.git`), not the real arbiter. The mirror's `refs/remotes/origin/work/*` tracking refs are NOT reliably pruned, so a branch deleted on the arbiter can LINGER in the mirror — and onboard then "continues from the kept branch" using a stale, far-behind copy, conflicts on rebase, and recurs forever. Reproduced live (see `work/observations/requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md`):

- After `requeue --reset` deleted `work/slice-serialise-…` on the real `origin` (`git ls-remote origin` → empty), the MIRROR still held `refs/remotes/origin/work/slice-serialise-… → <old sha>`.
- A plain `git --git-dir=<mirror> remote prune origin` / `fetch --prune` was a NO-OP (the mirror lacks a fetch refspec that prunes `work/*`), so the stale ref had to be deleted by hand (`update-ref -d`) to break the loop.
- Net effect: `requeue --reset` discarded the (correct, building) work on the arbiter yet the next `do` STILL continued from the stale mirror copy — `--reset` silently failed its one job.

Two coupled fixes:

1. **Onboard reconciles mirror → arbiter before deciding continue-vs-fresh.** At the seam where `do`/`run` check kept-branch existence (the `continue-branch.ts` "does the arbiter have a `work/<slug>` ref ahead of main?" helper and its mirror-side callers), treat the ARBITER as truth: `ls-remote` the arbiter (or fetch with an explicit prune refspec that covers `refs/heads/work/*`), and IGNORE/prune any mirror tracking ref with no arbiter counterpart. A mirror ref absent from the arbiter must NEVER be resurrected into a "continue".
2. **`requeue --reset` purges the mirror too.** After deleting the arbiter branch, delete the corresponding mirror tracking ref for that slug in every known mirror of the repo (or route the deletion through a path that keeps mirror + arbiter consistent by construction). After `--reset`, NO copy of the branch — arbiter OR mirror — may remain.

## Acceptance criteria

- [ ] Onboard (`do --isolated` / `run`) decides kept-branch-exists from the ARBITER, not a possibly-stale mirror ref: a mirror tracking ref for a `work/<slug>` branch that does NOT exist on the arbiter is pruned/ignored, and onboard starts FRESH rather than "continuing" from it.
- [ ] A test simulates a mirror holding `refs/remotes/origin/work/slice-X` whose arbiter branch was deleted, then runs the onboard decision and asserts it does NOT continue/conflict (it starts fresh).
- [ ] `requeue --reset` deletes the mirror's tracking ref for the slug (all known mirrors), so after `--reset` neither `git ls-remote <arbiter>` NOR the mirror retains the branch. A test asserts both are clean post-`--reset`.
- [ ] The prune uses an explicit refspec / `update-ref -d` that actually removes `refs/remotes/origin/work/*` (a plain `remote prune` was observed to be a no-op here — assert the ref is genuinely gone).
- [ ] Existing keep+continue behaviour is UNCHANGED when the arbiter branch genuinely exists (a real kept branch still continues from its tip). A test pins that the fix does not break legitimate continue.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `continue-rebase-auto-resolves-protocol-bookkeeping-conflicts` — NOT a logical dependency but a FILE-ORTHOGONALITY serialiser: both slices edit `packages/agent-runner/src/continue-branch.ts` (slice 1 changes `rebaseContinuedBranchOntoMain` / the surface seam; this slice changes the onboard kept-branch-existence decision). Different functions, same file → serialise to keep the rebase trivial (review-skill lens 3). Build slice 1 first (it changes WHERE bookkeeping moves live, which this slice's mirror↔arbiter reconciliation should be consistent with).

## Prompt

> FIRST, drift-check: confirm the mirror-vs-arbiter split still exists — `do --isolated`/`run` use the hub mirror under `~/.agent-runner/repos/…` (see `src/repo-mirror.ts`, `src/mirror-pool-scan.ts`, `src/isolation.ts`) and the kept-branch decision flows through `src/continue-branch.ts`. Reproduce the staleness: delete a `work/<slug>` branch on a throwaway `--bare` arbiter, confirm the mirror still lists `refs/remotes/origin/work/<slug>`, and that a plain `remote prune` does NOT remove it. If the codebase already reconciles mirror→arbiter at onboard (so this can't happen), route to needs-attention noting that. See `work/observations/requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md`.
>
> GOAL: make the arbiter the single source of truth for kept-branch existence. Onboard prunes/ignores mirror tracking refs absent from the arbiter (so a deleted branch is never resurrected into a "continue"), and `requeue --reset` purges the mirror tracking ref alongside the arbiter branch (so `--reset` actually starts fresh).
>
> SEAMS TO TEST AT: the onboard continue-vs-fresh decision (`continue-branch.ts` + its mirror-side caller) with a stale-mirror fixture; and `requeue --reset` asserting mirror + arbiter both clean afterward. Use throwaway `--bare` `file://` arbiters + real mirrors as the existing isolation/mirror tests do; no network.
>
> DONE: stale mirror refs can no longer drive a "continue", `--reset` is provably effective, legitimate continue still works, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.
