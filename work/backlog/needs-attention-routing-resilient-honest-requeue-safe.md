---
title: Make needs-attention routing network-fault-tolerant + honestly-reported + requeue-safe — retry git pushes with bounded backoff, never crash the failure handler, report exactly what landed (surface / branch / PR), and refuse a keep+continue requeue when the work branch is not on the arbiter
slug: needs-attention-routing-resilient-honest-requeue-safe
blockedBy: []
covers: []
---

## What to build

When the runner routes a stuck item to `work/needs-attention/` (agent failure,
gate red, rebase conflict, STOP), the route does a LOCAL move (always succeeds) +
two REMOTE git pushes (the OBSERVABLE surface-to-`main`, the RECOVERABLE
`work/<slug>` branch push) + optionally a PR creation (propose mode). Today three
things go wrong when the network / git provider is degraded:

1. **The failure handler can itself CRASH.** The surface step does
   `gxHard(['fetch', …])` (`publishSurfaceCommit` in `src/ledger-write.ts`) which
   THROWS on an unreachable remote, and that throw is NOT caught in
   `saveAgentFailure` (`src/do.ts`). So the very path meant to save+report a
   failure explodes when the network is the failure.
2. **The report LIES about what reached the arbiter.** The message hardcodes
   "surfaced on `<arbiter>/main`; pushed `<branch>`" whenever the LOCAL move
   succeeded (`routed.moved`), regardless of whether the surface push succeeded,
   the branch push was SKIPPED by the emptiness guard (`branchAheadOf` false on an
   early failure), or either push FAILED. (Observed live: model-endpoint outage
   left git reachable → surface succeeded, branch push was skipped-empty, yet the
   message claimed "pushed".)
3. **`requeue` (keep+continue) can make an item falsely claimable.** The default
   requeue (`returnToBacklog`) moves `needs-attention → backlog` WITHOUT verifying
   `work/<slug>` is on the arbiter. If the branch never reached the arbiter (skipped
   or failed), the item becomes claimable and a worker on ANOTHER machine
   "continues" from a branch that isn't there → `branchAheadOf` false → it silently
   starts FROM SCRATCH, losing the only copy of the work (local to the first
   machine).

End-to-end behaviour after this slice:

- **Resilient:** the needs-attention route NEVER crashes on a network/git outage —
  every remote op (surface fetch+push, branch push, PR create) is fault-tolerant
  (caught), and is RETRIED with **bounded exponential backoff** (interval X →
  exponential to cap Y → give up after total Z; configurable, with sensible
  defaults; NOT indefinite — a clean bounded give-up beats a hang). The backoff
  must use an **injectable sleep seam** (so tests drive retries WITHOUT wall-clock
  waits) — reuse the `sleep?: (ms) => Promise` / `realSleep = setTimeout` pattern
  already in `src/run.ts` (the tick loop's inter-tick sleep). NOTE:
  `src/claim-cas.ts`'s retry loop is NOT a temporal-backoff model to copy — it
  loops/refetches INSTANTLY (count-capped) for a CONTENDED (rejected) push; this
  slice adds the OUTAGE/unreachable retry-WITH-DELAY that does not exist today.
- **Honest:** the route captures and reports EXACTLY what landed, per op:
  - surface: ✓ / failed-after-retries
  - branch push: ✓ / skipped-empty (nothing to recover yet) / failed-after-retries
  - PR create (propose only): ✓ (url) / failed-after-retries
  No message claims an effect that did not happen. On any push failure the message
  states the work is **saved LOCALLY only** and how to recover (push the branch when
  online, then requeue).
- **Requeue-safe:** the default (keep+continue) `requeue` REFUSES when the ARBITER
  branch `<arbiter>/work/<slug>` is absent — "the work branch isn't on `<arbiter>`;
  push it first, or `requeue --reset` to discard and start fresh" — protecting the
  cross-machine continue invariant (a claimable item's continue-branch MUST be
  reachable by any worker). The check is against the ARBITER ref, not the local
  `work/<slug>` (which survives a failed push): FETCH first, then test
  `<arbiter>/work/<slug>` — reuse the EXACT pattern the continue-path uses at
  `src/isolation.ts` (`branchAheadOf(checkout, '<arbiter>/<branch>',
  '<arbiter>/main')`). `--reset` is unaffected (it discards the branch by design).

### Two distinct failure MODES (same backoff, different severity)

- **Push failure (surface / branch) — HIGH severity.** Risks work-loss /
  breaks cross-machine recovery. After retries give up → "saved LOCALLY only",
  and it GATES `requeue` (per the requeue-safe guard above).
- **PR-creation failure (propose) — LOW severity.** The branch IS pushed → the work
  is safe + continuable; only the review SURFACE is missing. After retries give up →
  honestly report "branch pushed ✓ but PR creation failed — open it manually (reuse
  the suggested `gh pr create …`) / re-run; the work is safe", and DO NOT gate
  requeue. Extend the GitHub provider's EXISTING graceful-degrade (`degrade()` in
  `src/github.ts`, today only for a missing/unauth `gh`) to also cover the
  outage-after-retries case with the same manual-command instruction.

## Acceptance criteria

- [ ] A simulated unreachable arbiter during the needs-attention route does NOT
      throw out of `saveAgentFailure` / the route — it is caught, retried with
      backoff, and (on give-up) returns a clean degraded result (no unhandled
      exception). (Test via the throwaway-git harness pointing the arbiter at an
      unreachable/again-reachable remote, or an injected git seam.)
- [ ] Git network ops in the route (surface fetch+push, branch push) RETRY with
      bounded exponential backoff (interval/cap/total configurable; defaults
      asserted) and give up cleanly — NOT indefinitely.
- [ ] The reported message reflects per-op reality: surface ✓/failed, branch
      ✓/skipped-empty/failed, PR ✓/failed — asserted across (a) all-succeed, (b)
      surface-ok + branch-skipped-empty (the observed early-failure case), (c)
      push-fails-after-retries. No message claims an unperformed push.
- [ ] On a branch-push failure, the message says the work is saved LOCALLY only +
      how to recover; `routeToNeedsAttention` /
      `applyNeedsAttentionTransition` return the per-op flags
      (e.g. `surfaced`, `branchPushed`, `prOpened`, `pushError?`) the message reads.
- [ ] PR-creation failure (propose) is a DISTINCT low-severity mode: retried with
      the same backoff, then degraded with the manual-`gh pr create` instruction
      (extending `github.ts`'s `degrade()`), branch reported as pushed ✓, work
      reported safe — and it does NOT gate requeue.
- [ ] Default (keep+continue) `requeue` REFUSES when the ARBITER branch
      `<arbiter>/work/<slug>` is absent (checked against the arbiter ref after a
      fetch — reusing `isolation.ts`'s `branchAheadOf(…, '<arbiter>/<branch>',
      '<arbiter>/main')` pattern — NOT the local ref, which survives a failed push):
      returns `{moved:false, reasonNotMoved}` with the push-first / --reset guidance.
      A present arbiter branch still requeues; `--reset` is unaffected; a
      no-arbiter (purely-local) requeue keeps today's behaviour.
- [ ] The backoff helper takes an INJECTABLE sleep (reusing `run.ts`'s
      `sleep`/`realSleep` seam) so the retry timeline is driven deterministically in
      tests with NO real wall-clock waits.
- [ ] Tests cover all of the above in the repo's throwaway-git integration style
      (`GIT_CONFIG_GLOBAL` isolation; an unreachable-then-reachable arbiter or an
      injected git/push seam to drive the outage + retry paths deterministically).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. (Independent of other backlog slices; primarily
  `src/needs-attention.ts`, `src/ledger-write.ts`, `src/do.ts` save/report sites,
  `src/github.ts`'s degrade, and a small shared backoff helper.)

## Prompt

> Make the needs-attention routing path network-FAULT-TOLERANT, HONESTLY-reported,
> and REQUEUE-SAFE. Three coupled defects (all observed/traced 2026-06-08; see
> `work/observations/needs-attention-route-claims-pushed-when-push-silently-failed.md`):
> the failure handler can CRASH on a git outage (an uncaught `gxHard(['fetch'])`
> throw in `publishSurfaceCommit`); the report LIES (hardcodes "surfaced … pushed
> <branch>" off the LOCAL move regardless of the actual push outcome — surface can
> succeed while the branch push is skipped-empty or failed); and the default
> `requeue` can make an item claimable whose continue-branch never reached the
> arbiter (cross-machine workers then continue from nothing and lose the work).
>
> DOMAIN VOCABULARY: the needs-attention route is
> `routeToNeedsAttention`/`returnToBacklog` (`src/needs-attention.ts`) wrapped by
> `applyNeedsAttentionTransition`/`applyReturnToBacklogTransition` +
> `publishSurfaceCommit` (`src/ledger-write.ts`). The OBSERVABLE surface push goes
> to `<arbiter>/main` (mode-M, a `--force-with-lease` fast-forward of a scratch-index
> move-only commit; it `gxHard(['fetch'])` first — that is the THROW to catch). The
> RECOVERABLE branch push is `gitSoftRun(['push', arbiter, 'work/<slug>:work/<slug>'])`
> guarded by `branchAheadOf` (`src/continue-branch.ts`, LOCAL refs only) — that guard
> is correct (skip an empty branch) but its skip must be REPORTED as skipped, not as
> pushed. The message sites are `saveAgentFailure` (`src/do.ts`, in-place ~L843 +
> `--remote` ~L1487 + the STOP-route ~L925) and the success/propose messages in
> `src/complete.ts` (~L579) — make them all read the per-op result rather than
> assume. The PR creation is the GitHub provider in `src/github.ts` (`gh pr create`),
> which ALREADY has a `degrade()` for a missing/unauth `gh`; extend that pattern to
> the outage-after-retries case.
>
> RETRY/BACKOFF: add a small shared bounded-exponential-backoff helper (interval X,
> exponential to cap Y, give up after total Z) and apply it to the route's git
> network ops (surface fetch+push, branch push, PR create). The helper must take an
> **INJECTABLE sleep** so tests drive the retry timeline deterministically with NO
> real waits — reuse the existing `sleep?: (ms) => Promise<void>` /
> `realSleep = (ms) => new Promise(r => setTimeout(r, ms))` seam in `src/run.ts`
> (the tick loop already injects its inter-tick sleep this way). DO NOT model this
> on `src/claim-cas.ts`'s `retries`/refetch loop — that loop retries CONTENTION (a
> REJECTED push) INSTANTLY with no temporal delay; the OUTAGE/unreachable
> retry-with-delay this slice needs does not exist in the codebase yet. Bounded,
> configurable, sensible defaults — NOT indefinite (a clean bounded give-up into the
> local-only degraded state beats a hang; CI/humans then retry deliberately).
> Model-endpoint retries are the HARNESS's job (pi retries its own API) — do NOT add
> model retries here; this is git/provider only.
>
> TWO FAILURE MODES, one backoff, different severity + consequence:
>   - PUSH failure (surface/branch) = HIGH: work-at-risk / breaks cross-machine
>     recovery → "saved LOCALLY only" + GATE requeue.
>   - PR-create failure (propose) = LOW: branch is up, work safe, only the review
>     surface missing → degrade with the manual `gh pr create` instruction, report
>     branch pushed ✓, do NOT gate requeue.
>
> REQUEUE GUARD (fold in): in `returnToBacklog` (`src/needs-attention.ts`), the
> DEFAULT (keep+continue) path must verify the ARBITER branch
> `<arbiter>/work/<slug>` exists before moving to backlog; if not, refuse
> `{moved:false, reasonNotMoved:"…push the branch first, or requeue --reset to
> discard and start fresh"}`. CHECK THE ARBITER REF, NOT THE LOCAL ONE: the local
> `work/<slug>` survives a failed push, so testing it would pass falsely — FETCH
> first, then test `<arbiter>/work/<slug>`, reusing the EXACT pattern the
> continue-path uses in `src/isolation.ts` (`branchAheadOf(checkout,
> `${arbiter}/${branch}`, `${arbiter}/main`, env)` — same "is the continue-branch on
> the arbiter?" question). `--reset` is unaffected (it deletes the branch on
> purpose). This protects the invariant: a claimable item's continue-branch MUST be
> reachable by any worker. NOTE: when an `arbiter` is not supplied to requeue at all
> (a purely-local requeue), keep today's behaviour — the guard applies only when an
> arbiter is in play (the cross-machine case it protects).
>
> SEAM TO TEST AT: the throwaway-git integration harness (an unreachable-then-
> reachable `--bare`/`file://`-or-bogus arbiter, or an injected git/push seam) to
> drive outage → retry → give-up deterministically; assert no throw escapes, the
> per-op report is accurate for all-ok / surface-ok+branch-skipped / push-failed,
> the PR-fail degrade, and the requeue refusal on a missing arbiter branch.
>
> SCOPE FENCE: keep the pushes BEST-EFFORT in spirit (don't crash the tick) — the
> fix is resilience + honesty + the requeue guard, NOT changing WHEN an item routes
> to needs-attention. Do NOT add model retries (harness owns those). Do NOT change
> the autonomous-fleet exit/notification SEMANTICS for a local-only-stuck item
> (whether `run`/CI should treat it specially is a separate fleet-policy concern) —
> this slice makes the state honest + safe, not a new fleet policy.
>
> FIRST run the drift check: confirm `publishSurfaceCommit` still `gxHard`-fetches
> (uncaught), the message still hardcodes "pushed <branch>" off `routed.moved`, and
> `returnToBacklog` default path still lacks an arbiter-branch check. If any already
> landed, route to `needs-attention/` with the discrepancy.
>
> "Done" = the needs-attention route never crashes on a git outage, retries with
> bounded backoff, reports exactly what landed (surface/branch/PR), gives honest
> local-only guidance on push failure, degrades PR-create as a distinct low-severity
> mode, the default requeue refuses on a missing arbiter branch, tests cover it, and
> `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

## Provenance

Promoted from `work/observations/needs-attention-route-claims-pushed-when-push-silently-failed.md`
(2026-06-08), surfaced + traced live while conducting the `slicing-coherence`
chain (the `prd-sliced-folder-step-a` build hit a model-endpoint `Connection
error.` and the route mis-reported the branch as pushed). Folds in the maintainer's
refinements: bounded-backoff retry (not indefinite), the requeue-safety guard, and
the PR-vs-push distinct-failure-mode treatment. Delete that observation once this
slice lands in `done/`.
