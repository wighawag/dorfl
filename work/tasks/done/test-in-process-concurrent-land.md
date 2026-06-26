---
title: Test — in-process concurrent land via `integrateLock` (one lands, the loser re-gates + lands or routes)
slug: test-in-process-concurrent-land
prd: land-time-reverify-and-parallel-merge-ceiling
blockedBy: []
covers: [13]
---

## What to build

In-process concurrency test for the land tail: two same-process merge
jobs through `run`, wired with `createKeyedLock()` / `integrateLock` (per
`run.ts`). One lands; the loser re-rebases + re-gates and EITHER lands
OR routes to needs-attention. Never both-land-broken by timing; never a
`--force`.

External-behaviour assertions only:

- Exactly one job's tree is the new `main` tip after both finish.
- The loser either lands a clean re-verified tree OR ends `state: stuck`
  with a reason naming a real cause (re-verify red, conflict). It is
  NOT bounced for "lock contention" alone.
- `main` never contains a tree that fails `verify`.

This is the in-process half of Story 13; the cross-job half is
`test-cross-job-concurrent-land`.

## Acceptance criteria

- [ ] New test in the integration suite exercising two concurrent
      in-process merge jobs through the same `run` instance.
- [ ] The three external behaviours above are asserted; the test does
      NOT inspect `integrateLock`'s internals.
- [ ] Test isolates any shared global location per task-template's
      shared-location rule.
- [ ] Acceptance gate green.

## Blocked by

- None — the in-process lock and the engine surfaces exist.

## Prompt

> Read Story 13 + the Testing Decisions section. Read `run.ts` to see
> how `createKeyedLock()` is wired and how to spin two concurrent merge
> jobs against the same arbiter. Use the existing test harness for
> integration tests (temp bare arbiter + worktrees). Keep the scenario
> minimal — disjoint files that both verify in isolation, so the only
> contention is for the land slot. Run the AGENTS.md acceptance gate.
