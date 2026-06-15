---
title: do/run onboard and requeue --reset must reconcile the hub MIRROR to the arbiter — a stale mirror work/<slug> ref resurrects a deleted branch and makes --reset a no-op
slug: onboard-and-reset-reconcile-mirror-to-arbiter
blockedBy: [continue-rebase-auto-resolves-protocol-bookkeeping-conflicts]
covers: []
---

## What to build

The onboard continue-detection (`branchAheadOf` in `continue-branch.ts`) decides "does a kept `work/<slug>` branch exist AHEAD of main?" by reading a LOCAL remote-tracking ref. That ref can be STALE (point at a branch already deleted on the arbiter), so onboard wrongly "continues from the kept branch" off a deleted/far-behind copy, conflicts on rebase, and recurs every retry.

### VERIFIED against the code + the live mirrors (full read of `repo-mirror.ts` + both ref stores — do not re-derive; confirm against `src/` + a live mirror)

The staleness has a PRECISE mechanism, and it differs by PATH. There are TWO onboarding paths and TWO ref stores, and the earlier loose claim "the mirror never prunes" was only half right:

- **IN-PLACE clone path** (`isolation.ts` ~L257, the `do --isolated` from a regular checkout — the path the live failure hit): it runs a PLAIN `git fetch --quiet <arbiter>` (refspec `+refs/heads/*:refs/remotes/origin/*`), then `branchAheadOf(checkout, '<arbiter>/work/<slug>', …)` reads `refs/remotes/origin/work/<slug>`. A plain `git fetch` does NOT prune unless `fetch.prune` is set — and it is UNSET in a normal clone. VERIFIED LIVE: this very checkout has `fetch.prune` unset and still holds e.g. `refs/remotes/origin/work/slice-atomic-done-move-one-slug-one-folder` pointing at a branch GONE from the arbiter. So a re-`do` of such a slug would read the stale ref and wrongly continue.
- **BARE HUB-MIRROR path** (`do --remote`/`run` job worktrees): `ensureMirror` DOES fetch `--prune +refs/heads/*:refs/heads/*` — so it prunes the `refs/heads/work/*` namespace. BUT the bare clone ALSO created a `refs/remotes/origin/work/*` namespace (an initial `git clone` writes remote-tracking refs), and NO configured refspec covers it (`git config remote.origin.fetch` is EMPTY on the bare mirror), so `remote prune` / `fetch --prune` are NO-OPs for it. VERIFIED LIVE: the bare mirror holds 57 stale `refs/remotes/origin/work/*` refs, all GONE on the arbiter, never pruned by anything.

So the bug is NOT "the mirror never prunes" generically — it is: **the continue-detection trusts a remote-tracking ref store that, on BOTH paths, can contain refs the arbiter no longer has** (in-place: a non-pruning `git fetch`; bare mirror: an orphaned `refs/remotes/origin/*` namespace no refspec prunes). Reproduced live (see `work/observations/requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md`): after `requeue --reset` deleted `work/slice-serialise-…` on the real `origin`, a stale tracking ref survived, the next `do` continued from it and rebase-conflicted, and the ref had to be deleted by hand (`update-ref -d`) to break the loop — so `--reset` silently failed its one job.

Two coupled fixes:

1. **Onboard reconciles the tracking ref to the ARBITER before deciding continue-vs-fresh — on BOTH paths.** Before `branchAheadOf` is trusted, make the local ref store agree with the arbiter for THIS slug's `work/<slug>`: either (a) `git ls-remote <arbiter> refs/heads/work/<slug>` and treat ABSENT-on-arbiter as "no kept branch → fresh cut" regardless of any local tracking ref, OR (b) prune the tracking ref explicitly (the in-place fetch should `--prune`; the bare mirror's orphaned `refs/remotes/origin/work/*` must be reconciled/pruned too — a plain `remote prune` is a no-op there, so it needs an explicit `update-ref -d` or an `ls-remote` truth check). The ARBITER is the single source of truth; a tracking ref with no arbiter counterpart must NEVER drive a "continue". Prefer the `ls-remote`-truth approach (a) — it is path-agnostic and cannot be fooled by either stale store. The fix lives at the continue-detection seam so BOTH `isolation.ts` (in-place) and the mirror callers benefit.
2. **`requeue --reset` purges the local tracking ref too.** After deleting the arbiter branch, delete the corresponding tracking ref(s) for that slug (the in-place clone's `refs/remotes/<arbiter>/work/<slug>` AND every known bare mirror's `refs/remotes/origin/work/<slug>` and `refs/heads/work/<slug>`) — or, better, make the continue-detection arbiter-authoritative (fix 1) so `--reset` need not chase every store. After `--reset`, NO copy of the branch — arbiter OR any tracking store — may resurrect a continue.

## Acceptance criteria

- [ ] **Continue-detection is ARBITER-authoritative on the IN-PLACE path:** with a regular clone whose `refs/remotes/<arbiter>/work/<slug>` is STALE (points at a branch deleted on the arbiter; `fetch.prune` unset), onboard decides NO kept branch and starts FRESH — it does NOT continue/conflict. A test reproduces this exact live shape (stale `refs/remotes/origin/work/<slug>` + `fetch.prune` unset + branch gone on arbiter).
- [ ] **Continue-detection is ARBITER-authoritative on the BARE-MIRROR path:** with a bare hub mirror holding an orphaned `refs/remotes/origin/work/<slug>` (the namespace no refspec prunes; verified 57 such stale refs live), onboard starts FRESH. A test pins it.
- [ ] **`requeue --reset` leaves NO store able to resurrect a continue:** after `--reset`, neither `git ls-remote <arbiter>`, nor the in-place clone's tracking ref, nor any bare mirror's `refs/remotes/origin/work/<slug>` / `refs/heads/work/<slug>` drives a continue. A test asserts a re-`do` after `--reset` starts FRESH (not continue). (If fix 1 makes detection arbiter-authoritative, this is satisfied by construction — the test still pins the end-to-end behaviour.)
- [ ] **A plain prune is NOT relied upon where it is a no-op:** the fix must NOT assume `git remote prune origin` clears the bare mirror's orphaned `refs/remotes/origin/work/*` (verified no-op — the bare mirror has NO `remote.origin.fetch` refspec). A test asserts the stale bare-mirror ref no longer drives a continue (via `ls-remote` truth or explicit `update-ref -d`), not via `remote prune`.
- [ ] Existing keep+continue behaviour is UNCHANGED when the arbiter branch GENUINELY exists (a real kept branch still continues from its tip, both paths). A test pins that the fix does not break legitimate continue.
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
