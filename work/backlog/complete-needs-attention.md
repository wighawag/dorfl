---
title: complete → needs-attention — route complete's failure paths to the stuck folder
slug: complete-needs-attention
prd: agent-runner
humanOnly: true
blocked_by: [needs-attention]
covers: [12]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

A follow-up to the (done, immutable) `complete` command: route its **failure
paths** through the `needs-attention` mechanism instead of just aborting and
leaving the item dangling in `work/in-progress/`.

Today `complete` aborts (exit 1, clear message) when the gate fails or a rebase
conflicts, leaving the item in `in-progress/`. With the `needs-attention`
mechanism available, those outcomes should instead **move the item to
`work/needs-attention/`** with the reason recorded (red gate / rebase conflict),
so the stuck item is surfaced by `status` and can be returned to `backlog/`.

End-to-end:

- On a failed `verify` gate (without `--skip-verify`): record the reason and call
  the `needs-attention` move (`in-progress → needs-attention`), rather than
  aborting in place.
- On a rebase conflict (ADR §10): abort the rebase, then route to
  `needs-attention` with the conflict reason.
- Preserve the existing clean-exit semantics where nothing was committed (don't
  half-move); the move is the runner's git transition.

(Done as its own slice because `complete` is already in `work/done/` and done
slices are immutable — this changes the *code*, captured as new work.)

## Acceptance criteria

- [ ] A failed gate in `complete` moves the item to `work/needs-attention/` with
      the reason recorded (not left dangling in `in-progress/`).
- [ ] A rebase conflict in `complete` aborts the rebase and routes to
      `needs-attention` with the conflict reason.
- [ ] No partial state on failure (nothing half-committed/half-moved).
- [ ] `--skip-verify` and the success path are unchanged.
- [ ] Tests cover gate-fail → needs-attention and conflict → needs-attention,
      against throwaway repos + a local `--bare` arbiter.

## Blocked by

- `needs-attention` — provides the move helper this routes failures through.

## Prompt

> Route `agent-runner complete`'s failure paths through the `needs-attention`
> mechanism, in `packages/agent-runner/`. READ FIRST: the `needs-attention` slice
> (the move helper to call), ADR §10/§12, and the existing `complete.ts`. Follow
> `AGENTS.md`.
>
> When the gate fails (no `--skip-verify`) or a rebase conflicts, instead of
> aborting in place, record the reason and move the item `in-progress →
> needs-attention` via the shared helper, so it is surfaced by `status` and
> returnable to `backlog/`. Keep the success and `--skip-verify` paths unchanged;
> ensure no partial/half-moved state on failure.
>
> TDD with vitest against throwaway repos + a local `--bare` arbiter: gate-fail →
> needs-attention, conflict → needs-attention, no partial state. "Done" =
> acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r
> format:check` green.
