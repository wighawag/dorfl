---
title: REVIEW-PROTOCOL.md doc + generalised resolver/vendor/setup + review-gate de-dup (keystone)
slug: review-protocol-doc-and-shared-machinery
brief: runner-invoked-disciplines-into-protocol
blockedBy: []
covers: [1, 2, 3, 4, 5, 6, 7]
---

## What to build

The **keystone tracer bullet** for this brief (per D4): build the shared machinery THROUGH the review discipline, end-to-end. After this slice, the review discipline is in-band in every set-up repo; slices 2 (surface) and 3 (slicing) then ride the same machinery.

End-to-end path:

- **New protocol doc `REVIEW-PROTOCOL.md`**, source-of-truth in `skills/setup/protocol/REVIEW-PROTOCOL.md`, mirrored byte-identical into `work/protocol/REVIEW-PROTOCOL.md`. Content is the body of `skills/review/SKILL.md` lifted verbatim (the lenses + their order + the destination check), PLUS a prose description of the emitted verdict shape (the shape itself stays code-owned per D2 — the doc DESCRIBES what `parseReviewVerdict` enforces).
- **Generalise the resolver:** `resolveClaimProtocolPath` becomes `resolveProtocolDoc(name, cwd)` (same precedence chain: override > target-repo `work/protocol/<name>` > vendored `dist/protocol/<name>` > dev-only `skills/` walk). The existing `CLAIM-PROTOCOL.md` call sites switch to `resolveProtocolDoc('CLAIM-PROTOCOL.md', cwd)`; the new review builders call `resolveProtocolDoc('REVIEW-PROTOCOL.md', cwd)`.
- **Generalise `vendor-protocol.mjs`** to vendor a SET of runtime-read protocol docs into `dist/protocol/` (drop the single-file assumption). Include `CLAIM-PROTOCOL.md` (unchanged) and the new `REVIEW-PROTOCOL.md`. Subsequent slices will append to this set; keep it data-driven (one list at the top of the script).
- **`setup` (Phase A) copies the new doc** alongside the existing ones (no special-case — it already copies the whole `skills/setup/protocol/` directory, so this falls out for free; bump `work/protocol/VERSION`).
- **Point the four review builders at the resolved doc**, dropping "use the `review` skill" + partial re-inlining: `buildReviewPrompt` and `buildSliceAcceptancePrompt` in `review-gate.ts`, `buildLoneSliceReviewPrompt` in `intake.ts`, `buildSliceReviewPrompt` in `slicer-review-loop.ts`. Each builder keeps its DISTINCT framing (code-vs-slice / slice-SET / lone-slice / slice-a-PRD); only the shared discipline body and the emitted-shape contract move out.
- **One shared JSON-verdict-contract helper** used by all four review builders (the verdict-contract prose is stated once and inlined by the helper).
- **Unify the verdict types:** collapse `ReviewVerdict` (`review-gate.ts`) and `SliceReviewVerdict` (`slicer-review-loop.ts`) into ONE type + ONE parser; callers route on the unified shape.
- **Thin `skills/review/SKILL.md`** to a human-facing pointer at `work/protocol/REVIEW-PROTOCOL.md` (keep the model-invoked description; the standard lives in the protocol doc, not the skill).

## Acceptance criteria

- [ ] `skills/setup/protocol/REVIEW-PROTOCOL.md` exists; `work/protocol/REVIEW-PROTOCOL.md` is byte-identical (`diff -r skills/setup/protocol work/protocol` clean apart from files that legitimately live in only one).
- [ ] `REVIEW-PROTOCOL.md` carries the full review discipline (content lifted from `skills/review/SKILL.md`) and a prose description of the emitted verdict shape.
- [ ] `resolveProtocolDoc(name, cwd)` exists with the documented precedence (override > target-repo > vendored > dev-walk); a resolver test mirroring the previous `resolveClaimProtocolPath` tests covers each rung for `CLAIM-PROTOCOL.md` AND `REVIEW-PROTOCOL.md`.
- [ ] All previous `resolveClaimProtocolPath` call sites use the generalised resolver; the old name is removed (no alias — no external users owed migration).
- [ ] `vendor-protocol.mjs` vendors the SET (driven by one declared list); a build of `packages/agent-runner` ships `dist/protocol/CLAIM-PROTOCOL.md` AND `dist/protocol/REVIEW-PROTOCOL.md`.
- [ ] `setup` test asserts the new doc lands in `work/protocol/` of the target repo and that `work/protocol/VERSION` is bumped.
- [ ] The four review prompt builders each REFERENCE the resolved `REVIEW-PROTOCOL.md` and the shared verdict-contract helper; NONE re-inline the lenses or the verdict contract (prompt-snapshot tests assert no review-discipline prose remains in the builders).
- [ ] One unified verdict type + one parser is used by all four review-gate routing sites; the old `SliceReviewVerdict` type is removed.
- [ ] Per-discipline shape drift guard: a canonical review-verdict fixture both PARSES via the unified parser AND matches the shape `REVIEW-PROTOCOL.md` describes.
- [ ] `skills/review/SKILL.md` is reduced to a thin pointer at `work/protocol/REVIEW-PROTOCOL.md` (model-invoked description preserved).
- [ ] No regression in existing review-gate / lone-slice / slicer-review-loop verdict-parse + routing tests.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- None — this is the spine; slices 2, 3, 4 build on it.

## Prompt

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? In particular re-confirm: (a) `review` is still the SEVERE inlining gap (nothing inlined across the four review builders); (b) `resolveClaimProtocolPath` is still the single-file resolver; (c) `vendor-protocol.mjs` still vendors a single file; (d) the two verdict types (`ReviewVerdict`, `SliceReviewVerdict`) still exist separately. If any of those has already moved, route to needs-attention with the discrepancy.
>
> This is the **keystone** slice for the brief `runner-invoked-disciplines-into-protocol`. Per its D4: build the shared machinery (doc-set resolver, vendor-the-set, setup-copies-the-set, the thin-skill pattern) THROUGH the review case, proven end-to-end. Slices 2 (surface) and 3 (slicing) will then be THIN — lift content to a doc, point the prompt at it, thin the skill — on machinery you create here.
>
> Read the brief in full at `work/briefs/ready/runner-invoked-disciplines-into-protocol.md` (especially the Solution section and resolved decisions D1–D4) and the in-band-portability doctrine in `work/protocol/CLAIM-PROTOCOL.md` ("the boundary travels with the prompt"). Also read `docs/adr/methodology-and-skills.md` §6 — slice 4 refines it, but you must not contradict it here.
>
> Code touchpoints (verify before editing):
>
> - `packages/agent-runner/src/review-gate.ts` — `buildReviewPrompt`, `buildSliceAcceptancePrompt`, `ReviewVerdict`, `parseReviewVerdict`.
> - `packages/agent-runner/src/intake.ts` — `buildLoneSliceReviewPrompt`.
> - `packages/agent-runner/src/slicer-review-loop.ts` — `buildSliceReviewPrompt`, `SliceReviewVerdict`.
> - `packages/agent-runner/src/` — wherever `resolveClaimProtocolPath` is defined and called.
> - `packages/agent-runner/scripts/vendor-protocol.mjs` — generalise to a set.
> - `skills/setup/` — Phase A copy step (it already copies the directory, so just add the doc to the source).
> - `skills/review/SKILL.md` — thin to a pointer.
> - `work/protocol/REVIEW-PROTOCOL.md` (new mirror) — keep byte-identical to `skills/setup/protocol/REVIEW-PROTOCOL.md` (this repo's two-place protocol discipline — see `AGENTS.md`).
>
> Discipline content (D1): lift VERBATIM from `skills/review/SKILL.md` body — this is RELOCATION, not re-authoring (the brief's "Out of Scope" pins this). The prose-description of the emitted shape (D2) mirrors what `parseReviewVerdict` enforces.
>
> Per-builder framing stays distinct; only the shared discipline body and the verdict-contract prose centralise. The shared verdict-contract helper is one function that returns the same prose block, called by all four builders.
>
> Definition of done: `pnpm format` → confirm `pnpm -r build && pnpm -r test && pnpm format:check` green (the repo's `verify` gate; see `AGENTS.md`). Do NOT commit or push — the runner owns git transitions.
