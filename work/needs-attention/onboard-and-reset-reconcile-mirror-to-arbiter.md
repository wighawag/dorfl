---
title: branch deletes must be WRITE-THROUGH (delete the local tracking ref FIRST, then the arbiter) so mirror+arbiter never drift, PLUS continue-detection must be arbiter-authoritative for cross-machine deletes — a stale local work/<slug> ref resurrects a deleted branch and makes --reset a no-op
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

Two coupled fixes — a WRITE-side root fix (the primary) and a READ-side cross-machine backstop:

#### Fix 1 (PRIMARY, write-side) — delete the LOCAL ref FIRST, then the arbiter (write-through ordering)

Every branch DELETE in the codebase today deletes on the ARBITER ONLY and leaves the local ref store untouched (verified): `requeue --reset` (`needs-attention.ts` ~L547: `git push <arbiter> --delete` then only a best-effort `git branch -D` — which drops a local HEAD, NOT the `refs/remotes/<arbiter>/work/<slug>` TRACKING ref that actually drives `branchAheadOf`), the merge-time reap (`integrator.ts` ~L649), and `gc --remote-branches` (`reap-branches.ts` ~L148). So the local tracking ref goes stale at the moment of deletion, by construction.

Invert the ordering at EVERY delete site to a **write-through**: delete the LOCAL ref(s) FIRST (the tracking ref `refs/remotes/<arbiter>/work/<slug>` AND any local head `work/<slug>`/`refs/heads/work/<slug>`), THEN `git push <arbiter> --delete`. WHY this ordering is correct (the failure modes are ASYMMETRIC because the arbiter is the source of truth and the local ref is derived):

- **local-first delete fails** → essentially can't (it is a local op); nothing was deleted anywhere → consistent.
- **local deleted, arbiter delete then fails** (network/auth/lost CAS) → the local store is now BEHIND the arbiter (missing a branch the arbiter still has). This is SELF-HEALING: the next `ensureMirror`/`git fetch` re-fetches the branch from the arbiter, and "continue" is then CORRECT (the arbiter really does still have it). No stale-continue bug.
- Compare today's arbiter-first ordering: arbiter deleted, local delete skipped/failed → the local store is AHEAD of the arbiter (a branch the arbiter no longer has), and NOTHING re-prunes it → the exact stale-continue bug, permanent. Inverting the order converts the dangerous failure mode into the self-healing one.

So `requeue --reset` (and the other delete sites) must delete the tracking ref locally first, then the arbiter; on arbiter-delete failure the local-behind state is fine (a fetch restores truth). This keeps mirror+arbiter in sync at the SOURCE of every same-machine mutation.

#### Fix 2 (BACKSTOP, read-side) — continue-detection must be ARBITER-authoritative for the CROSS-MACHINE case

Write-through (fix 1) cannot cover a delete done on ANOTHER machine: `gc --remote-branches` is explicitly the "cross-machine counterpart" — machine B `ls-remote`-enumerates + deletes an arbiter branch; machine A's mirror STILL holds the now-stale tracking ref, and no write-through on B can touch A. `branchAheadOf` reads ONLY local tracking refs (`<arbiter>/work/<slug>`), never `ls-remote`s the arbiter, so A is fooled. So ALSO make continue-detection arbiter-authoritative: before trusting `branchAheadOf`, confirm against the arbiter (`git ls-remote <arbiter> refs/heads/work/<slug>`) — ABSENT-on-arbiter ⇒ "no kept branch → fresh cut", regardless of any local tracking ref. This is path-agnostic (covers in-place clone AND bare mirror) and is the only thing that catches a cross-machine delete. (A plain `remote prune` is NOT sufficient: verified a no-op on the bare mirror, which has no `remote.origin.fetch` refspec.)

Fix 1 keeps same-machine state correct at the source; fix 2 catches the cross-machine residue at the read. Together: NO stale local ref ever drives a "continue".

## Acceptance criteria

- [ ] **Continue-detection is ARBITER-authoritative on the IN-PLACE path:** with a regular clone whose `refs/remotes/<arbiter>/work/<slug>` is STALE (points at a branch deleted on the arbiter; `fetch.prune` unset), onboard decides NO kept branch and starts FRESH — it does NOT continue/conflict. A test reproduces this exact live shape (stale `refs/remotes/origin/work/<slug>` + `fetch.prune` unset + branch gone on arbiter).
- [ ] **Continue-detection is ARBITER-authoritative on the BARE-MIRROR path:** with a bare hub mirror holding an orphaned `refs/remotes/origin/work/<slug>` (the namespace no refspec prunes; verified 57 such stale refs live), onboard starts FRESH. A test pins it.
- [ ] **Write-through ordering at the delete sites:** `requeue --reset` (and, where applicable, the merge-reap / `gc --remote-branches`) deletes the LOCAL tracking ref `refs/remotes/<arbiter>/work/<slug>` (and any local head) BEFORE `git push <arbiter> --delete`. A test asserts the local tracking ref is gone after `--reset` even when the arbiter delete is stubbed; and that when the arbiter delete FAILS (network), the local-behind state is recoverable by a subsequent fetch (does NOT leave a stale-ahead ref that drives a wrong continue).
- [ ] **Today's specific miss is fixed:** `requeue --reset` currently does `git branch -D <branch>` (a local HEAD) but NOT the `refs/remotes/<arbiter>/work/<slug>` tracking ref — the one `branchAheadOf` reads. A test asserts the TRACKING ref is removed by `--reset`, not just the head.
- [ ] **`requeue --reset` leaves NO store able to resurrect a continue:** after `--reset`, neither `git ls-remote <arbiter>`, nor the in-place clone's tracking ref, nor any bare mirror's `refs/remotes/origin/work/<slug>` / `refs/heads/work/<slug>` drives a continue. A test asserts a re-`do` after `--reset` starts FRESH (not continue).
- [ ] **A plain prune is NOT relied upon where it is a no-op:** the fix must NOT assume `git remote prune origin` clears the bare mirror's orphaned `refs/remotes/origin/work/*` (verified no-op — the bare mirror has NO `remote.origin.fetch` refspec). A test asserts the stale bare-mirror ref no longer drives a continue (via `ls-remote` truth or explicit `update-ref -d`), not via `remote prune`.
- [ ] Existing keep+continue behaviour is UNCHANGED when the arbiter branch GENUINELY exists (a real kept branch still continues from its tip, both paths). A test pins that the fix does not break legitimate continue.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `continue-rebase-auto-resolves-protocol-bookkeeping-conflicts` — NOT a logical dependency but a FILE-ORTHOGONALITY serialiser: both slices edit `packages/agent-runner/src/continue-branch.ts` (slice 1 changes `rebaseContinuedBranchOntoMain` / the surface seam; this slice changes the onboard kept-branch-existence decision). Different functions, same file → serialise to keep the rebase trivial (review-skill lens 3). Build slice 1 first (it changes WHERE bookkeeping moves live, which this slice's mirror↔arbiter reconciliation should be consistent with).

## Prompt

> FIRST, drift-check: confirm the mirror-vs-arbiter split still exists — `do --isolated`/`run` use the hub mirror under `~/.agent-runner/repos/…` (see `src/repo-mirror.ts`, `src/mirror-pool-scan.ts`, `src/isolation.ts`) and the kept-branch decision flows through `src/continue-branch.ts`. Reproduce the staleness: delete a `work/<slug>` branch on a throwaway `--bare` arbiter, confirm the mirror still lists `refs/remotes/origin/work/<slug>`, and that a plain `remote prune` does NOT remove it. If the codebase already reconciles mirror→arbiter at onboard (so this can't happen), route to needs-attention noting that. See `work/observations/requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md`.
>
> GOAL (two fixes): (1) PRIMARY — make every branch DELETE write-through: delete the LOCAL tracking ref (`refs/remotes/<arbiter>/work/<slug>`) FIRST, THEN `git push <arbiter> --delete`, at every delete site (`requeue --reset` in `needs-attention.ts`, and where applicable the merge-reap in `integrator.ts` + `gc --remote-branches` in `reap-branches.ts`). The asymmetry is the point: local-first means an arbiter-delete failure leaves the local store BEHIND (self-healing via fetch), never AHEAD (the permanent stale-continue bug). Note `requeue --reset` today deletes only a local HEAD (`git branch -D`), NOT the tracking ref that `branchAheadOf` reads — fix that specifically. (2) BACKSTOP — make continue-detection arbiter-authoritative (`git ls-remote <arbiter> refs/heads/work/<slug>`; absent → fresh cut) so a CROSS-MACHINE delete (another machine's `gc`) cannot fool this machine's stale local ref — write-through alone cannot cover a delete done elsewhere.
>
> SEAMS TO TEST AT: `requeue --reset` (assert the local TRACKING ref is removed before the arbiter delete, and that an arbiter-delete failure leaves a recoverable behind-state, not a stale-ahead one); and the onboard continue-vs-fresh decision (`continue-branch.ts`/`isolation.ts`) with a stale local tracking ref whose arbiter branch is gone (assert FRESH cut via `ls-remote` truth). Use throwaway `--bare` `file://` arbiters + real clones/mirrors as the existing isolation/mirror tests do; no network. Verify a plain `remote prune` is NOT relied on (no-op on the bare mirror).
>
> DONE: stale mirror refs can no longer drive a "continue", `--reset` is provably effective, legitimate continue still works, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.

## Needs attention

agent failed: 401 {"error":{"type":"authentication_required","message":"OAuth refresh token expired or revoked. Run: node scripts/oauth-login.js"}}
