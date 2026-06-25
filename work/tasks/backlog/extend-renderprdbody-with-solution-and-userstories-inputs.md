---
title: Extend renderPrdBody with optional ## Solution + ## User Stories inputs
slug: extend-renderprdbody-with-solution-and-userstories-inputs
prd: centralize-buildable-task-renderer-shared-by-intake-and-promotion
blockedBy: []
covers: [4]
---

## What to build

Extend the shared PRD-body renderer `renderPrdBody`
(`packages/dorfl/src/buildable-body.ts`) so it can express the FULL set of PRD
sections both producers need, by adding OPTIONAL `solution` and `userStories`
inputs (each emitted only when supplied). This is the prerequisite that lets
intake's PRD default scaffold be sourced from the shared renderer byte-for-byte
(the follow-on intake-rewire task).

Why: `renderPrdBody` currently emits ONLY `## Problem Statement` + optional
`## Open questions`. But intake's `renderPrd` default scaffold (the no-body case)
emits `## Problem Statement` + `## Solution` + `## User Stories` (no Open
questions), while promotion's `buildPromotedBody(artifact:'prd')` emits
`## Problem Statement` + prose + optional `## Open questions` (no Solution/User
Stories). The renderer must own BOTH shapes via optional inputs, so neither
producer hand-rolls PRD sections and the two cannot drift.

End-to-end behaviour:

- `RenderPrdBodyInput` gains optional `solution` and `userStories` (plain section
  body strings, e.g. the prose / the numbered list). Each section is emitted ONLY
  when its input is non-empty, dropped otherwise — exactly like the existing
  optional `openQuestions`.
- Section ORDER is fixed and canonical: `## Problem Statement` → `## Solution`
  (when given) → `## User Stories` (when given) → `## Open questions` (when given).
  Still NO `## Prompt` (a PRD is not dispatched).
- The renderer can now reproduce intake's default PRD scaffold byte-for-byte
  (Problem Statement + Solution + User Stories, no Open questions) AND promotion's
  PRD body (Problem Statement + prose, optional Open questions, no Solution/User
  Stories) — verified by the golden-shape test.
- This task does NOT rewire either producer (that is the intake-rewire follow-on,
  and promotion already calls `renderPrdBody` with neither new input, so it is
  unaffected by the additive change). Pure additive extension + tests.

## Acceptance criteria

- [ ] `renderPrdBody` accepts optional `solution` and `userStories`; each section
      is emitted only when supplied and dropped when omitted/empty.
- [ ] Section order is Problem Statement → Solution → User Stories → Open
      questions; no `## Prompt` is ever emitted.
- [ ] A golden-shape test covers: both new sections present; each absent
      independently; and that the existing promotion shape (neither new input) is
      byte-for-byte unchanged (so the additive change cannot regress the already-
      merged promotion caller).
- [ ] No producer is rewired here (additive only).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- None — can start immediately (extends the already-merged keystone renderer; the
  intake-rewire task blocks on THIS).

## Prompt

> Goal: extend the shared `renderPrdBody` (`packages/dorfl/src/buildable-body.ts`)
> with optional `solution` + `userStories` section inputs, per PRD
> `centralize-buildable-task-renderer-shared-by-intake-and-promotion` (US #4), so
> the renderer owns the FULL PRD section schema both producers need. This is the
> prerequisite for sourcing intake's PRD default scaffold from the shared renderer
> byte-for-byte.
>
> FIRST check drift: confirm `renderPrdBody` (landed by the keystone task
> `shared-buildable-task-and-prd-body-renderer-extract`, now in `tasks/done/`)
> currently emits `## Problem Statement` + optional `## Open questions` only, and
> that intake's `renderPrd` default scaffold (`intake.ts`) still emits
> `## Problem Statement` + `## Solution` + `## User Stories`. If either moved, route
> to needs-attention.
>
> Add optional `solution` and `userStories` to `RenderPrdBodyInput`; emit each
> section only when its input is non-empty, in the canonical order Problem
> Statement → Solution → User Stories → Open questions. Never emit `## Prompt`.
> Keep it ADDITIVE: do not rewire intake or promotion here (promotion calls
> `renderPrdBody` with neither new input and must stay byte-for-byte unchanged —
> assert this in the golden test). Mirror the existing `renderPrdBody`/
> `renderTaskBody` test style in `buildable-body.test.ts`. Finish green:
> `pnpm -r build && pnpm -r test && pnpm format:check`.
