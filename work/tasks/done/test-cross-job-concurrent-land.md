---
title: 'Test — cross-job concurrent land (separate processes against one arbiter; CAS loop is the queue)'
slug: test-cross-job-concurrent-land
spec: land-time-reverify-and-parallel-merge-ceiling
blockedBy: [merge-retries-gate-precedence]
covers: [13]
---

## What to build

Cross-job concurrency test for the land tail: two SEPARATE processes
race the same arbiter ref. With only the CAS loop as the cross-job
serialiser (no in-process `integrateLock` spans them), assert
deterministic convergence within the (resolved/scalable) `mergeRetries`
cap, and the chosen behaviour past the cap.

External-behaviour assertions:

- Exactly one process's tree is the new `main` tip after both finish.
- Within the configured `mergeRetries` cap, no process bounces to
  needs-attention purely for losing the CAS race; the loser
  re-rebases + re-gates + retries.
- Past the cap, a loser bounces deterministically to `state: stuck`
  with a CAS-exhaustion reason, NOT a phantom conflict.
- `main` never contains a tree that fails `verify`.

If `cross-job-ref-based-land-lock` ships, this test grows a variant that
exercises the ref-lock queue path; if it does not, the test asserts the
floor only.

## Acceptance criteria

- [ ] Cross-process integration test against a single bare arbiter,
      using spawned worker processes (not just in-process tasks) to
      defeat the `integrateLock` axis.
- [ ] All four external behaviours above asserted.
- [ ] Test isolates any shared global location.
- [ ] Acceptance gate green.

## Blocked by

- `merge-retries-gate-precedence` — the test needs the resolvable cap
  to set a tight bound and exercise the past-cap branch; both touch the
  merge loop area, so serialise by file to avoid conflicts.

## Prompt

> Read Story 13, the Testing Decisions, and Applied Answer q1. Use
> spawned child processes (or worker threads against separate cwd
> repos) so the in-process lock cannot serialise them — only the CAS
> loop can. Set `mergeRetries` low for the past-cap branch and high for
> the within-cap branch (via the precedence chain from
> `merge-retries-gate-precedence`). Avoid wall-clock dependencies;
> drive the race deterministically (e.g. block one process at a
> rendezvous until both are at the push). Verify with the AGENTS.md
> acceptance gate.
