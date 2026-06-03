---
title: run --once — claim N eligible items, run an agent in isolation, integrate
slug: run-once
prd: agent-runner
afk: false
blocked_by: [scan]
covers: [5, 6, 7, 8, 10, 12]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

The `agent-runner run --once` command: claim up to N eligible items, run a
configured agent on each in an isolated worktree/clone, integrate the results,
then stop (supervised — increment B from the PRD).

A thin path through every layer, reusing the `scan` core for the queue:

- **Select** the eligible queue (from the `scan` core), respecting concurrency
  caps `maxParallel` and `perRepoMax`.
- **Claim optimistically** via the existing `scripts/claim.sh` (atomic CAS push
  to the arbiter remote). Exit 2 ⇒ lost the race ⇒ skip that item and move on.
  Never claim across repos; claims serialize on each repo's arbiter `main`.
- **Isolate** each claimed item in its own git worktree or clone so concurrent
  code changes cannot corrupt shared state.
- **Run** the configured `agentCmd` against the item's slice prompt.
- **Gate on tests** — an item reaches `work/done/` only when its acceptance tests
  pass; otherwise it stays in `work/in-progress/` (or moves to a needs-attention
  folder) for the human. Bad work never auto-merges.
- **Integrate** per config `integration`: `pr` by default (open a PR for review
  when the arbiter is GitHub/PR-compatible), or `merge` (direct to main) where
  explicitly allowed. Never `--force` to main.

## Acceptance criteria

- [ ] `run --once` claims up to `maxParallel` eligible items (≤ `perRepoMax` per
      repo) and then stops.
- [ ] Claims go through `scripts/claim.sh`; an item that returns exit 2 is skipped
      cleanly (no false "claimed").
- [ ] A simultaneous two-runner race over the same item shows exactly one winner
      (mirror the `claim.sh` verification approach).
- [ ] Each agent runs in its own worktree/clone; runs do not share a working tree.
- [ ] `integration: pr` opens a PR by default; `merge` integrates directly only
      when configured. Never force-pushes main.
- [ ] An item moves to `work/done/` only on green acceptance tests; otherwise it
      stays in `in-progress`/needs-attention.
- [ ] Tests cover claim race, concurrency caps, and the test-gate, against
      throwaway git repos + a local `--bare` arbiter.

## Blocked by

- `scan` — reuses its config/detection/eligibility core to build the queue.

## Prompt

> Build `agent-runner run --once` (increment B). It consumes the `scan` core
> (config, detection, eligibility) to get the eligible cross-repo queue, then for
> up to `maxParallel` items (≤ `perRepoMax` per repo): claim atomically via the
> existing `scripts/claim.sh` (from the `wighawag-work-slices` skill — atomic CAS
> push to the arbiter remote; exit 0 = claimed, exit 2 = lost the race, skip),
> run the configured `agentCmd` in an isolated worktree/clone, and integrate.
>
> Integration is configurable (`integration`): default `pr` (open a PR for human
> review), or `merge` (direct to main) only where explicitly allowed. NEVER
> `--force` to main — the only `--force-with-lease` is the claim micro-commit
> inside `claim.sh`. An item reaches `work/done/` (via `git mv` in the work
> branch) only when its acceptance tests pass; otherwise it stays in
> `work/in-progress/` or a needs-attention folder for the human.
>
> Test (vitest, mirroring `claim.sh`'s verification): a truly simultaneous
> two-runner race over one item yields exactly one winner; concurrency caps are
> respected; the test-gate keeps failing work out of `done/`. Use throwaway git
> repos + a local `--bare` arbiter. "Done" = acceptance criteria met, tests pass.
