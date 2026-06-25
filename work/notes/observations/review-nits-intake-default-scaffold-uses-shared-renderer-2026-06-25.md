---
title: review-gate non-blocking nits for 'intake-default-scaffold-uses-shared-renderer' (Gate 2 approve)
date: 2026-06-25
status: open
reviewOf: intake-default-scaffold-uses-shared-renderer
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-default-scaffold-uses-shared-renderer' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The agent widened visibility of renderBacklogTask and renderPrd from module-private to exported solely so the characterisation test can call them. In-scope decision worth ratifying: is widening these two functions' surface acceptable, or should the test instead drive them through their public callers? No other module imports them (grep confirms only intake.ts + the new test), so the footprint is nil.
  (intake.ts L1581 / L1638 changed 'function' to 'export function'; only consumer is test/intake-default-scaffold.test.ts. Reversible, standard characterisation-test pattern.)
- Benign edge difference: if title/problemStatement were ever empty, the shared renderer substitutes a placeholder ('(no ## What to build prose was supplied.)') whereas the pre-rewire literal emitted an empty line. Intake always passes a non-empty title/transform line (and an empty title would already corrupt the frontmatter 'title:' field upstream), so no realistic intake path hits this; the placeholder is strictly safer if it ever did.
  (buildable-body.ts renderTaskBody/renderPrdBody placeholder branches vs intake callers passing review.title / verdict.prdTitle ?? slug.)
