---
title: review-gate non-blocking nits for 'intake-propose-title-from-drafted-slice' (Gate 2 approve)
date: 2026-06-11
status: open
slug: intake-propose-title-from-drafted-slice
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-propose-title-from-drafted-slice' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: on the PRD outcome, the explicit lifecycle title falls back to the slug when verdict.prdTitle is absent/empty (`title: verdict.prdTitle ?? slug`). The slice's precise scope named the lone-SLICE title path; the PRD branch was in-scope only as part of the same `dispatchSlice`/`dispatchPrd` fix. This `?? slug` fallback is a defensible default but was not explicitly specified — confirm it is the intended behaviour for a title-less PRD verdict.
  (src/intake.ts dispatchPrd: `title: verdict.prdTitle ?? slug` matches the same expression already passed to `renderPrd` for the frontmatter `title:`, so the explicit-title path and a file read would agree — behaviour is internally consistent and not a regression. Flagged only so the human ratifies the slug-fallback default rather than, say, the generic `complete work slice` summary, for a PRD verdict that omitted a title.)
