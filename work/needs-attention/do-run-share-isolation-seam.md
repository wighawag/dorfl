---
title: route do + run through the IsolatedTree seam — one shared post-claim pipeline, both consumers on the seam (pay down the Job-shape coupling)
slug: do-run-share-isolation-seam
prd: command-surface-phase-2
blockedBy: [do-remote]
covers: []
---

## What to build

The architectural follow-up to `do-remote` (which used Option A —
materialise-then-reuse). Adopt the isolation seam the codebase ALREADY built but
nothing consumes: route BOTH `do` and `run` through `selectIsolationStrategy` /
`IsolatedTree` (`src/isolation.ts`), so the shared
build→gate→done-move→rebase→integrate→teardown pipeline runs against a uniform
HANDLE rather than a concrete `cwd`/`Job`.

Context: `src/isolation.ts` defines the seam (`IsolatedTree` with
`dir`/`branch`/`arbiterRemote`/`arbiterUrl`/`teardown`, `inPlaceStrategy`,
`jobWorktreeStrategy`, `selectIsolationStrategy` by "is there a checkout?") — its
EXPLICIT purpose is "remove the `Job`-shape coupling from the pipeline." But today:
`do` composes `start`/`complete` against a literal `cwd` (never touches the seam),
and `run` uses `createJob` directly. So the seam has ZERO real consumers and will
rot (drift from reality) unless adopted. `do-remote` (Option A) proved the pipeline
CAN run against a non-checkout tree (a job worktree); this slice formalises that by
making `cwd`-vs-`Job` irrelevant to the pipeline — it reads the handle.

- **Refactor the post-claim pipeline to take an `IsolatedTree` handle** (or a thin
  wrapper that owns claim + start-onboarding + agent + complete + teardown against
  the handle's `dir`/`branch`/`arbiterRemote`/`arbiterUrl`). The handle's
  `teardown` replaces the ad-hoc reap/no-op branching.
- **`do` selects via `selectIsolationStrategy({checkout})`:** in a checkout ⇒
  in-place strategy (no-op teardown); `--remote` ⇒ job-worktree strategy (the
  `do-remote` materialise + `reapJob` teardown). The `do-remote` Option-A wiring is
  REPLACED by the seam selection — same observable behaviour, less bespoke glue.
- **`run` selects the job-worktree strategy** through the SAME seam (replacing its
  direct `createJob` use), so `run` and `do` finally share ONE post-claim pipeline.
  `run`'s observable behaviour stays byte-identical.
- **Behaviour-preserving refactor:** no user-visible change. The win is internal —
  one pipeline, two strategies, both consumers on the seam; `start`/`complete`'s
  cwd-vs-handle coupling resolved.

This is a pure architecture/refactor slice (no PRD user story; `covers: []`). It is
deliberately AFTER `do-remote` so (a) Option A proves the pipeline is tree-agnostic
before we commit to the handle abstraction, and (b) this slice unifies `run` + `do`
together rather than touching only one.

> **FORWARD-POINTER — this convergence is the substrate the `advance` tick will
> wrap (do not build it as a one-off).** The `advance-loop` PRD
> (`work/prd/advance-loop.md`, `sliceAfter: [auto-slice]`) is architected as "one
> substrate-agnostic TICK, two drivers" and explicitly REUSES "the tick/loop split
> (the `do`/`run` convergence)" — i.e. THIS slice. It is the single load-bearing
> prerequisite that lets the advance PRD be sliced WITHOUT changes to the PRD
> itself. So shape the shared post-claim pipeline as a genuinely reusable, uniform
> handle-driven seam (the `IsolatedTree` handle + a thin shared pipeline both
> consumers call), NOT a `do`-specific and a `run`-specific path that merely happen
> to look alike. Concretely: the shared pipeline should be a NAMED, independently-
> callable unit (the thing the future `advance` tick can invoke to do a build /
> slice rung), with `do` and `run` as two thin drivers over it. If a later reviewer
> can point at "this function/seam IS the tick both drivers wrap", advance slices
> clean; if the convergence is a private refactor with no callable shared entry
> point, advance's slicer will have to amend the PRD or build the convergence
> itself. Keep `covers: []` (still no command-surface user story) — this note is
> about the SHAPE, not added scope.

## Acceptance criteria

- [ ] `do` (in-place AND `--remote`) and `run` all run their post-claim pipeline
      against the `IsolatedTree` handle via `selectIsolationStrategy` — no path
      reads a concrete `Job` or a bare `cwd` for the shared steps.
- [ ] `start`/`complete` (or the shared pipeline) operate on the handle's
      `dir`/`branch`/`arbiterRemote`/`arbiterUrl`; the in-place no-op teardown and
      the job-worktree `reapJob` teardown both flow through `IsolatedTree.teardown`.
- [ ] `run`'s observable behaviour is byte-identical (its existing tests pass
      unchanged); `do` in-place + `--remote` behaviour is unchanged.
- [ ] The `do-remote` Option-A bespoke materialise/reap glue is REPLACED by the
      seam selection (no duplicate isolation logic left).
- [ ] **Test isolation:** existing isolation/run/do tests keep their temp
      `workspacesDir` + `isolatePiAgentDir`; assert real shared dirs untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `do-remote` — its Option-A proves the pipeline runs against a job-worktree tree
  and is the thing this slice refactors onto the seam (without it, there is no
  job-worktree `do` to unify).

## Prompt

> Adopt the `IsolatedTree` seam (`src/isolation.ts`) that the codebase built but
> nothing consumes. Route BOTH `do` (in-place + `--remote`) and `run` through
> `selectIsolationStrategy` so the shared post-claim pipeline
> (build→gate→done-move→rebase→integrate→teardown) reads a uniform HANDLE, not a
> concrete `Job` or bare `cwd`. This pays down the `Job`-shape coupling the seam's
> own doc says it exists to remove, and finally gives the seam two real consumers.
>
> Behaviour-PRESERVING: no user-visible change. `run` stays byte-identical; `do`
> in-place + `--remote` stay identical. The `do-remote` Option-A glue
> (materialise/reap) is replaced by the seam selection.
>
> READ FIRST: `src/isolation.ts` (the seam — `IsolatedTree`, `inPlaceStrategy`,
> `jobWorktreeStrategy`, `jobWorktreeHandle`, `selectIsolationStrategy`); `src/do.ts`
> (composes start/complete on `cwd` — and the `do-remote` Option-A materialise/reap
> to fold in); `src/run.ts` (direct `createJob` use to route through the seam);
> `src/start.ts` + `src/complete.ts` (the cwd-vs-handle coupling to resolve);
> `src/workspace.ts`/`src/gc.ts` (`createJob`/`reapJob` behind the job-worktree
> strategy). Drift check: confirm `do-remote` landed Option-A and `run` still uses
> `createJob` directly.
>
> TDD with vitest: `run`'s existing tests pass unchanged (byte-identical behaviour);
> `do` in-place + `--remote` unchanged; no duplicate isolation logic remains; temp
> `workspacesDir` + `isolatePiAgentDir`, real shared dirs untouched. "Done" =
> acceptance criteria met and gate green.

---

### Claiming this slice

```sh
agent-runner claim do-run-share-isolation-seam --arbiter <remote>
git fetch <remote> && git switch -c work/do-run-share-isolation-seam <remote>/main
git mv work/in-progress/do-run-share-isolation-seam.md work/done/do-run-share-isolation-seam.md
```

## Needs attention

PR/code review (Gate 2) blocked this work:
- The branch delivers no code — `git diff main...HEAD` is only the claim file-move (the slice .md rename), 0 source insertions/deletions. The slice's acceptance criteria are entirely unmet. Should this be blocked and re-scoped rather than landed? (git diff main...HEAD shows only work/backlog/...md → work/in-progress/...md (similarity 100%). No change to any packages/agent-runner/src file. Slice still in work/in-progress/, not done-moved.)
- AC #1 requires in-place `do` to run its post-claim pipeline through `selectIsolationStrategy`/the `IsolatedTree` handle. This is the one genuine remaining gap and it was NOT built. `performDo` still reads a literal `cwd` and `selectIsolationStrategy`/`inPlaceStrategy` have zero production consumers. (do.ts:326 performDo uses `const cwd = options.cwd` and composes performStart/performComplete directly. grep shows selectIsolationStrategy/inPlaceStrategy referenced only in isolation.test.ts and re-exported in index.ts — never in run.ts/do.ts production paths. ADR/PRD §6/§7 want all three forms (run, do --remote, in-place do) on the one seam.)
PR/code review (Gate 2) did not reach an approve verdict within reviewMaxRounds=2 round(s); forcing needs-attention (never silently merged or looped).
