---
title: Source intake's default scaffold from the shared renderer skeleton
slug: intake-default-scaffold-uses-shared-renderer
prd: centralize-buildable-task-renderer-shared-by-intake-and-promotion
blockedBy: [extend-renderprdbody-with-solution-and-userstories-inputs]
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

Both scaffolds are now FULLY sourceable: the keystone `renderTaskBody` already
covers intake's task scaffold (`## What to build` + `## Acceptance criteria` +
`## Prompt`), and the follow-up `extend-renderprdbody-with-solution-and-userstories-inputs`
(this task's blocker) extends `renderPrdBody` with optional `solution` +
`userStories` so intake's PRD scaffold (`## Problem Statement` + `## Solution` +
`## User Stories`) is reproducible byte-for-byte. So BOTH halves of this task are
achievable — the earlier blocker (renderPrdBody lacked Solution/User Stories) is
removed by that extension task.

End-to-end behaviour:

- When the agent DRAFTED a body, intake's behaviour is COMPLETELY untouched (it
  still wraps the drafted body verbatim) — this task must not route a drafted body
  through the shared renderer.
- When NO body was drafted, the default scaffold is produced from the shared
  renderer's canonical section skeleton instead of intake's local literal, so the
  fallback shares one source of truth with promotion. This applies to BOTH the
  task scaffold (`renderBacklogTask` → `renderTaskBody`) AND the PRD scaffold
  (`renderPrd` → the extended `renderPrdBody`, passing `solution` + `userStories`).
- Mind the fence spacing: promotion's rewire established that the frontmatter
  writer owns the single blank line between the `---` fence and the first heading
  (`---\n\n## ...`), because the shared renderer starts AT its heading with no
  leading blank. Intake's `renderPrd`/`renderBacklogTask` already join with
  `${frontmatter}\n\n${drafted}`, so preserve exactly that to stay byte-identical.
- A characterisation test captures intake's CURRENT output for both cases (drafted
  body, and the no-body-drafted scaffold) as a golden, then asserts the rewired
  path reproduces it byte-for-byte — proving the change is purely an internal
  re-source with no output drift.

Intake's WRITER (its branch + integrate front door) is untouched — only the
default-scaffold section skeletons (task AND PRD) are sourced from the shared
renderer.
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

- `extend-renderprdbody-with-solution-and-userstories-inputs` (the PRD renderer
  must carry `## Solution` + `## User Stories` before intake's PRD scaffold can be
  sourced byte-for-byte). That task in turn followed the now-merged keystone
  `shared-buildable-task-and-prd-body-renderer-extract`, so `renderTaskBody` is
  already available for the task scaffold.

## Prompt

> Goal: source intake's DEFAULT-SCAFFOLD section skeleton from the shared renderer
> in `shared-buildable-task-and-prd-body-renderer-extract`, per PRD
> `centralize-buildable-task-renderer-shared-by-intake-and-promotion` (US #2),
> WITHOUT changing intake's output.
>
> IMPORTANT — honest scope: intake does NOT build the body structurally.
> `renderBacklogTask` (~L1580 in `intake.ts`) wraps a `body` the intake agent
> already DRAFTED and only emits a thin default scaffold (`## What to build` +
> `## Acceptance criteria` + `## Prompt`) when `body` is EMPTY. `renderPrd` (~L1636)
> is the same wrapper+fallback for the PRD body (its default scaffold is
> `## Problem Statement` + `## Solution` + `## User Stories`). So the ONLY thing to
> share is the empty-body fallback section skeleton — do NOT route a drafted body
> through the shared renderer.
>
> FIRST check drift: confirm the keystone `renderTaskBody` AND the extended
> `renderPrdBody` (with `solution` + `userStories`, from the blocker task
> `extend-renderprdbody-with-solution-and-userstories-inputs`) are in `tasks/done/`
> and that `renderBacklogTask`/`renderPrd` are still the wrapper+fallback functions
> described. If a blocker landed differently, route to needs-attention.
>
> Rewire ONLY the empty-body default scaffolds — `renderBacklogTask` →
> `renderTaskBody`, and `renderPrd` → the extended `renderPrdBody` (pass `solution`
> + `userStories` so its `## Solution`/`## User Stories` sections reproduce intake's
> scaffold). Leave the drafted-body wrap path and intake's writer alone. Preserve
> the `${frontmatter}\n\n${drafted}` fence spacing exactly (the frontmatter writer
> owns the blank line; the renderer starts at its heading). Prove output is
> preserved with a characterisation test: snapshot intake's CURRENT output for BOTH
> the drafted-body case AND the no-body-drafted scaffold case (task AND PRD), then
> assert the rewired path reproduces each byte-for-byte. Beware the
> byte-drift-the-test-misses pattern (it bit the promotion rewire): assert the
> WHOLE scaffold bytes, not just section presence.
>
> Keep the edit confined to `intake.ts` + its test (file-orthogonal to the
> promotion rewire). Record any non-obvious decision in the done record. Finish
> green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Requeue 2026-06-25

Re-scoped per human decision (option 2): the keystone renderPrdBody is being EXTENDED to carry optional ## Solution + ## User Stories inputs (new task extend-renderprdbody-with-solution-and-userstories-inputs), so intake's PRD default scaffold CAN then be sourced byte-for-byte. This task now blockedBy that extension. No prior work to keep (it correctly STOPPED without building), so --reset.
