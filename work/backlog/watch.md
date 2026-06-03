---
title: watch — bounded autonomous loop over run --once with safety rails
slug: watch
prd: agent-runner
afk: false
blocked_by: [agent-workspaces]
covers: [11]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

The `agent-runner watch` command: loop `run --once` on an interval until a stop
condition, with safety rails so unattended runs stay safe (increment C from the
PRD — the autonomous endpoint).

A thin path on top of `run --once`:

- **Loop** the `run --once` tick on a configurable interval.
- **Bound** the session: stop on max-iterations and/or max-duration. `watch` is a
  bounded session, not a long-lived daemon/service.
- **Surface failures** instead of infinite-retrying: a timeout or red tests on an
  item must be reported and must not be silently retried forever. Use the harness
  liveness + the retained-worktree signal from `agent-workspaces` (ADR §4/§5) to
  detect hung/failed jobs; a retained (un-deleted) job worktree is itself a
  "needs attention" marker.

## Acceptance criteria

- [ ] `watch` repeatedly runs the `run --once` tick on an interval.
- [ ] It stops cleanly when max-iterations or max-duration is reached.
- [ ] A failing item (timeout / red tests) is surfaced, not infinite-retried.
- [ ] Tests cover the stop conditions and the failure-surfacing behaviour.

## Blocked by

- `agent-workspaces` — `watch` loops the run --once tick once it runs on the real
  execution substrate (hub mirrors + isolated job worktrees, harness liveness,
  provably-safe deletion). No point looping over the ad-hoc isolation that
  `agent-workspaces` replaces.

## Prompt

> Build `agent-runner watch` (increment C). It loops the `run --once` tick (from
> the `run-once` slice) on a configurable interval and is the autonomous endpoint
> — but it is a BOUNDED session, not a daemon. Stop conditions: max-iterations
> and/or max-duration. Safety rail: when an item fails (timeout or red tests),
> surface it (report/needs-attention) rather than infinite-retrying it.
>
> Test (vitest): the loop honours both stop conditions, and a failing item is
> surfaced rather than retried forever. Reuse the `run --once` machinery (now on
> the `agent-workspaces` substrate) and its harness-liveness / retained-worktree
> signals; don't reimplement claiming, isolation, or integration. "Done" =
> acceptance criteria met, tests pass.
