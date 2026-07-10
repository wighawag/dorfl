---
title: continue-conflict-resurface-from-needs-attention — teach findSourceFolder to bounce idempotently from needs-attention/ so a continue-rebase-conflict re-route is not a NO-OP and the on-main surface never goes stale
slug: continue-conflict-resurface-from-needs-attention
covers: []
---

> Self-contained bug-fix slice \u2014 derives from NO SPEC (`covers: []`), omits `prd:`. Source signal: `work/observations/continue-conflict-reroute-is-noop-needs-attention-folder.md`. NOT a work-loss bug (the kept `work/<slug>` branch is the durable artifact) \u2014 it fixes a STALE on-`main` surface.

## What to build

On an onboard-time CONTINUE rebase-conflict (`run.ts` ~310 / `start.ts` `routeContinueConflict`), the runner calls `applyNeedsAttentionTransition` to re-route the item to needs-attention. But the continued worktree is cut from the KEPT `work/<slug>` branch, whose tree ALREADY has the item in `work/needs-attention/<slug>.md` (from the prior bounce). `routeToNeedsAttention`'s `findSourceFolder` (`needs-attention.ts:170`) probes only `in-progress/` and `done/` \u2014 NOT `needs-attention/` \u2014 so it returns `{moved: false}`: no move-only commit, no surface re-publish, no branch push.

Consequence: a continue-conflict does NOT (re)surface the item as needs-attention on `main` when `main` currently shows it elsewhere (e.g. `in-progress/` after a re-claim) \u2014 the on-`main` surface goes STALE (shows in-progress while the job is actually stuck on a continue-conflict), confusing a fleet's `scan`/`status`.

FIX: teach `findSourceFolder` to ALSO recognise `needs-attention/` as a valid source so the re-route is an IDEMPOTENT re-surface (a no-op-content move that still publishes the surface + pushes the branch), rather than a silent `{moved:false}`. Keep it idempotent \u2014 re-surfacing an already-needs-attention item must be safe and not thrash.

## Acceptance criteria

- [ ] `findSourceFolder` recognises `work/needs-attention/<slug>.md` as a source, so a continue-conflict re-route from an item already in `needs-attention/` (re)publishes the surface on `main` + pushes the branch (no longer `{moved:false}`).
- [ ] Idempotent: re-surfacing an item already in `needs-attention/` is safe (no error, no duplicate/churned commit beyond the intended surface refresh).
- [ ] The existing `in-progress/` and `done/` source paths are unchanged.
- [ ] A regression test (throwaway git repo) drives the continue-conflict path where the kept branch already has the item in `needs-attention/` and asserts the surface is (re)published on `main` (mirror `centralise-bounce-branch-push` / needs-attention test patterns).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None.

## Prompt

> Make a continue-rebase-conflict re-route actually (re)surface the item as needs-attention on `main` instead of being a silent NO-OP. Source: `work/observations/continue-conflict-reroute-is-noop-needs-attention-folder.md`.
>
> PROBLEM: `routeToNeedsAttention`'s `findSourceFolder` (`src/needs-attention.ts` ~170) probes only `in-progress/` + `done/`. On a continue-conflict the kept `work/<slug>` branch already has the item in `work/needs-attention/<slug>.md`, so `findSourceFolder` returns no source \u2192 `{moved:false}` \u2192 no surface re-publish. Teach it to also accept `needs-attention/` as a source so the re-route is an IDEMPOTENT re-surface (publish surface + push branch), keeping the existing `in-progress/`/`done/` behaviour intact.
>
> WHERE TO LOOK (verify \u2014 paths may have drifted): `src/needs-attention.ts` (`findSourceFolder` ~170, `routeToNeedsAttention` ~237), the call site `applyNeedsAttentionTransition`, and the continue-conflict callers (`src/run.ts` ~310, `src/start.ts` `routeContinueConflict`). Keep idempotency \u2014 re-surfacing an already-needs-attention item must not thrash or error.
>
> SEAM TO TEST AT: throwaway-git-repo needs-attention/bounce tests (mirror `centralise-bounce-branch-push`). Drive the case where the kept branch already holds the item in `needs-attention/` and assert the on-`main` surface is (re)published.
>
> DRIFT CHECK FIRST: confirm `findSourceFolder` still omits `needs-attention/` and a continue-conflict on an already-bounced item still yields `{moved:false}`. If it already handles `needs-attention/`, close this slice.
>
> "Done" = a continue-conflict re-route from `needs-attention/` (re)publishes the surface idempotently, the other source paths are unchanged, a regression test pins it, and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
