---
title: run --once — claim N eligible items, run an agent in isolation, integrate
slug: run-once
prd: agent-runner
humanOnly: true
blocked_by: [scan]
covers: [5, 6, 7, 8, 10, 12]
created: 2026-06-03
claimed_by: wighawag
claimed_at: 2026-06-03T12:27:40Z
---

## What to build

The `agent-runner run --once` command: claim up to N eligible items, run a
configured agent on each in an isolated worktree/clone, integrate the results,
then stop (supervised — increment B from the PRD).

A thin path through every layer, reusing the `scan` core for the queue:

- **Select** the eligible queue (from the `scan` core), respecting concurrency
  caps `maxParallel` and `perRepoMax`.
- **Claim optimistically** via the existing `skills/to-slices/scripts/claim.sh` (atomic CAS push
  to the arbiter remote). Exit 2 ⇒ lost the race ⇒ skip that item and move on.
  Never claim across repos; claims serialize on each repo's arbiter `main`.
- **Isolate** each claimed item in its own git worktree or clone so concurrent
  code changes cannot corrupt shared state. Note the worktree caveat: git
  forbids the same branch being checked out in two worktrees at once, so if
  worktrees are used, each agent's branches must be uniquely named (e.g.
  `claim/<slug>-<agentid>`, `work/<slug>-<agentid>`) — otherwise two agents
  racing the same slug collide locally. **Prefer separate clones** when many
  agents run in parallel (independent object stores, no shared-branch
  constraint); the single-checkout `claim.sh` is not safe to run twice in one
  working copy. (The arbiter's `main`-ref CAS still guarantees exactly one
  claim winner regardless; this isolation is about avoiding LOCAL collisions.)
- **Run** the configured `agentCmd` against the item's slice prompt. The spawned
  agent ONLY produces code changes and gets the acceptance tests green — it does
  NOT stage/commit/push and does NOT move the slice file between `work/` folders.
  All git-state transitions (the claim, the done-move, the work commit, and
  integration) are the **runner's** responsibility, exactly as `claim.sh` already
  owns the claim commit. The prompt the runner hands to `agentCmd` must state
  this explicitly — do NOT rely on the host's global agent config (e.g. an
  `AGENTS.md`) to enforce "don't commit"; other users won't have it. The runner
  owning git also keeps the test-gate authoritative (the agent can't merge
  around it).
- **Gate on tests** — an item reaches `work/done/` only when its acceptance tests
  pass; otherwise it stays in `work/in-progress/` (or moves to a needs-attention
  folder) for the human. Bad work never auto-merges.
- **Move via `git mv`, creating the target dir first** — `work/done/` (and
  `work/in-progress/`) may not exist yet (git doesn't track empty dirs), so the
  runner must `mkdir -p work/<status>/` before `git mv`, mirroring what
  `claim.sh` already does for the in-progress move. Do NOT seed status folders
  with `.gitkeep`; the movers own dir creation.
- **Integrate** per config `integration`: `propose` by default (push a branch +
  request review — e.g. a GitHub PR via the provider seam), or `merge` (direct to
  main) where explicitly allowed. Never `--force` to main. *(Mode renamed from
  `pr` to `propose`; see the integration seam in
  `docs/adr/execution-substrate-decisions.md` §6.)*

## Acceptance criteria

- [ ] `run --once` claims up to `maxParallel` eligible items (≤ `perRepoMax` per
      repo) and then stops.
- [ ] Claims go through `skills/to-slices/scripts/claim.sh`; an item that returns exit 2 is skipped
      cleanly (no false "claimed").
- [ ] A simultaneous two-runner race over the same item shows exactly one winner
      (mirror the `claim.sh` verification approach).
- [ ] Each agent runs in its own worktree/clone; runs do not share a working tree.
      If worktrees are used, branch names are per-agent unique (no two worktrees
      check out the same branch); separate clones are preferred for high parallelism.
- [ ] `integration: propose` pushes a branch + requests review by default; `merge`
      integrates directly only when configured. Never force-pushes main.
- [ ] An item moves to `work/done/` only on green acceptance tests; otherwise it
      stays in `in-progress`/needs-attention.
- [ ] The runner `mkdir -p`s the target status dir before `git mv` (works even
      when `work/done/` does not exist yet).
- [ ] All git transitions (claim, done-move, work commit, integration) are done
      by the runner, not the spawned agent; the `agentCmd` prompt explicitly
      tells the agent NOT to commit/push or move slice files.
- [ ] Tests cover claim race, concurrency caps, and the test-gate, against
      throwaway git repos + a local `--bare` arbiter.

## Blocked by

- `scan` — reuses its config/detection/eligibility core to build the queue.

## Prompt

> Build `agent-runner run --once` (increment B). It consumes the `scan` core
> (config, detection, eligibility) to get the eligible cross-repo queue, then for
> up to `maxParallel` items (≤ `perRepoMax` per repo): claim atomically via the
> existing `skills/to-slices/scripts/claim.sh` (from the `to-slices` skill — atomic CAS
> push to the arbiter remote; exit 0 = claimed, exit 2 = lost the race, skip),
> run the configured `agentCmd` in an isolated worktree/clone, and integrate.
>
> Division of labor: the spawned agent ONLY edits code and makes the acceptance
> tests pass. The RUNNER owns every git-state transition — the claim, the
> `git mv` to `work/done/`, the work commit, and integration. The prompt the
> runner gives `agentCmd` must say this in-band ("do not commit/push; do not move
> work/ files") rather than relying on any host global agent config, since other
> users won't have your `AGENTS.md`. Before any `git mv`, `mkdir -p` the target
> `work/<status>/` (it may not exist yet — git doesn't track empty dirs); don't
> create `.gitkeep` placeholders.
>
> Integration is configurable (`integration`): default `propose` (push a branch +
> request review), or `merge` (direct to main) only where explicitly allowed. NEVER
> `--force` to main — the only `--force-with-lease` is the claim micro-commit
> inside `claim.sh`. An item reaches `work/done/` (via `git mv` in the work
> branch) only when its acceptance tests pass; otherwise it stays in
> `work/in-progress/` or a needs-attention folder for the human.
>
> Test (vitest, mirroring `claim.sh`'s verification): a truly simultaneous
> two-runner race over one item yields exactly one winner; concurrency caps are
> respected; the test-gate keeps failing work out of `done/`. Use throwaway git
> repos + a local `--bare` arbiter. "Done" = acceptance criteria met, tests pass.
