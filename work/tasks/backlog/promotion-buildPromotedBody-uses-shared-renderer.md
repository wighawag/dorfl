---
title: Rewire triage-persist.buildPromotedBody to the shared renderer (retain the pre-claim guard)
slug: promotion-buildPromotedBody-uses-shared-renderer
prd: centralize-buildable-task-renderer-shared-by-intake-and-promotion
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
