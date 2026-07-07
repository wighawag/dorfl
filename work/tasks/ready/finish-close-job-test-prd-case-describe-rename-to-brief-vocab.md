## Context

This is a small follow-up carved out of observation `review-nits-rename-residual-slice-test-labels-and-skill-provenance-2026-06-23` (nit #1) on the approved task `rename-residual-slice-test-labels-and-skill-provenance`.

That original rename task named line-scope ~L115-140 of `test/close-job.test.ts` and correctly renamed the FIRST `it`-block inside the `runCloseJob — the PRD case` describe to brief/task vocabulary (`my-brief`, "closes the brief's issue when ALL its tasks are in work/tasks/done/"). But the enclosing describe title AND every SIBLING `it`-block plus their fixtures still read old `my-prd` / `prd:<slug> slice` / "PRD" vocabulary, leaving one renamed it-block sitting next to unrenamed neighbours. The Gate-3 follow-up on the original task explicitly directed finishing this describe sweep; the human ratified promoting it as its own tiny task rather than leaving the wart.

## Scope (what to change)

In `test/close-job.test.ts` only:

- Rename the describe at ~L114 `runCloseJob — the PRD case (consumes the "PRD complete?" query)` to the brief/task equivalent (e.g. `runCloseJob — the brief case (consumes the "brief complete?" query)`), keeping whatever phrasing the query is actually called in current src.
- Rename every SIBLING `it`-block inside that describe (starting at ~L140 `leaves the PRD issue OPEN when a prd:<slug> slice is NOT yet ...` and any others in the same describe) so their titles use brief/task wording instead of PRD/slice wording — matching the vocabulary the first, already-renamed it-block uses.
- Rename the in-test fixture identifier `my-prd` -> `my-brief` throughout this describe (approx L141-143, L159-160, L210-211, L233 per the observation), and update any string-literal call-sites that reference it: `brief:my-brief` labels, `toContain(...)` / `toEqual(...)` expectations, JSDoc/comment prose mentioning "the prd" / "prd's issue" -> brief/task wording.
- Prose inside test bodies mentioning "the PRD" / "prd's issue" -> "the brief" / "brief's issue" (or task, where the semantics is a task).

## Explicit non-scope (fence)

Do NOT touch:

- The first-argument fixture-FOLDER words `'prd'` / `'prd-sliced'` (or any `work/prds/...` folder-name string). Those are owned by the separate task `clean-break-fixture-folder-vocab-compat-seam` and are a deliberate scope fence for this follow-up.
- Nit #2 from the parent observation (the `sliceablePrds` -> `taskableBriefs` stale comment sweep across `test/scan.test.ts:396`, `select-priority.test.ts:54`, `mirror-pool-scan.test.ts`, `do-autopick.test.ts:294`). That is surfaced separately; leave it alone here.
- Any src/ file. This is a test-only rename.
- Any other test file. Only `test/close-job.test.ts` is in scope.

## Why this is a task, not a coherence wart

The original task's Gate-3 follow-up explicitly stated finishing the describe sweep as an acceptance criterion; the residual is therefore a stated-but-unmet criterion of the parent task, not just cosmetic drift. Splitting it out (rather than reopening the parent) keeps the parent's approved gates intact and makes the sweep buildable in isolation.

## Acceptance

- `test/close-job.test.ts` reads coherently: the (renamed) describe title, all its `it`-block titles, and all in-body fixture ids / prose use brief/task vocabulary. No mixed-vocabulary neighbours inside that describe.
- Fixture-FOLDER first-arg strings (`'prd'`, `'prd-sliced'`, etc.) are unchanged (fence with `clean-break-fixture-folder-vocab-compat-seam` held).
- `pnpm -r build && pnpm -r test && pnpm format:check` green.
- No src/ changes, no other test files changed.

## Prompt

> Build the task 'finish-close-job-test-prd-case-describe-rename-to-brief-vocab', described above.
