---
title: Extract ONE shared buildable-task (and PRD-body) renderer
slug: shared-buildable-task-and-prd-body-renderer-extract
spec: centralize-buildable-task-renderer-shared-by-intake-and-promotion
blockedBy: []
covers: [1, 4, 7]
---

## What to build

The keystone of the centralization: ONE function that renders a buildable TASK
body and ONE that renders a PRD body, so the buildable-task/PRD schema lives in a
single owner instead of being hand-rolled in each producer.

Today the section schema is duplicated, and the two producers are ASYMMETRIC:
`intake.ts` `renderBacklogTask` (~L1580) is a wrapper+fallback — it frontmatter-
wraps a body the intake agent already drafted, and emits a thin default scaffold
(`## What to build` + `## Acceptance criteria` + `## Prompt`) ONLY when no body was
drafted (its PRD sibling is `renderPrd` ~L1636). `triage-persist.ts`
`buildPromotedBody` (~L393) is a true STRUCTURED renderer — it fully builds
`## What to build` + mechanism prose + optional `## Open questions` + a hand-rolled
`## Prompt` (added by the interim guard task). The shareable thing is the canonical
SECTION SKELETON both rely on: promotion adopts the renderer wholesale, while
intake adopts only its default-scaffold skeleton.

End-to-end behaviour of this task (extract-only; no caller rewired yet, so it is a
pure addition that cannot regress either producer):

- A shared renderer takes the structured inputs a buildable task needs (the body
  prose for `## What to build`, acceptance criteria when present, the `## Prompt`
  body, and an optional `## Open questions` block) and produces the canonical task
  body. It must express BOTH the shapes its two future callers need: intake's
  default-scaffold skeleton (the empty-body fallback `## What to build` +
  `## Acceptance criteria` + thin default `## Prompt`) AND promotion's
  mechanism-prose-seeded full body. The `## Prompt` is task-only; a PRD body
  carries none.
- A symmetric PRD-body renderer (or the same renderer parameterised by artifact
  type) owns the PRD section skeleton (`## Problem Statement` + transcribed prose +
  optional `## Open questions`, no `blockedBy`, no `## Prompt`), so the same
  divergence cannot recur for PRDs.
- A single GOLDEN-SHAPE test asserts the renderer emits the required sections for
  each artifact type (task: `## What to build`, `## Acceptance criteria` when
  given, `## Prompt`; prd: `## Problem Statement`, NO `## Prompt`), and that a
  rendered task PASSES the dispatch validator (`extractPromptSection` /
  `resolveTask`) without the "has no '## Prompt' section" throw. This is the test
  both producers will later share, so a future schema change cannot silently apply
  to only one of them.

Do NOT rewire `intake`'s `renderBacklogTask`/`renderPrd` or
`triage-persist.buildPromotedBody` here — those are the two follow-on tasks (they
are file-orthogonal and each asserts its own output is preserved). This task only
lands the renderer + its golden test.

## Acceptance criteria

- [ ] A shared renderer exists that produces a buildable TASK body and can express
      both intake's default-scaffold skeleton and promotion's mechanism-seeded
      full body; a rendered task passes `extractPromptSection`/`resolveTask`
      without throwing.
- [ ] A PRD-body renderer (or the same renderer by artifact type) owns the PRD
      shape and emits NO `## Prompt`.
- [ ] A single golden-shape test asserts the required sections per artifact type
      and the task-dispatchability check; it is structured so the two producers
      can share it.
- [ ] No caller is rewired in this task (intake + promotion output is byte-for-byte
      unchanged because their code is untouched) — this is a pure additive extract.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- None — can start immediately (keystone; the two rewire tasks block on it).

## Prompt

> Goal: create the SINGLE owner of the buildable-task (and PRD-body) markdown
> schema, per PRD
> `centralize-buildable-task-renderer-shared-by-intake-and-promotion` (US #1, #4,
> #7). This is the keystone extract; the two caller rewires are separate follow-on
> tasks that block on this one.
>
> FIRST check drift: confirm the producers' shapes — `intake.ts`
> `renderBacklogTask` (~L1580, a wrapper that emits a default scaffold only when no
> body was drafted) + its PRD sibling `renderPrd` (~L1636), and
> `triage-persist.ts` `buildPromotedBody` (~L393, a structured renderer that now
> emits its own hand-rolled `## Prompt` after the interim guard task
> `promoted-task-emits-prompt-and-pre-claim-wellformedness-guard` landed in
> `tasks/done/`). The consumer that requires `## Prompt` is
> `extractPromptSection`/`resolveTask` in `prompt.ts`. If any of these moved, route
> to needs-attention rather than building on the stale premise.
>
> Build ONLY the shared renderer(s) + the golden-shape test. Do NOT rewire the two
> producers (that is the next two tasks, kept separate so each can prove its output
> is preserved and so the two file edits stay orthogonal). The renderer must be
> expressive enough to reproduce what each caller needs: intake's DEFAULT-SCAFFOLD
> skeleton (`## What to build` + `## Acceptance criteria` + thin default
> `## Prompt`, used only when no body was drafted) and promotion's full
> `## What to build` + mechanism prose + optional `## Open questions` + a
> `## Prompt` seeded (blockquoted) from the mechanism prose. `## Prompt` is
> task-only; PRD bodies carry none.
>
> Record any non-obvious in-scope decision (e.g. the exact parameter shape, how the
> two `## Prompt` seeding modes are expressed) in the done record / PR description.
> Use the existing throwaway-git-repo / pure-render test style in the
> `triage-persist` / `intake` tests. Finish green:
> `pnpm -r build && pnpm -r test && pnpm format:check`.
