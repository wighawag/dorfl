---
title: start — claim then onboard the human onto the work branch
slug: start
prd: agent-runner
afk: false
blocked_by: [claim-command]
covers: [5]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

A human-convenience command that does the two-step ritual we run every time a
person starts a slice by hand: claim the item, and — **only if the claim landed**
— put the human on the work branch ready to start, in their CURRENT checkout.

`agent-runner start <slug> [--arbiter <remote>]`:

1. Run the claim (the `claim-command` CAS — unchanged).
2. **On exit 0 only**: `git fetch <arbiter>` and `git switch -c work/<slug>
   <arbiter>/main`, leaving the user on the work branch with
   `work/in-progress/<slug>.md` present, ready to work.
3. On exit 2 (lost/not claimable) or 3 (contended): behave exactly like `claim`
   — leave the user restored where they were, create NO work branch. The failure
   path must be clean (this is just a sequencer of two existing operations; it
   never weakens the claim's cheap/restorable guarantee).

Scope notes (deliberate):

- This is the **human-in-current-checkout** path: work happens right here in the
  repo the person is looking at. It does NOT use the `agent-workspaces` isolated
  worktrees under `~/.agent-runner/` — that substrate is for the runner's
  parallel jobs, a different use case. The two models coexist on purpose.
- It is a **separate command, not a flag on `claim`**, so `claim` stays
  conceptually pure (just the CAS). `start` = claim THEN onboard.
- It is **harness-agnostic**: it lands the human on the work branch and gets out
  of the way. It does NOT launch an agent/editor (e.g. `pi`) — you're already in
  the right dir on the right branch, so launch whatever you want yourself.
- Single item only (a human works one thing at a time); batch/parallel claiming
  is the runner's job (`run-once`).

## Acceptance criteria

- [ ] `start <slug>` on a winning claim leaves the user on branch `work/<slug>`
      off the latest arbiter main, with `work/in-progress/<slug>.md` present.
- [ ] It launches no agent/editor/harness; it only onboards onto the branch.
- [ ] On a losing/contended claim it matches `claim`'s behaviour exactly: user
      restored, NO work branch created, correct exit code propagated.
- [ ] It does not modify the claim CAS itself or its exit-code semantics (it
      sequences `claim`).
- [ ] `claim` (bare) remains available and unchanged.
- [ ] Tests cover both paths (winning → on work branch; losing → untouched),
      against a local `--bare` arbiter, including a two-claimer race where the
      loser's `start` creates no branch.

## Blocked by

- `claim-command` — sequences the `agent-runner claim` CAS; switches to the work
  branch only after it provably lands.

## Prompt

> Implement `agent-runner start <slug>` in `packages/agent-runner/`. It
> is a thin human convenience over the `claim-command` slice: run the claim CAS,
> and ONLY if it returns 0, `git fetch <arbiter>` + `git switch -c work/<slug>
> <arbiter>/main` so the human is on the work branch in their current checkout.
> On exit 2/3 (lost/contended) behave exactly like `claim`: restore the user,
> create no work branch, propagate the exit code. READ FIRST: the `claim-command`
> slice + `scripts/CLAIM-PROTOCOL.md`, and ADR §1/§8 in
> `work/findings/execution-substrate-decisions.md`.
>
> Deliberate scope: this is the human-in-current-checkout path; it does NOT use
> the `agent-workspaces` isolated worktrees (that's the runner's parallel-jobs
> substrate). Keep it a SEPARATE command, not a flag on `claim`, so `claim` stays
> just the CAS. Single item only. Harness-agnostic: do NOT launch an agent or
> editor (the user is already in the right place and can launch `pi` etc.
> themselves). Never weaken the claim's cheap/restorable guarantee — the work
> branch is created only after the claim lands.
>
> TDD with vitest against a local `--bare` arbiter: winning claim → user on
> `work/<slug>`; losing/contended claim → user untouched, no branch; a two-claimer
> race where the loser creates nothing. Match house style; `commander` for the
> command. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test &&
> pnpm -r format:check` green.
