## Context

This task follows up on a non-blocking Gate 2 review nit against `f3b-promote-takes-per-item-advancing-lock` (see `work/observations/` history for `review-nits-f3b-promote-takes-per-item-advancing-lock-2026-06-22`).

The first finding of that review — that f3b's in-scope design decision (both `promote` paths, task and brief, reuse the existing `action: advance` lock value so all three transitions of one item serialise on the same per-item ref, recorded only in `packages/dorfl/src/needs-attention.ts` block comments rather than a `## Decisions` block of the done record) — was **ratified as-is** by the human. The recording-location convention is deferred to the standing decisions-block enforce-vs-relax decision, which was answered RELAX (a durable record anywhere checkable, including code comments, counts). Do NOT reopen f3b for this.

This task addresses ONLY the second finding: user-visible prose drift in the promote path.

## Problem

The promote path in `packages/dorfl/src/needs-attention.ts` still emits `pre-backlog` / `work/backlog/` / `pre-prd` / `work/prd/` nouns in user-visible strings, even though the pool vocabulary has been moving toward a new `todo` noun (via F1). Concretely:

- `packages/dorfl/src/needs-attention.ts` ~lines 818–825: `note()` message `'… is not staged in work/pre-backlog/ on …'` and the commit subject `chore(${slug}): promote work/pre-backlog/ -> work/backlog/`.
- line ~863: `note()` `Promoted '${slug}' from pre-backlog to backlog`.
- line ~869: `reasonNotMoved` text `item left in pre-backlog`.
- The symmetric brief block, ~lines 1034–1050 (same shape, with `pre-prd` / `work/prd/`).

This drift is **pre-existing**: f3b only wrapped these functions in `try/finally` for lock-release; it did not touch the strings. Fixing it inside f3b's scope would have been wrong. A small dedicated task is the right home.

## Scope

1. **FIRST**, confirm the canonical target noun against the live `work/tasks/` layout. At time of writing the tree has `work/tasks/backlog/` and `work/tasks/ready/` (no `todo/` directory), so the naive rename `pre-backlog → todo` may be wrong. Read the current layout, coordinate with the sibling F1 reader-side noun-alignment nit (see open observations referencing F1 noun alignment), and pick the noun that matches what F1 landed. Do not invent a third vocabulary.
2. Update the four task-side call sites (~818–825, ~863, ~869) and the symmetric brief block (~1034–1050) to use the confirmed noun and the confirmed directory paths.
3. Update or add tests that assert on these user-visible strings (`note()` messages, `reasonNotMoved`, commit subject) so the new vocabulary is pinned.
4. Keep the change surgical: strings + their tests only. Do NOT touch the lock-acquire logic, the `action: advance` reuse, or the try/finally structure — those are the ratified f3b design and must stay as-is.

## Non-goals

- Introducing a distinct `'promote'` lock action (explicitly ratified against; the shared `advance` value is the design).
- Adding a `## Decisions` block to f3b's done record (deferred to the RELAX standing decision).
- Any reader-side / F1 noun-alignment work beyond what's needed to confirm the target noun; that belongs to the F1 sibling nit.

## Acceptance

- All promote-path user-facing strings (task + brief) use the confirmed canonical noun matching the live `work/tasks/` layout.
- Tests exercise those strings and pass.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- No change to promote-path lock semantics.
