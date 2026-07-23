---
title: 'Make the acceptance gate flake-resistant (one green run shouldn''t admit a regression)'
slug: gate-flake-resistance
type: idea
status: incubating
---

# Gate flake-resistance (pre-SPEC / incubating idea)

> This is a **pre-SPEC idea**, not a committed north-star, captured so it is not lost. The maintainer explicitly said: **do NOT plan or build this yet.** It is here for when/if it ripens.

## Where this came from

Spotted live (2026-06-04): the `start-readiness-guard` slice merged with a **flaky** claim-race test that happened to be green at `complete` time, then deterministically surfaced later and wrongly routed `integration-github` to `needs-attention/`. Root cause was a test-harness artifact (concurrent `file://` pushes), fixed in `ca74f6f` by running the race-sensitive files in a non-parallel vitest project. (See the originating `work/observations/` note.)

## The residual concern

Even with that specific flake fixed, the **gate has a structural hole**: the acceptance gate (`pnpm -r build && test && format:check`) runs the suite **once**. A timing-sensitive / concurrency test can pass on a one-off green and admit a real regression. The fix above removed one instance; it did not make the _gate_ immune to the _class_.

## Possible directions (unexplored \u2014 do NOT build yet)

- Run race/concurrency-sensitive tests under `--no-file-parallelism` (or repeated N times) **as part of the gate**, so a one-off green can't merge.
- A convention/tag for \"timing-sensitive\" tests + a gate step that stress-runs just those.
- Detect+fail on known flake signatures rather than masking with retries.

## Why not now

The maintainer judged this not the right time; the concrete flake that triggered it is already fixed. Promote to a SPEC only if gate flukes recur.
