---
title: Rewire triage-persist.buildPromotedBody to the shared renderer (retain the pre-claim guard)
slug: promotion-buildPromotedBody-uses-shared-renderer
spec: centralize-buildable-task-renderer-shared-by-intake-and-promotion
blockedBy: [shared-buildable-task-and-prd-body-renderer-extract]
covers: [3, 5, 6]
---

## What to build

Make `triage-persist.ts` `buildPromotedBody` produce its task (and PRD) body via
the SHARED renderer from the keystone task, REPLACING the hand-rolled `## Prompt`
block the interim guard task added. This removes the second copy of the
`## Prompt` logic so there is one owner, not two. Promotion's behaviour (the body
content, the discharge-by-deletion CAS writer) is otherwise unchanged.

End-to-end behaviour:

- `buildPromotedBody` builds the promoted TASK body through the shared renderer:
  `## What to build` (the mechanism prose) + optional `## Open questions` + a
  `## Prompt` seeded from the mechanism prose. The hand-rolled `## Prompt`
  assembly currently in `buildPromotedBody` (the `artifact !== 'prd'` block from
  the interim task) is DELETED in favour of the shared renderer's `## Prompt`
  seeding. The promoted PRD body likewise goes through the shared PRD-body
  renderer (no `## Prompt`).
- Promotion's WRITER is untouched: the triage-local `createItemThroughCas` /
  `promoteObservation` path, the atomic create+delete commit, and the
  CAS-loser-backs-off-leaving-the-note-intact guarantee all stay exactly as they
  are (US #5). Only the body RENDERING is delegated.
- The pre-claim well-formedness guard added by the interim task (in `claim-cas.ts`,
  reusing `extractPromptSection` before the lock is acquired) MUST REMAIN as
  defence in depth (US #6). This task does not touch it; add/keep a test that
  asserts it still refuses a promptless body pre-claim, so the guard is provably
  not regressed by the renderer move.
- A test asserts a promoted task STILL carries a `## Prompt` seeded from the
  mechanism prose and still passes `resolveTask`/`extractPromptSection` (the
  interim task's behaviour is preserved through the shared renderer, not lost).

File-orthogonal to the intake rewire (`intake.ts`), so the two can land in
parallel; both depend only on the keystone.

## Acceptance criteria

- [ ] `buildPromotedBody` renders task + PRD bodies via the shared renderer; the
      hand-rolled `## Prompt` block from the interim task is removed (one copy of
      the `## Prompt` logic remains, in the shared renderer).
- [ ] A promoted task still carries a `## Prompt` seeded from the mechanism prose
      and still passes `extractPromptSection`/`resolveTask`; a promoted PRD carries
      none.
- [ ] Promotion's CAS writer / atomic create+delete / loser-backs-off guarantees
      are untouched (RENDERING only).
- [ ] The pre-claim well-formedness guard (claim-cas.ts) is retained and a test
      asserts it still refuses a promptless body pre-claim with NO lock acquired.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- `shared-buildable-task-and-prd-body-renderer-extract` (the shared renderer must
  exist first).

## Prompt

> Goal: delegate `triage-persist.ts` `buildPromotedBody` to the shared renderer
> from `shared-buildable-task-and-prd-body-renderer-extract`, replacing the
> hand-rolled `## Prompt` block the interim task
> `promoted-task-emits-prompt-and-pre-claim-wellformedness-guard` added, per PRD
> `centralize-buildable-task-renderer-shared-by-intake-and-promotion` (US #3, #5,
> #6).
>
> FIRST check drift: confirm the keystone renderer landed in `tasks/done/` with the
> assumed shape, and that `buildPromotedBody` (~L393 in `triage-persist.ts`) still
> contains the interim task's hand-rolled `## Prompt` seeding (the `artifact !==
> 'prd'` block) and that the pre-claim guard still lives in `claim-cas.ts`. If any
> moved, route to needs-attention.
>
> FORWARD-NOTE (from the keystone's Gate-2 review, PR #247): the shared
> `renderTaskBody`'s default empty-prompt seed is `Build the task described
> above.`, which DIFFERS from `buildPromotedBody`'s current empty-mechanism seed
> `Build the task '<slug>', described above.`. To keep promotion's output
> byte-for-byte, pass the slug-bearing seed INTO `renderTaskBody` explicitly
> (do not rely on the renderer's generic default) — otherwise the empty-mechanism
> case changes. Assert this in a test.
>
> Rewire buildPromotedBody (task AND prd artifact paths) to the shared renderer and
> DELETE its hand-rolled `## Prompt` block. Touch RENDERING only: do NOT alter the
> `promoteObservation` / `createItemThroughCas` writer, the atomic create+delete
> commit, or the CAS-loser-backs-off behaviour (US #5). LEAVE the pre-claim
> well-formedness guard in `claim-cas.ts` in place (US #6) and keep/extend a test
> proving it still refuses a promptless body pre-claim with no lock acquired. Also
> assert a promoted task still carries a mechanism-seeded `## Prompt` and still
> passes `resolveTask`/`extractPromptSection`, so the interim behaviour survives the
> move.
>
> Keep the edit confined to `triage-persist.ts` + its tests (file-orthogonal to the
> intake rewire). Record any non-obvious decision in the done record. Finish green:
> `pnpm -r build && pnpm -r test && pnpm format:check`.

## Requeue 2026-06-25

Gate-2 BLOCK (correct): the rewire dropped the blank line after the frontmatter fence — emits '---\n## What to build' but must emit '---\n\n## What to build' (the byte-for-byte requirement + the original output). Cause: frontmatter array ends with '' joined by \n (one trailing \n) and renderTaskBody/renderPrdBody start at the heading with no leading blank, so only ONE newline separates fence and heading. FIX: insert the separator between frontmatter and the rendered body (e.g. frontmatter.join('\n') + '\n' + render...() , or own a single consistent leading-blank convention) so promotion's output is byte-for-byte unchanged AND matches what intake will produce when it adopts the renderer. Add a test asserting the '---\n\n##' fence spacing (the existing test only checked extractPromptSection, so it missed this).
