---
title: Source intake's default scaffold from the shared renderer skeleton
slug: intake-default-scaffold-uses-shared-renderer
prd: centralize-buildable-task-renderer-shared-by-intake-and-promotion
blockedBy: [shared-buildable-task-and-prd-body-renderer-extract]
covers: [2]
---

## What to build

Make intake's task/PRD renderers (`renderBacklogTask` ~L1580 and `renderPrd`
~L1636 in `intake.ts`) source their DEFAULT-SCAFFOLD section skeleton from the
SHARED renderer (the keystone task), so intake's empty-body fallback and
promotion's body cannot drift on section names/order. Intake's output must be
unchanged.

The honest scope here is narrow, and the task must respect it (do NOT overreach):
intake does NOT structurally build the task body. `renderBacklogTask` frontmatter-
wraps a `body` the intake decision-agent already DRAFTED (headings and all) and
only emits a thin default scaffold (`## What to build` + `## Acceptance criteria` +
`## Prompt`) when `body` is empty. So the ONLY part shareable with the central
renderer is that empty-body fallback skeleton. `renderPrd` is the same wrapper+
fallback shape for the PRD body.

End-to-end behaviour:

- When the agent DRAFTED a body, intake's behaviour is COMPLETELY untouched (it
  still wraps the drafted body verbatim) — this task must not route a drafted body
  through the shared renderer.
- When NO body was drafted, the default scaffold is produced from the shared
  renderer's canonical section skeleton instead of intake's local literal, so the
  fallback shares one source of truth with promotion. Same for the PRD scaffold
  via `renderPrd`.
- A characterisation test captures intake's CURRENT output for both cases (drafted
  body, and the no-body-drafted scaffold) as a golden, then asserts the rewired
  path reproduces it byte-for-byte — proving the change is purely an internal
  re-source with no output drift.

Intake's WRITER (its branch + integrate front door) is untouched — only the
default-scaffold section skeleton is sourced from the shared renderer.
File-orthogonal to the promotion rewire (`triage-persist.ts`).

## Acceptance criteria

- [ ] Intake's no-body-drafted DEFAULT SCAFFOLD (in `renderBacklogTask`, and the
      PRD scaffold in `renderPrd`) is sourced from the shared renderer's section
      skeleton; intake no longer carries its own literal copy of those headings.
- [ ] The drafted-body path is UNCHANGED (a drafted body is still wrapped verbatim,
      not re-rendered).
- [ ] Intake's emitted output is byte-identical to pre-rewire for BOTH cases
      (drafted body + no-body scaffold), asserted via a characterisation/golden
      test.
- [ ] Intake's writer / integration band is untouched (skeleton-sourcing only).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- `shared-buildable-task-and-prd-body-renderer-extract` (the shared renderer must
  exist first).

## Prompt

> Goal: source intake's DEFAULT-SCAFFOLD section skeleton from the shared renderer
> in `shared-buildable-task-and-prd-body-renderer-extract`, per PRD
> `centralize-buildable-task-renderer-shared-by-intake-and-promotion` (US #2),
> WITHOUT changing intake's output.
>
> IMPORTANT — honest scope: intake does NOT build the task body structurally.
> `renderBacklogTask` (~L1580 in `intake.ts`) wraps a `body` the intake agent
> already DRAFTED and only emits a thin default scaffold (`## What to build` +
> `## Acceptance criteria` + `## Prompt`) when `body` is EMPTY. `renderPrd` (~L1636)
> is the same wrapper+fallback for the PRD body. So the ONLY thing to share is the
> empty-body fallback section skeleton — do NOT route a drafted body through the
> shared renderer, and do NOT try to "make intake stop hand-rolling the body" (it
> barely does).
>
> FIRST check drift: confirm the keystone renderer landed in `tasks/done/` with the
> shape this task assumes, and that `renderBacklogTask`/`renderPrd` are still the
> wrapper+fallback functions described. If the keystone landed differently, route to
> needs-attention rather than building on a stale assumption.
>
> Rewire ONLY the empty-body default scaffold in `renderBacklogTask` (and the PRD
> scaffold in `renderPrd`) to come from the shared renderer's skeleton. Leave the
> drafted-body wrap path and intake's writer alone. Prove output is preserved with a
> characterisation test: snapshot the current output for BOTH the drafted-body case
> AND the no-body-drafted scaffold case, then assert the rewired path reproduces
> each byte-for-byte.
>
> Keep the edit confined to `intake.ts` + its test (file-orthogonal to the
> promotion rewire). Record any non-obvious decision in the done record. Finish
> green: `pnpm -r build && pnpm -r test && pnpm format:check`.
