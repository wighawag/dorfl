---
title: run-internal-error-tests "config-error" case flakes as "lost-race" under full-suite parallel load
date: 2026-06-18
status: open
---

## What I saw

While landing the `promote` command (a change touching ONLY `cli.ts` +
`needs-attention.ts`, nothing in the `run`/claim path), the full acceptance gate
(`pnpm -r test`) failed ONCE on:

```
test/run-internal-error-tests.test.ts
  > runOnce — a thrown CORE wiring/config error is config-error, NOT agent-failed
  > review on with NO reviewGate wired → config-error, work preserved/surfaced, tick CONTINUES
AssertionError: expected 'lost-race' to be 'config-error'
  expect(item.status).toBe('config-error');   // got 'lost-race'
```

## Why it is a flake (not a regression)

- The failing test is in the `run`/claim concurrency path, which my change does
  not touch (verified: the diff is `cli.ts` + `needs-attention.ts` only).
- Re-running the file IN ISOLATION passed 3/3.
- Re-running the FULL gate passed (2300 tests). The failure only appeared once,
  under full-suite parallel load.

So a `runOnce` tick that should deterministically reach `config-error` (the review
gate is wired-on but no `reviewGate` seam is provided) instead resolved to
`lost-race` — a claim-race outcome — when the suite ran many things concurrently.
That points at shared state / a claim CAS racing a sibling under load, or a
timing-sensitive ordering in this specific test's harness, rather than a real
defect in the config-error path.

## Suggested follow-up

Make the test deterministic under parallel load: isolate its arbiter/claim state
from siblings (a dedicated scratch arbiter), or assert it does not depend on
winning a claim race (the assertion is about config-error vs agent-failed, so a
`lost-race` should arguably be excluded/retried rather than fail the case). Worth
a small fix slice if it recurs; capturing now so the signal is not lost.
