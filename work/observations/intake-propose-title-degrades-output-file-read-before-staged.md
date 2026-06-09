---
title: intake's emitted commit subject + propose-PR title degrade to generic ('complete work slice' / 'feat(<slug>)') because integration-core reads the title from titlePath BEFORE the dispatcher stages the output file
type: observation
status: spotted
spotted: 2026-06-09
---

## What was spotted

Caught during the Gate-3 conductor review of PR #50
(`intake-tracer-slice-outcome`, the first `issue-intake` slice). The gate (Gate-2)
raised it as a non-blocking nit; recording it as the durable home.

`dispatchSlice()` in `src/intake.ts` sets `lifecycle.titlePath = join(cwd,
'work/backlog/<slug>.md')` and its doc-comment claims "the emitted slice IS the title
source — read it from the path the stage writes." But `integration-core.ts` reads the
title (around lines 509–511: `defaultSummary` / `readSliceTitle` /
`synthesiseProposeTitle`) **BEFORE** `lifecycle.stage()` writes that file (around line
524).

- For the `do prd:` SLICING path this works: `titlePath` points at an
  ALREADY-EXISTING held PRD, so the read succeeds.
- For INTAKE the output `work/backlog/<slug>.md` does NOT exist yet at read time, so
  `readSliceTitle` returns `undefined` → the commit subject falls back to
  `complete work slice` and the propose-PR title to `feat(<slug>)`.

The slice FILE's own frontmatter title is correct (`renderBacklogSlice` writes
`title: <sliceTitle>`); only the COMMIT subject + PR title are lost.

## Why it matters

- User-visible: an intake-emitted slice's PR lands with a generic `feat(<slug>)` title
  instead of the drafted human-readable title — worse changelog/PR hygiene.
- No test asserts the commit subject or PR title, so it passed the green gate silently
  (a test-coverage gap as much as a bug).

## Suggested fix (for a future slice — NOT now)

Either: write the output file in `dispatchSlice` BEFORE calling `performIntegration`
(so `titlePath` resolves), OR pass the drafted title explicitly via the `message`
option / the lifecycle stage rather than relying on a read-from-path that races the
write. Add a test asserting the intake commit subject + propose-PR title carry the
drafted slice title.

Likely belongs with `intake-decision-prompt-and-four-outcome-dispatch` (which already
touches the dispatcher + adds the PRD-emit path, with the same
write-then-integrate ordering question) or its own small follow-up slice. Cosmetic /
non-blocking, so it did not block PR #50.

## Refs

- PR #50 (`intake-tracer-slice-outcome`), merged 2026-06-09.
- `src/intake.ts` `dispatchSlice()`; `src/integration-core.ts` ~L509–524.
- Gate nits: `work/observations/review-nits-intake-tracer-slice-outcome-2026-06-09.md`
  (nit 1).
