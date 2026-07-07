## Context

Follow-up from the Gate-2 non-blocking review of the landed slice `apply-reconciles-resolved-brief-body` (see observation `review-nits-apply-reconciles-resolved-brief-body-2026-06-22` for full triage).

That slice added `stripOpenQuestionsBlocks` and calls it in `packages/dorfl/src/apply-persist.ts` (~line 430) as `const reconciledBody = stripOpenQuestionsBlocks(baseBody);` — sited BEFORE the `terminal === 'keep'` branch so the strip structurally feeds ALL full-resolution routes: default resolve, `keep`, `delete`, `dropped`, `needs-attention`.

The three tests added in `packages/dorfl/test/apply-persist.test.ts` only exercise the default resolve path plus re-pause. None of the terminal-disposition routes is covered with a marker-fenced body, so a future refactor that moved the strip INSIDE the default branch would silently regress the terminal routes with no failing test.

## Decision carried from the observation answers

- Markers stay un-prefixed (`<!-- open-questions -->` / `<!-- /open-questions -->`) — do NOT rename to `dorfl-open-questions` in this task. The un-prefixed form is what both sibling slices landed on; only revisit if a real author-collision is observed. The constants are centrally exported from `apply-persist.ts` so a rename later is cheap.
- Reconcile-on-every-terminal-route IS the intended scoping (matches the brief's 'full resolution = anything that clears needsAnswers'). This task LOCKS that invariant with a test; it does not change behaviour.

## Scope

Add ONE new test in `packages/dorfl/test/apply-persist.test.ts` that:

1. Starts from a task body containing a fenced `<!-- open-questions --> … <!-- /open-questions -->` block (same shape as the existing default-resolve reconcile test).
2. Drives `applyPersist` (or whatever the existing tests use) through a terminal-disposition route — `keep` is the natural pick; `delete` also fine — with answers that clear `needsAnswers`.
3. Asserts the persisted body has the fenced block stripped AND surrounding `\n{3,}` collapsed to `\n\n`, exactly like the default-resolve test asserts.

One test is enough; the point is to pin the structural invariant that the strip sits above the terminal-route branching, not to re-cover every route.

## Out of scope

- Renaming markers to a `dorfl-` prefix (explicitly declined — see answers).
- Surfacing the three behavioural decisions (strip-all-pairs / fail-safe on unmatched fence / collapse `\n{3,}` → `\n\n`) in a Decisions block on the already-landed done record (visibility-only nit, accepted as-is).
- Any change to `stripOpenQuestionsBlocks` behaviour or to `apply-persist.ts` production code — this is a test-only slice.

## Acceptance

- New test present and passing in `packages/dorfl/test/apply-persist.test.ts`.
- `pnpm -r build && pnpm -r test && pnpm format:check` green.
- Existing tests untouched (or only trivially refactored to share a fixture).

## Prompt

> Build the task 'apply-reconcile-terminal-route-test', described above.
