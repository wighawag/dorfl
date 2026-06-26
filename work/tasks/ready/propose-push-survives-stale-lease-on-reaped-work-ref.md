---
title: Propose integrator push survives a stale-lease ("stale info") on a concurrently moved/reaped work ref
slug: propose-push-survives-stale-lease-on-reaped-work-ref
blockedBy: []
covers: []
---

## What to build

Make the `propose`-mode integrator push race-tolerant against a `work/<slug>`
ref that moved or was deleted on the arbiter between this job's last fetch and
its push. Today that push throws a hard error on `stale info`; under the
parallel merge/propose fan-out (the landed `ci-template-parallel-merge-fanout`
template) this surfaces as a RED CI leg for work that, in the observed
incident, had ALREADY landed on `main` and had its `work/<slug>` head reaped.

The propose path is the ODD ONE OUT among the system's work-branch pushes:

- The continue/recovery work-branch reconcile pushes thread an EXPLICIT
  `--force-with-lease=<branch>:<expectedTip>` AND survive a `stale info`
  rejection by re-observing the arbiter tip + replaying (the shared retry
  helper used by the continue/onboard paths).
- The propose integrator push instead uses a BARE `--force-with-lease=<branch>`
  (expected value implied from the remote-tracking ref) through a plain
  THROWING push helper, with NO stale-lease survival.

Bring the propose push in line with the rest of the system's "the work branch
is UNSHARED, so a stale lease is a stale LOCAL view, not a rival" treatment,
WITHOUT ever introducing a bare `--force`, ever targeting `main`, or ever
clobbering a ref whose movement is NOT explained by our own stale view.

Two sub-cases the push must distinguish (do not collapse them):

1. **Stale view, ref still present + still ours to advance** (the recovery
   rewrite case): re-observe + re-lease + retry, bounded, exactly as the
   existing work-branch retry helper does. End state: branch pushed.
2. **Ref already GONE and the work already landed on `main`** (the observed
   race tail: the land/done-move reaped the head): this is a BENIGN
   already-landed no-op, mirroring the reaper's "benign already-reaped"
   outcome — it must NOT be a hard failure. Confirm the work is provably on
   `<arbiter>/main` (ancestor check) before treating the gone-ref as success;
   if it is NOT provably landed, that is a REAL failure that must surface
   (never silently swallow lost work).

Anything that is neither (connectivity, auth, a protected ref, a genuine
non-fast-forward that is NOT explained by our stale view) must still SURFACE,
never be retried into a clobber.

## Observed incidents (two real triggers; the build must cover BOTH)

This push fails from two distinct callers; both observed in CI, both BENIGN
race tails (the work had ALREADY landed on `main` and the `work/<slug>` ref
was already reaped). Sub-case 2 (gone-ref + provably-landed = benign) is the
expected outcome for BOTH:

1. **First-pass propose under the parallel fan-out.** A `advance-propose`
   matrix leg's integrator push raced a sibling's land/done-move that reaped
   the ref. (`! [rejected] work/task-<slug> (stale info)`.)
2. **Recovery-complete (the DOMINANT trigger; test this one explicitly).**
   A `dorfl advance ... --propose` run found a stranded already-complete
   branch, REBASED the kept branch onto `<arbiter>/main` (which REWRITES the
   tip, a rewrite the integrator propose comment already anticipates),
   then the propose push reconciled the rewritten tip with the bare lease and
   hit `stale info` because the ref had been reaped after the earlier land.
   The recovery note itself says "this signals an earlier un-merged PR": that
   means the work is very likely ALREADY on `main`, so the gone-ref-is-benign path
   is the NORMAL recovery outcome, not an edge case. The push is reached via
   the recovery rebase in the integration core → the propose branch of the
   integrator; the test must drive THAT path (a kept-branch recovery whose
   work already landed + whose ref is gone), not only the first-pass propose.

## Acceptance criteria

- [ ] A `propose` integrator push that hits `stale info` because OUR view of
      `<arbiter>/work/<slug>` is stale (ref still present, still ours) re-leases
      against the freshly-observed tip and retries, bounded by the same
      instant-contention cap the other work-branch pushes use. It lands the
      branch instead of throwing.
- [ ] A `propose` integrator push whose `work/<slug>` ref is GONE on the
      arbiter AND whose work is provably an ancestor of `<arbiter>/main` is
      reported as a BENIGN already-landed success (no throw, no PR re-open
      attempt against a vanished ref), distinct from a real push failure.
- [ ] A `stale info` / non-ff whose work is NOT provably on `<arbiter>/main`,
      and every non-stale failure (connectivity, protected ref, auth), still
      SURFACES as a terminal failure — never retried into a bare force, never
      swallowed. Assert no `--force` (bare) and no `:main` destination is ever
      emitted by this path (extend the existing all-push-sites safety sweep).
- [ ] The RECOVERY-complete path (kept branch rebased onto `<arbiter>/main`,
      tip rewritten, ref already reaped, work provably on `main`) reaches the
      same BENIGN already-landed success, asserted with a recovery-flow test,
      not only a first-pass propose test. This is the dominant real trigger.
- [ ] The first-time propose (no remote `work/<slug>` yet) path is UNCHANGED.
- [ ] Tests cover all four shapes above at the integrator seam, mirroring the
      existing stale-lease / continue-branch test style (temp bare arbiter +
      worktrees; a churn/delete shim to force the race deterministically). The
      tests assert EXTERNAL behaviour (outcome + the arbiter end-state), not the
      retry helper's internals.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — the stale-lease retry helper, the leased-delete "benign already-gone"
  precedent, and the integrator propose seam all already exist. This task
  generalises their treatment to the propose push.

## Prompt

> A CI `advance-propose (task:<slug>)` leg failed with
> `! [rejected] work/task-<slug> -> work/task-<slug> (stale info)` from a
> `git push ... --force-with-lease=work/task-<slug>`. The work had ALREADY
> landed on `main` and its `work/<slug>` head had been reaped, so the leg was
> a superseded race tail — but it surfaced as a hard RED CI failure. The
> landed `ci-template-parallel-merge-fanout` template increased the
> parallelism that exposes this.
>
> FIRST, check this task against current reality (it is a launch snapshot and
> may have DRIFTED): confirm the propose integrator push still uses a BARE
> `--force-with-lease=<branch>` through a plain throwing push helper, and that
> the continue/onboard work-branch pushes still go through the shared
> stale-lease retry helper that threads an EXPLICIT `<branch>:<expectedTip>`
> lease and survives `stale info`. If the propose push has since been unified
> with that helper, route to needs-attention (the premise is already fixed).
>
> The goal: the propose push must treat the UNSHARED work branch the way the
> rest of the system already does — a `stale info` is a stale LOCAL view, not
> a rival. Reuse the existing work-branch stale-lease retry semantics rather
> than inventing a parallel mechanism. Add the one NEW case the continue path
> does not have: a `work/<slug>` ref that is GONE because the work already
> LANDED on `main` is a BENIGN already-landed success (confirm via an
> ancestor check against `<arbiter>/main`, mirroring the leased-delete
> "benign already-reaped" / merged-head-reap ancestor guard), NOT a failure.
> Everything else (not-provably-landed, connectivity, protected ref, auth)
> still SURFACES.
>
> Guardrails are absolute (ADR §11): `--force-with-lease` ONLY, re-computed
> each attempt; NEVER a bare `--force`; NEVER a `:main` destination; the WORK
> branch ONLY. Extend the existing all-push-sites safety sweep so the propose
> path is covered by it.
>
> Look (by concept, not brittle paths): the integrator's propose branch (the
> `--force-with-lease=<branch>` push + its plain push helper); the shared
> work-branch stale-lease retry helper (its `stale info` detection, bounded
> re-fetch + re-lease + retry, and terminal-throw contract); the per-item
> leased-delete + merged-head-reap ancestor guards for the "benign
> already-gone, provably landed" precedent; and the RECOVERY-complete flow
> that reaches this push: the integration core's recovery rebase of a kept
> already-complete branch onto `<arbiter>/main` (the dominant real trigger,
> per the Observed incidents above), invoked from the complete path's
> committed-recovery branch. Test BOTH callers at the integrator seam with the
> existing temp-bare-arbiter + worktree harness and a deterministic
> churn/delete git shim. Run the AGENTS.md acceptance gate.
>
> RECORD non-obvious in-scope decisions (a `## Decisions` block in the done
> record / PR description, or an ADR if it meets the bar): e.g. the exact
> predicate for "benign already-landed" (ancestor-of-main on the GONE-ref
> branch), and whether the propose push reuses the continue helper verbatim
> or wraps it. An un-recorded in-scope decision is a review FINDING.
