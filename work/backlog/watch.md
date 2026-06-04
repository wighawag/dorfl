---
title: watch — bounded autonomous loop over run --once with safety rails
slug: watch
prd: agent-runner
humanOnly: true
blockedBy: [agent-workspaces]
covers: [11]
---

## What to build

The `agent-runner watch` command: loop `run --once` on an interval until a stop
condition, with safety rails so unattended runs stay safe (increment C from the
PRD — the autonomous endpoint).

A thin path on top of `run --once`:

- **Loop** the `run --once` tick on a configurable interval.
- **Bound** the session: stop on max-iterations and/or max-duration. `watch` is a
  bounded session, not a long-lived daemon/service.
- **Multi-repo (inherited from `run --once`, NOT single-repo).** `watch` adds NO
  repo-scoping of its own — each tick is `run --once`, which already scans EVERY
  participating repo under the config's `roots` (via `scan`/`detectRepos`) and
  claims up to `maxParallel` total, `perRepoMax` per repo. So a `watch` session
  drains eligible work across all configured repos, not one. (Point it at a single
  repo by configuring `roots` to one path; the mechanism is inherently multi-repo.)
- **Surface failures** instead of infinite-retrying: a timeout or red tests on an
  item must be reported and must not be silently retried forever. Use the harness
  liveness + the retained-worktree signal from `agent-workspaces` (ADR §4/§5) to
  detect hung/failed jobs; a retained (un-deleted) job worktree is itself a
  "needs attention" marker. **Route stuck items through the shared `needs-attention`
  mechanism AS IT NOW EXISTS** — i.e. through the **ledger-transition write seam's**
  needs-attention transition (slug `ledger-write-seam-needs-attention`, now in
  `done/`), which already saves the aborted work + records the reason. Do NOT call
  the raw move helper or reinvent failure-surfacing.
- **Lean on needs-attention-on-main surfacing (now built).** `run --once`'s stuck
  routing now also **surfaces the stuck state on `main`** via the cherry-pick
  mechanism (slug `needs-attention-surface-on-main`, in `done/`). This is
  ESPECIALLY valuable for `watch`: an unattended loop has no human watching live,
  so a stuck item being visible on `main` / `status` / cross-machine is how the
  human finds out. `watch` should simply RELY on that surfacing (it falls out of
  routing through the seam) — it must not add its own ad-hoc failure reporting that
  bypasses it.

## Acceptance criteria

- [ ] `watch` repeatedly runs the `run --once` tick on an interval.
- [ ] It stops cleanly when max-iterations or max-duration is reached.
- [ ] Each tick spans ALL participating repos (it reuses `run --once`'s
      `scan`/`selectCandidates`, honouring `maxParallel` + `perRepoMax`); `watch`
      adds no repo-scoping of its own.
- [ ] A failing item (timeout / red tests) is surfaced via the existing seam
      needs-attention path (which saves the aborted work + surfaces on `main`), and
      is NOT infinite-retried within the session.
- [ ] Tests cover the stop conditions and the failure-surfacing behaviour
      (assert it routes through the seam mechanism, not a bespoke reporter).

## Blocked by

- `agent-workspaces` — `watch` loops the run --once tick once it runs on the real
  execution substrate (hub mirrors + isolated job worktrees, harness liveness,
  provably-safe deletion). No point looping over the ad-hoc isolation that
  `agent-workspaces` replaces.

## Prompt

> Build `agent-runner watch` (increment C). It loops the `run --once` tick (from
> the `run-once` slice) on a configurable interval and is the autonomous endpoint
> — but it is a BOUNDED session, not a daemon. Stop conditions: max-iterations
> and/or max-duration.
>
> It is INHERENTLY MULTI-REPO: each tick is `run --once`, which already scans every
> participating repo under `roots` and claims up to `maxParallel` (`perRepoMax`
> per repo). `watch` adds NO repo-scoping — do not make it single-repo.
>
> Safety rail: when an item fails (timeout or red tests), surface it rather than
> infinite-retrying — and surface it through the **ledger-transition write seam's**
> needs-attention transition (slug `ledger-write-seam-needs-attention`, in `done/`),
> NOT the raw move helper. That path already saves the aborted work AND surfaces the
> stuck state on `main` via the cherry-pick (slug `needs-attention-surface-on-main`,
> in `done/`) — which is how a human discovers a stuck item from an UNATTENDED loop
> (no one is watching live). `watch` should rely on that; do not add bespoke
> failure reporting that bypasses the seam.
>
> READ FIRST: the `run.ts` tick + `scan`/`selectCandidates` (multi-repo claiming),
> and the done files for `ledger-write-seam-needs-attention` +
> `needs-attention-surface-on-main` (the seam + on-main surfacing you route
> through). Test (vitest): the loop honours both stop conditions; a failing item is
> surfaced via the seam path (assert it routes through the seam, not a bespoke
> reporter) rather than retried forever; a tick considers multiple repos. Reuse the
> `run --once` machinery (on the `agent-workspaces` substrate) and its harness-
> liveness / retained-worktree signals; don't reimplement claiming, isolation, or
> integration. "Done" = acceptance criteria met, tests pass.
