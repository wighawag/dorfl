---
title: 'SLICING-PROTOCOL.md doc + buildSlicingBrief points at it + STALE vocabulary fix (to-task, work/tasks/, work/briefs/ready/)'
slug: slicing-protocol-doc-and-vocabulary-fix
brief: runner-invoked-disciplines-into-protocol
blockedBy: [surface-protocol-doc-and-prompt]
covers: [1, 2, 3, 4, 5, 7, 8]
---

## What to build

Apply the shared machinery to the **slicing** discipline, AND fix in passing the stale pre-rename vocabulary leaking from `buildSlicingBrief` into live spawned prompts. After this slice, all three runner-invoked disciplines (review, surface, slicing) are in-band in every set-up repo.

End-to-end path:

- **New protocol doc `SLICING-PROTOCOL.md`**, source-of-truth `skills/setup/protocol/SLICING-PROTOCOL.md`, mirrored byte-identical into `work/protocol/SLICING-PROTOCOL.md`. Content lifted VERBATIM from `skills/to-task/SKILL.md` body (the tracer-bullet rules, the two-axis gate guidance, the confidence check, file-orthogonality), plus a prose description of the emitted slice shape (what the slice parser enforces, per D2).
- **Append `SLICING-PROTOCOL.md` to the runtime-read doc SET** in `vendor-protocol.mjs`.
- **`setup` Phase A** copies the new doc; setup test asserts it lands and that `work/protocol/VERSION` is bumped.
- **`buildSlicingBrief` (`slicing.ts`) points at the resolved doc** via `resolveProtocolDoc('SLICING-PROTOCOL.md', cwd)`, dropping the "Use the **to-slices** skill" line AND the partial re-inlining of the confidence-check + `humanOnly` rules.
- **Fix the STALE vocabulary in `buildSlicingBrief`** (bonus bug called out in the brief): `to-slices` → `to-task`, `work/backlog/` → `work/tasks/backlog/`, `work/spec/` → `work/briefs/ready/`. Audit the whole `slicing.ts` for any other pre-rename strings.
- **Thin `skills/to-task/SKILL.md`** to a human-facing pointer at `work/protocol/SLICING-PROTOCOL.md` (keep it user-invoked — `disable-model-invocation: true` — the brief calls this out explicitly).

## Acceptance criteria

- [ ] `skills/setup/protocol/SLICING-PROTOCOL.md` exists; `work/protocol/SLICING-PROTOCOL.md` is byte-identical (`diff -r skills/setup/protocol work/protocol` clean for these files).
- [ ] `SLICING-PROTOCOL.md` carries the full slicing discipline (lifted verbatim from `skills/to-task/SKILL.md`) and a prose description of the emitted slice shape.
- [ ] `vendor-protocol.mjs` ships `dist/protocol/SLICING-PROTOCOL.md`.
- [ ] `setup` test asserts the new doc lands and VERSION is bumped.
- [ ] `buildSlicingBrief` REFERENCES the resolved `SLICING-PROTOCOL.md` and contains NO partial re-inlining of the confidence-check / `humanOnly` rules (prompt-snapshot test asserts no slicing-discipline prose remains in the builder).
- [ ] **Vocabulary regression test:** the assembled slicing prompt contains NONE of `to-slices`, `work/backlog/`, `work/spec/`; it correctly uses `to-task`, `work/tasks/backlog/`, `work/briefs/ready/`.
- [ ] Per-discipline shape drift guard: a canonical slice-task fixture both PARSES via the slice parser AND matches the shape `SLICING-PROTOCOL.md` describes.
- [ ] `skills/to-task/SKILL.md` is a thin pointer at `work/protocol/SLICING-PROTOCOL.md` (still user-invoked / `disable-model-invocation: true`).
- [ ] No regression in existing slicing verdict-parse + routing tests.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- `surface-protocol-doc-and-prompt` — serialises edits to the shared files (`vendor-protocol.mjs` declared set, setup test list, `work/protocol/VERSION`) to keep merges trivial. Transitively also depends on the keystone (`review-protocol-doc-and-shared-machinery`) for the generalised resolver and the thin-skill pattern.

## Prompt

> FIRST, check this task against current reality: do BOTH blockers exist in `tasks/done/` (the keystone + the surface slice)? Re-confirm: (a) `buildSlicingBrief` in `packages/dorfl/src/slicing.ts` STILL says "Use the **to-slices** skill" AND still mentions `work/backlog/` / `work/spec/` (the stale vocabulary the brief calls out); (b) `resolveProtocolDoc(name, cwd)` exists; (c) `vendor-protocol.mjs` vendors a SET. If the stale vocabulary has already been fixed in another slice, route to needs-attention with the discrepancy — do not silently skip the fix or build on a stale premise.
>
> Read the brief `work/briefs/ready/runner-invoked-disciplines-into-protocol.md` (Solution + D1, D2 + the "Bonus bug" paragraph + US #8). The vocabulary fix is in-scope precisely BECAUSE the relocation visits this exact prompt builder; doing it in passing is the cheapest moment.
>
> Code touchpoints:
>
> - `packages/dorfl/src/slicing.ts` — `buildSlicingBrief` (the spawned-agent prompt the runner builds when slicing a brief). The slice parser lives here or in a sibling module — locate it and use it as the shape's source of truth (D2).
> - `packages/dorfl/scripts/vendor-protocol.mjs` — add `SLICING-PROTOCOL.md` to the declared set.
> - `skills/setup/protocol/SLICING-PROTOCOL.md` (new), mirrored byte-identically into `work/protocol/`.
> - `skills/to-task/SKILL.md` — thin to a pointer; keep `disable-model-invocation: true` (this skill is user-invoked, unlike `review` / `surface-questions`).
>
> Discipline content lifts VERBATIM from `skills/to-task/SKILL.md` body — RELOCATION, not re-authoring (the brief's Out of Scope pins this).
>
> Definition of done: `pnpm format` → `pnpm -r build && pnpm -r test && pnpm format:check` green. Do NOT commit or push.
