---
title: start — claim then onboard the human onto the work branch
slug: start
prd: dorfl
humanOnly: true
blockedBy: [claim-command]
covers: [5]
---

## What to build

A human-convenience command that does the two-step ritual we run every time a person starts a slice by hand: claim the item, and — **only if the claim landed** — put the human on the work branch ready to start, in their CURRENT checkout.

`dorfl start [<slug>] [--arbiter <remote>] [--resume]`:

Branch on the item's CURRENT FOLDER on `<arbiter>/main` (never on the advisory `claimed_by` field — WORK-CONTRACT rule 6: folder + git history are truth):

1. **In `work/backlog/`** → claim it (the `claim-command` CAS), and **on exit 0 only**: `git fetch <arbiter>` + `git switch -c work/<slug> <arbiter>/main`, leaving the user on the work branch with `work/in-progress/<slug>.md` present. On claim exit 2/3 (lost/contended): behave exactly like `claim` — user restored, NO work branch created, exit code propagated.
2. **In `work/in-progress/`** → it is already claimed (you cannot re-claim; it is not in backlog). **Refuse by default** with a clear message ("already in-progress; advisory claimed_by=<...>; if this is your own resumed work, re-run with --resume"). With **`--resume`**, switch to `work/<slug>` off the arbiter without claiming — the human explicitly asserts ownership; the tool does NOT guess it.
3. **In `work/done/` or absent** → refuse (nothing to start).

Slug inference: if `<slug>` is omitted and the current branch is `work/<slug>`, infer the slug from the branch (so `start` re-onboards / resumes the current work item without retyping it).

Scope notes (deliberate):

- This is the **human-in-current-checkout** path: work happens right here in the repo the person is looking at. It does NOT use the `agent-workspaces` isolated worktrees under `~/.dorfl/` — that substrate is for the runner's parallel jobs, a different use case. The two models coexist on purpose.
- It is a **separate command, not a flag on `claim`**, so `claim` stays conceptually pure (just the CAS). `start` = claim THEN onboard.
- It is **harness-agnostic**: it lands the human on the work branch and gets out of the way. It does NOT launch an agent/editor (e.g. `pi`) — you're already in the right dir on the right branch, so launch whatever you want yourself.
- Single item only (a human works one thing at a time); batch/parallel claiming is the runner's job (`run-once`).

## Acceptance criteria

- [ ] `start <slug>` on a BACKLOG item: winning claim leaves the user on branch `work/<slug>` off the latest arbiter main, with `work/in-progress/<slug>.md` present; losing/contended leaves them untouched (no branch).
- [ ] `start <slug>` on an IN-PROGRESS item refuses by default; `--resume` switches to its work branch without claiming. Decision is folder-based, never from the advisory `claimed_by` field.
- [ ] `start` on a DONE/absent item refuses.
- [ ] With no `<slug>` and on a `work/<slug>` branch, the slug is inferred.
- [ ] It launches no agent/editor/harness; it only onboards onto the branch.
- [ ] On a losing/contended claim it matches `claim`'s behaviour exactly: user restored, NO work branch created, correct exit code propagated.
- [ ] It does not modify the claim CAS itself or its exit-code semantics (it sequences `claim`).
- [ ] `claim` (bare) remains available and unchanged.
- [ ] Tests cover both paths (winning → on work branch; losing → untouched), against a local `--bare` arbiter, including a two-claimer race where the loser's `start` creates no branch.

## Blocked by

- `claim-command` — sequences the `dorfl claim` CAS; switches to the work branch only after it provably lands.

## Prompt

> Implement `dorfl start <slug>` in `packages/dorfl/`. It is a thin human convenience over the `claim-command` slice: run the claim CAS, and ONLY if it returns 0, `git fetch <arbiter>` + `git switch -c work/<slug> <arbiter>/main` so the human is on the work branch in their current checkout. On exit 2/3 (lost/contended) behave exactly like `claim`: restore the user, create no work branch, propagate the exit code. READ FIRST: the `claim-command` slice + `skills/to-slices/CLAIM-PROTOCOL.md`, and ADR §1/§8 in `docs/adr/execution-substrate-decisions.md`.
>
> Deliberate scope: this is the human-in-current-checkout path; it does NOT use the `agent-workspaces` isolated worktrees (that's the runner's parallel-jobs substrate). Keep it a SEPARATE command, not a flag on `claim`, so `claim` stays just the CAS. Single item only. Harness-agnostic: do NOT launch an agent or editor (the user is already in the right place and can launch `pi` etc. themselves). Never weaken the claim's cheap/restorable guarantee — the work branch is created only after the claim lands.
>
> TDD with vitest against a local `--bare` arbiter: winning claim → user on `work/<slug>`; losing/contended claim → user untouched, no branch; a two-claimer race where the loser creates nothing. Match house style; `commander` for the command. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
