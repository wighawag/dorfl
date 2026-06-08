# 2026-06-06 — a needs-attention bounce degrades unevenly on an arbiter git-op FAILURE (branch push best-effort; surface publish throws)

Noticed while reviewing `centralise-bounce-branch-push` (PR #10) + clarifying what
"offline arbiter" means.

## The two halves of a bounce have OPPOSITE error policies

A needs-attention bounce does TWO things against the arbiter, and they handle a
failed git op differently:

- **RECOVERABLE (branch push)** — `routeToNeedsAttention` (`src/needs-attention.ts`)
  pushes `work/<slug>` via `gitSoftRun` → **best-effort, never throws**. A failed
  push (non-zero exit, for ANY reason) is swallowed: the bounce still completes, the
  item still moves to `needs-attention/` locally, the worktree is RETAINED (the §4
  reap predicate fails — branch not provably on arbiter), and the work is NOT lost
  (it is on the local branch). Recovery degrades from cross-machine to this-machine.
- **OBSERVABLE (surface publish)** — `publishSurfaceCommit` (`src/ledger-write.ts`)
  cherry-picks the move-only commit onto the arbiter's `main`, and its `fetch` uses
  `gxHard` → **throws on failure**. (It DOES soft-handle CONTENTION — a push rejected
  because main moved → refetch + retry → `{kind:'rejected'}`, no throw — but a
  genuine can't-reach-the-arbiter on the `fetch` throws.)

The surface publish runs AFTER the branch push in the seam. So on a genuine arbiter
git-op failure, the surface-publish throw propagates out of `applyNeedsAttention
Transition` → `saveAgentFailure` / the run/complete bounce → potentially aborting
the work, instead of cleanly leaving a retained, locally-saved, recoverable state
like the branch-push half chose.

## Scope / severity (deliberately bounded)

- This is NOT about a `--local`/`--bare` arbiter being "offline." A `--local`
  arbiter is a FIRST-CLASS, always-reachable remote (transport-agnostic seam); it
  behaves exactly like a hosted remote in normal operation and NEVER exercises this
  path unless the FILESYSTEM faults (path removed / unwritable). For a hosted remote
  it needs an actual network/auth failure. So this only bites on a GENUINE arbiter
  git-op failure — rare, especially for `--local`.
- It is NOT work-loss: the local commits survive in the worktree either way.
- It IS an inconsistency: one half of one operation degrades gracefully, the other
  crashes, on the same underlying condition (a failed arbiter git op).

## Open question (verify before any fix)

Does the surface-publish throw abort the WHOLE `run` tick, or does `runOneItem`'s
try/finally catch it per-item (teardown runs, the tick continues to the next item)?
That determines severity: per-item-contained = minor; whole-tick-abort = a fleet
losing connectivity mid-bounce crashes the runner. Verify before deciding slice-vs-
leave.

## Fix shape (if warranted)

Make a bounce degrade UNIFORMLY on an arbiter git-op failure: the surface publish's
unreachable-arbiter case should degrade-and-retain (like the branch push) rather
than throw — the item is still saved locally + the branch is still local, so a
retained worktree + a later online retry is the graceful outcome. Keep the
CONTENTION handling (lease/refetch) as-is — that is a different, healthy path.
Pre-existing (predates the push consolidation); revisit if it bites.

## Triage 2026-06-08 — HOLD (need more context)

Maintainer decision: **HOLD** — needs more context to answer the open question
(per-item-contained vs whole-tick-abort severity; whether `runOneItem`'s try/finally
already contains the throw so only the one item bounces). Not promoted yet. Revisit
with the container analysis (does a surface-publish throw abort the whole tick, or
just the one item?) before deciding keep-as-is vs slice.
