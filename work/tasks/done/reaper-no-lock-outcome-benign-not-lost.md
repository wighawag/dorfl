---
title: Reaper treats an already-cleared (no-lock) reconcile as BENIGN, not `lost` — concurrent double-reap exits 0
slug: reaper-no-lock-outcome-benign-not-lost
blockedBy: []
covers: []
---

## What to build

Fix a false-positive non-zero exit in the human-invoked stale-lock reaper
(`gc --ledger --reap-stale-locks`) under a CONCURRENT double-reap of the SAME
stale lock.

The reaper (`reapStaleItemLocks` in the item-lock module) walks each held lock
and, for the `cleared-stale` class, routes the actual clear through the
recovery's shared leased delete (`reconcileItemLockAgainstMain`). It then
dispatches on that re-read outcome: `cleared-stale` → `reaped`, `kept-*` → kept,
and EVERYTHING ELSE → `lost`. That catch-all `else` also swallows `no-lock` —
which is exactly what the LOSER of a concurrent double-reap sees: the OTHER
reaper already deleted the ref, so the loser's reconcile re-read returns
`no-lock`. The loser then counts it as `lost`, and `reapReportNeedsAttention`
makes the whole sweep exit 1 — even though nothing needs attention (the lock WAS
successfully reaped, just by the other process).

The slice: in the reaper's `cleared-stale` arm, classify a `no-lock` reconcile
outcome as a BENIGN already-reaped no-op (the lock is already gone = the desired
end state) — DISTINCT from a genuine `lost` (the leased delete was REJECTED
because the ref changed to a DIFFERENT value, a real concurrent-mutation race).
The benign outcome must NOT contribute to `reapReportNeedsAttention` / the
non-zero exit; a genuine `lost` STILL must. Result: a clean concurrent sweep
exits 0; a real lost-race still exits 1.

This is small and local: the outcome classification in the `cleared-stale` arm,
the `ReapOutcome` union + its needs-attention accounting in
`reapReportNeedsAttention`, and a tightened test assertion. Do NOT collapse the
real-race `lost` path into the benign one — the two must stay separable.

### Background (from the originating review)

This edge was surfaced by the Gate-2 review while merging the opt-in reaper
(the now-done `gc-ledger-reap-stale-locks-opt-in-flag`, PR #183), ratified
non-blocking at merge. It errs on the SAFE side (fail-loud, never mis-reaps or
`--force`s) and only manifests under concurrent double-reap of the same lock — an
unusual manual operation (the reaper is a human-invoked sweep, not a daemon) — so
it is low-priority, but it does turn a routine concurrent sweep into a spurious
exit 1. The same review also flagged that the reaper's exit-code contract was
never written down (see the Decisions criterion below).

## Acceptance criteria

- [ ] In the reaper's `cleared-stale` arm, a `no-lock` reconcile outcome is
      classified as a BENIGN already-reaped no-op (e.g. a `reaped`/`already`-style
      outcome), NOT as `lost`, and does NOT contribute to the needs-attention /
      non-zero exit.
- [ ] A genuine leased-delete REJECTION (the ref changed to a DIFFERENT value) is
      STILL classified `lost` and STILL reports / exits non-zero. Real races are
      not collapsed into the benign outcome.
- [ ] A concurrent double-reap of the SAME stale lock: both reapers finish,
      exactly one reports the reap and the other the benign already-reaped
      outcome, and BOTH processes exit 0. The existing two-reaper test is
      TIGHTENED from `lost <= 1` to assert the loser sees the new benign outcome
      (not `lost`) and that neither reaper's report needs attention.
- [ ] A `## Decisions` block records the reaper's exit-code contract: exit 0 when
      all stale locks are reaped and only healthy in-flight locks remain; exit 1
      when a `kept-stuck` survives or a delete genuinely lost the race / errored.
      (This was nit 1 from the same review and was never written down.)
- [ ] Tests cover the new behaviour (mirror the repo's existing test style) and
      use throwaway git repos + a local `--bare` `file://` arbiter; nothing writes
      outside its own temp fixtures.

## Blocked by

- None — can start immediately. The reaper this fixes
  (`gc-ledger-reap-stale-locks-opt-in-flag`) is already in `work/tasks/done/`.

## Prompt

> Goal: fix a spurious non-zero exit in the human-invoked stale-lock reaper
> (`gc --ledger --reap-stale-locks`) when two reapers race to clear the SAME stale
> lock. The LOSER currently mislabels an already-cleared lock as `lost` and forces
> the whole sweep to exit 1, even though the lock WAS reaped (by the winner).
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): confirm the reaper still classifies via a catch-all `else` that
> lumps `no-lock` into `lost`, and that the exit-code mapping still keys off
> `lost`. If a dependency landed differently or an ADR superseded an assumption
> here, do NOT build on the stale premise — route to needs-attention with the
> discrepancy as the reason (WORK-CONTRACT.md “Drift is a needs-attention
> signal”).
>
> Where to look (by concept, not brittle paths — verified at task-birth in the
> item-lock module, `packages/dorfl/src/item-lock.ts`):
>   - `reapStaleItemLocks` — the human-invoked sweep. The `for` loop over
>     `report.locks`; the `if (reconcile === 'cleared-stale')` arm and its inner
>     `rec.outcome` dispatch. The bug is the trailing `else` that maps any non
>     `cleared-stale`/`kept-*` outcome (including `no-lock`) to `lost`.
>   - `ReconcileOutcome` — the union the reconcile re-read returns
>     (`cleared-stale` / `kept-stuck` / `kept-in-flight` / `no-lock` / `error`).
>     `no-lock` = "no lock to reconcile (already at rest)".
>   - `ReapOutcome` — the per-lock sweep outcome union (`reaped` / `kept-stuck` /
>     `kept-in-flight` / `lost` / `error`). Add (or repurpose) a benign
>     already-reaped outcome here.
>   - `reapReportNeedsAttention` — the exit-code predicate: a lock needs attention
>     after the sweep iff `kept-stuck` or genuine `lost`/`error`. The new benign
>     outcome must NOT be in this set.
>   - `formatReapReport` — the human-readable sweep report. It has BOTH a
>     `report.lost`-keyed summary line AND a per-entry tag `switch` whose default
>     falls through to `[kept]`. The new benign outcome MUST get its own tag (and,
>     if you add a count, its own summary mention) — otherwise an already-reaped
>     lock prints as `[kept]`, misreporting a reaped-by-other lock as one the
>     reaper left behind.
>   - The CLI wiring lives in `src/cli.ts` (the `--reap-stale-locks` branch that
>     calls `reapStaleItemLocks` and maps `reapReportNeedsAttention` → exit code).
>
> The fix: in the `cleared-stale` arm, branch `rec.outcome === 'no-lock'` to the
> BENIGN already-reaped no-op (the ref is already gone = the desired end state),
> leaving the existing `else` (a genuinely REJECTED leased delete — the ref changed
> to a DIFFERENT value — or an `error`) as `lost`/`error`. Keep the two paths
> separable: "already cleared, all good" vs "lease genuinely lost the race".
>
> SCOPE FENCE — there are TWO `lost`/`error`-producing paths; fix ONLY the first.
> The bug is the INNER dispatch (the `else` AFTER a clear attempt, where the
> re-read returns `no-lock` because the other reaper won). There is a SEPARATE
> OUTER `else` for a lock the classifier never named `cleared-stale` at all
> (it returned `no-lock`/`error` up front) → `outcome: 'error'`. That outer path
> is NOT this bug and stays `error` — do NOT extend the benign treatment to it.
>
> Test seam: the existing two-reaper race test in
> `packages/dorfl/test/gc-reap-stale-locks.test.ts` ("two concurrent
> reapers on the same stale lock"). It seeds a held active lock made terminal-on
> -main (a stale lock), then runs two clones' sweeps with `Promise.all` against the
> SAME `--bare` `file://` arbiter. TIGHTEN it: assert exactly one reaper reports
> the reap and the other reports the new BENIGN outcome (not `lost`), assert
> `lost === 0`, and assert NEITHER report needs attention
> (`reapReportNeedsAttention` is false for both → both exit 0). Add/keep a separate
> assertion that a genuine leased-delete rejection (ref changed to a different
> value) is STILL `lost` and STILL needs attention, so the real-race path is not
> regressed. Tests use throwaway git repos + a local `--bare` `file://` arbiter and
> must write nothing outside their own temp fixtures.
>
> RECORD the in-scope decision: write a `## Decisions` block (in the done record /
> PR description, or an ADR if it meets the ADR gate per `ADR-FORMAT.md`) stating
> the reaper's exit-code contract — 0 when all stale locks are reaped and only
> healthy in-flight remains; 1 when a `kept-stuck` survives or a delete genuinely
> lost the race / errored — and that an already-cleared `no-lock` is benign, not
> lost. This was never written down and was an explicit ask of this task.
>
> Done = the reaper distinguishes already-reaped (`no-lock`, benign) from a genuine
> lost lease; a clean concurrent double-reap exits 0; a real race still exits 1;
> the two-reaper test is tightened to assert this; the exit-code contract is
> recorded in a `## Decisions` block; and `pnpm -r build && pnpm -r test &&
> pnpm format:check` is green.

## Live repro (2026-06-20)

This fired in the wild on a SINGLE reap (not just the concurrent double-reap the
original note described). Running `gc --ledger --reap-stale-locks` against a lingering
lock produced:

```
Per-item lock sweep (--reap-stale-locks): reaped 0 stale terminal lock(s), kept 0
(stuck/in-flight, never reaped), 1 could not be cleared (lease lost / error —
reported, NEVER forced):
  [error]    slice-claim-cas-spinner  [implement/stuck]  no lock (already at rest).
```

The `no lock (already at rest)` reconcile outcome was bucketed as `[error]` (“could not
be cleared”), exactly the mislabel this task fixes — `no-lock` is the DESIRED end state
(the lock is gone), not an error. So the benign-`no-lock` classification must hold for
the SINGLE-reap path too, not only the concurrent double-reap. (Note: in this specific
incident the lock was actually a `slice-`-prefixed pre-cutover STUCK lock that the
reaper never reaps anyway — see the sibling observations on the done+stuck reap gap and
the un-releasable pre-cutover entries; THIS task is only about the `no-lock` → benign
classification, keep it scoped to that.)

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/todo/<slug>.md work/tasks/done/<slug>.md
```
