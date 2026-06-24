---
title: SURFACE-PROTOCOL.md doc + buildSurfacePrompt points at it + thin surface-questions skill
slug: surface-protocol-doc-and-prompt
brief: runner-invoked-disciplines-into-protocol
blockedBy: [review-protocol-doc-and-shared-machinery]
covers: [1, 2, 3, 4, 5, 7]
---

## What to build

Apply the shared machinery built in the keystone slice to the **surface-questions** discipline. After this slice, surface-questions is in-band in every set-up repo.

End-to-end path:

- **New protocol doc `SURFACE-PROTOCOL.md`**, source-of-truth `skills/setup/protocol/SURFACE-PROTOCOL.md`, mirrored byte-identical into `work/protocol/SURFACE-PROTOCOL.md`. Content lifted VERBATIM from `skills/surface-questions/SKILL.md` body (GATHER-only / PERSIST-NEVER laws, humility rule, full discipline), plus a prose description of the emitted shape (what `parseSurfaceEmit` enforces, per D2).
- **Append `SURFACE-PROTOCOL.md` to the runtime-read doc SET** in `vendor-protocol.mjs` (add it to the declared list created by the keystone slice).
- **`setup` Phase A** copies the new doc automatically (already directory-copying); a setup test asserts it lands and that `work/protocol/VERSION` is bumped.
- **`buildSurfacePrompt` (`surface-gate.ts`) points at the resolved doc** via `resolveProtocolDoc('SURFACE-PROTOCOL.md', cwd)`, dropping the "Run the `surface-questions` skill" line AND the partial re-inlining of the two laws / humility rule.
- **Thin `skills/surface-questions/SKILL.md`** to a human-facing pointer at `work/protocol/SURFACE-PROTOCOL.md` (keep the model-invoked description; the standard lives in the protocol doc).

## Acceptance criteria

- [ ] `skills/setup/protocol/SURFACE-PROTOCOL.md` exists; `work/protocol/SURFACE-PROTOCOL.md` is byte-identical (`diff -r skills/setup/protocol work/protocol` clean for these files).
- [ ] `SURFACE-PROTOCOL.md` carries the full surface-questions discipline (lifted verbatim) and a prose description of the emitted shape.
- [ ] `vendor-protocol.mjs` ships `dist/protocol/SURFACE-PROTOCOL.md` (it appears in the declared set).
- [ ] `setup` test asserts the new doc lands in the target repo's `work/protocol/` and that VERSION is bumped.
- [ ] `buildSurfacePrompt` REFERENCES the resolved `SURFACE-PROTOCOL.md` and contains NO partial re-inlining of the laws / humility rule (prompt-snapshot test asserts no surface-discipline prose remains in the builder).
- [ ] Per-discipline shape drift guard: a canonical surface-emit fixture both PARSES via `parseSurfaceEmit` AND matches the shape `SURFACE-PROTOCOL.md` describes.
- [ ] `skills/surface-questions/SKILL.md` is a thin pointer at `work/protocol/SURFACE-PROTOCOL.md` (model-invoked description preserved).
- [ ] No regression in existing surface-gate verdict-parse + routing tests.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- `review-protocol-doc-and-shared-machinery` — needs the generalised `resolveProtocolDoc`, the vendored-set in `vendor-protocol.mjs`, and the thin-skill pattern established by the keystone. Also serialises edits to the shared files (vendor script, setup list, VERSION) to keep merges trivial.

## Prompt

> FIRST, check this task against current reality: does the keystone slice (`review-protocol-doc-and-shared-machinery`) actually exist in `tasks/done/`? If not, you cannot start (`blockedBy` must resolve). Re-confirm: (a) `resolveProtocolDoc(name, cwd)` is the resolver in use; (b) `vendor-protocol.mjs` vendors a SET driven by a declared list; (c) `setup` already copies the whole `skills/setup/protocol/` directory; (d) `buildSurfacePrompt` (in `packages/dorfl/src/surface-gate.ts`) still says "Run the `surface-questions` skill" and still partially re-inlines the two laws.
>
> Read the brief `work/briefs/ready/runner-invoked-disciplines-into-protocol.md` (Solution + D1, D2, D3). This is RELOCATION, not re-authoring — the surface discipline text moves VERBATIM from `skills/surface-questions/SKILL.md` into the new protocol doc (Out of Scope in the brief pins this).
>
> Code touchpoints:
>
> - `packages/dorfl/src/surface-gate.ts` — `buildSurfacePrompt`, `parseSurfaceEmit`.
> - `packages/dorfl/scripts/vendor-protocol.mjs` — add `SURFACE-PROTOCOL.md` to the declared set.
> - `skills/setup/protocol/SURFACE-PROTOCOL.md` (new), mirrored into `work/protocol/` byte-identically (the two-place discipline — see this repo's `AGENTS.md`).
> - `skills/surface-questions/SKILL.md` — thin to a pointer.
>
> Per-builder framing (single-item surface) stays — only the shared discipline body moves out. The shape's source of truth stays in `parseSurfaceEmit` (D2); the doc DESCRIBES it. Add a fixture-matches-doc test.
>
> Definition of done: `pnpm format` → `pnpm -r build && pnpm -r test && pnpm format:check` green. Do NOT commit or push — the runner owns git transitions.
