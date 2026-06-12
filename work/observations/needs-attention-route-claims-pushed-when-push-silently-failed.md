---
title: On a network failure, the needs-attention route REPORTS "surfaced on main; pushed work/<slug>" even though BOTH pushes silently failed — moved:true reflects only the LOCAL move, so the operator is told the branch+surface are on the arbiter when they are not
date: 2026-06-08
status: resolved
---

> RESOLVED 2026-06-12 by slice
> `stale-lease-retry-all-push-sites-and-treeless-surface`. The specific
> silent-strand failure mode this note captured (a continue-path push that
> ultimately FAILS after the work is committed leaving the slice silently in
> `work/in-progress/` on the arbiter) now SURFACES to `needs-attention/` with the
> push-failure cause recorded and the green branch left intact + recoverable:
> `createJob` / the in-place strategy / `start.ts` CATCH the helper's terminal
> throw and route to needs-attention (the `continuePushFailure` signal + the
> `routeContinuePushFailure` surface), instead of letting it escape uncaught.
> Combined with the earlier honest-reporting fix (`routeToNeedsAttention` already
> captures `branchPush`/`pushError`), the operator is no longer told the work is
> cross-machine-safe when a push failed — and the stuck item is now observable.

## The signal

Observed live this session: building `prd-sliced-folder-step-a`, the agent hit a transient `Connection error.` mid-build. The runner printed:

> Agent failed building 'prd-sliced-folder-step-a' (Connection error.); SAVED the partial work and routed it to work/needs-attention/ (surfaced on origin/main; **pushed work/prd-sliced-folder-step-a**). Recover via `requeue` …

But when the conductor went to recover, **the branch did NOT exist on origin** — even though the message said "pushed work/prd-sliced-folder-step-a".

## CORRECTED mechanism (traced 2026-06-08, more precise than the first cut)

The agent's `Connection error.` was the **MODEL endpoint (pi harness), NOT git** — GitHub was reachable the whole time. The precise sequence:

1. The agent failed EARLY (before producing meaningful committed work). The wip-commit step (`git add -A`; commit only if staged) found nothing meaningful → the `work/<slug>` branch tip stayed at/around the claim commit.
2. The move-only needs-attention commit was made and its SURFACE push to `origin/main` **SUCCEEDED** (git was up — a later `git pull` fetched that move).
3. The branch push was **SKIPPED by the emptiness guard**: `branchAheadOf(work/<slug>, main)` was false (the branch had nothing beyond main after the surface), so the code hit the `else` → `note('Skipped pushing … nothing to recover')` and did NOT push.

So the two halves of the message diverged from reality differently:

- `surfaced on origin/main` → **TRUE**.
- `pushed work/<slug>` → **FALSE — the push was SKIPPED** (not failed). The message hardcodes "pushed `${branch}`" whenever `moved` is true, regardless of whether the branch push actually ran, was skipped by the emptiness guard, or failed soft.

The original "both pushes failed" framing below is the OTHER reachable case (a genuine git/provider outage); the message is wrong in BOTH cases. The fix must report what actually happened for EACH of: surfaced (yes/no/failed) and branch-pushed (yes/skipped-empty/failed).

---

(original framing, still valid for the git-outage case:) The operator was told the work was safe + recoverable cross-machine when it was only saved LOCALLY.

## Root cause (the exact seam)

`applyNeedsAttentionTransition` (`src/ledger-write.ts`) does THREE things and returns `{moved: true}` based on only the FIRST:

1. `routeToNeedsAttention` (`src/needs-attention.ts`) — the LOCAL `git mv` + wip/move commits. Succeeds offline (no network). Sets `moved: true`.
   - Its RECOVERABLE branch push is **best-effort**: `gitSoftRun(['push', arbiter, '<branch>:<branch>'])` — the doc-comment says verbatim _"BEST-EFFORT (no throw on a failed/unreachable push)"_. The push RESULT is **not captured** and not reflected in the return value.
2. `publishSurfaceCommit` — the OBSERVABLE "surface on main" push. Also soft on the final `git push` (`if (push.status === 0) … return; … emit('… left unsurfaced')`). It can `emit` a failure note but does NOT change `moved`, and the caller does not read it.
3. Returns `{moved: true, commitMessage, moveCommit}` — `moved` is TRUE the moment the LOCAL move committed, irrespective of either push.

The caller (`src/do.ts` `saveAgentFailure`, ~line 843) then branches ONLY on `routed.moved` and unconditionally prints `"… (surfaced on ${arbiter}/main; pushed ${branch})"`. There is no signal threaded back to distinguish "moved locally AND pushed" from "moved locally but BOTH pushes failed (offline)". So on a network failure the message is a flat lie. (The same pattern is in the `--remote` `saveAgentFailure` at ~line 1487 and the STOP-route message at ~line 925.)

## Why it matters

A needs-attention route exists to make a stuck item **observable (on main) + recoverable (branch on arbiter) cross-machine**. When the network is down, NEITHER holds — yet the operator is told both do. Consequences:

- A human/CI trusts "pushed work/<slug>" and a teammate on another machine cannot find the branch (it is only local).
- `requeue` (keep+continue) is documented to continue from the ARBITER branch tip; if the branch never reached the arbiter, a continue from a clean clone has nothing to continue from — the saved work is local-only and invisible to the protocol's recovery path.
- It masks the very failure (network) the operator most needs to know about to retry.

## Fix direction

Make the reported message reflect what ACTUALLY landed on the arbiter, not just the local move. Concretely:

1. **Capture both push results** in `routeToNeedsAttention` / `applyNeedsAttentionTransition`: return e.g. `{moved, surfaced: boolean, branchPushed: boolean, pushError?: string}` alongside `moveCommit`. The surface push already knows (it `emit`s on failure); the branch push currently discards its `RunResult` — capture it.
2. **Branch the message on those flags** in `saveAgentFailure` (+ the `--remote` and STOP copies): only claim "surfaced on main" / "pushed <branch>" for the pushes that SUCCEEDED. When a push failed, say so loudly and tell the operator the work is **saved LOCALLY only** (and how to push it once connectivity returns), rather than implying cross-machine safety.
3. **Consider: is local-only "moved" even a success here?** For an autonomous fleet (`run`/CI) a needs-attention route whose pushes both failed has NOT made the item observable/recoverable to anyone else — arguably it should surface the PUSH failure as the headline, not bury it under "SAVED + routed". At minimum the exit/notification should make the degraded (local-only) state unmistakable.

Keep the pushes best-effort (don't crash the tick on a network blip) — the bug is not that they're soft, it's that their failure is **invisible in the report**. The fix is honest reporting, not hard-failing.

## Related

- `run-thrown-core-error-labeled-agent-failed.md` — adjacent: that one is about mis-CLASSIFYING a thrown config error as `agent-failed`; this one is about the needs-attention route MIS-REPORTING the remote effects of an (any-cause) failure. Both touch the same `saveAgentFailure` reporting surface and both reduce operator trust in the stuck-state message.
- `slicing.ts`'s own needs-attention routing (the slice path) reuses the same `applyNeedsAttentionTransition` seam, so it inherits the same mis-report.
