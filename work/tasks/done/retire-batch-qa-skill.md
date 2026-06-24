---
title: advance — RETIRE the old `batch-qa` skill (its judgement survives in `surface-questions`, its orchestration is absorbed by the advance engine, its human-batching by `orchestrate`)
slug: retire-batch-qa-skill
prd: advance-loop
blockedBy: [surface-questions-skill, advance-drivers-and-gates]
covers: [32]
---

## What to build

RETIRE the OLD `batch-qa` skill now that its three roles have new homes (MAINTAINER-RESOLVED §2): its question-formulation JUDGEMENT survives in the new `surface-questions` skill, its BOUND/APPLY/ITERATE/one-file ORCHESTRATION is absorbed by the advance engine, and its human-batching role is replaced by `orchestrate` + `surface-questions`. There is then ONE question/answer contract.

This is a small, clean removal sequenced LATE — after both the new skill exists (`surface-questions-skill`) and the engine that absorbs the orchestration is built (`advance-drivers-and-gates`), so nothing still depends on `batch-qa`.

### Precise scope

- Remove the `batch-qa` skill file from the repo's `skills/` area (and its registration/index entry if there is one).
- Update any references to `batch-qa` in docs / skills / ADRs to point at the new homes (`surface-questions` for the judgement, the advance engine for the orchestration, `orchestrate` for human-batching).
- The Gate-2 review-nits generator was ALREADY made skill-agnostic (`gate-nit-triage-text-skill-agnostic`, landed) so NO live generator re-mints the dead name — VERIFY this is still true (no code path emits the literal `batch-qa` skill name).
- `to-slices`/`review` stay UNCHANGED (US #35) — they are NOT part of this retirement.

## Acceptance criteria

- [ ] The `batch-qa` skill file (and any registration/index entry) is removed.
- [ ] No live code path emits/depends on the literal `batch-qa` skill name (verify the already-skill-agnostic gate-nit generator still holds; grep the codebase).
- [ ] References to `batch-qa` in docs/skills/ADRs are updated to the new homes (`surface-questions` / the advance engine / `orchestrate`).
- [ ] `to-slices`/`review` are UNCHANGED.
- [ ] Tests: nothing references the retired skill; the build/test/format gate is green (a removal that leaves no dangling reference). No shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `surface-questions-skill` — its judgement must have a new home before the old skill is retired.
- `advance-drivers-and-gates` — the engine that absorbs `batch-qa`'s orchestration must exist before the old skill is removed.

## Prompt

> RETIRE the old `batch-qa` skill. Read the PRD `advance-loop` (in `work/prd-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/prd/`) (US #32, "batch-qa → surface-questions", MAINTAINER-RESOLVED §2 — it is a NEW skill + retirement, NOT an in-place rename). `batch-qa`'s three roles now have homes: its question-formulation JUDGEMENT → the new `surface-questions` skill; its BOUND/APPLY/ITERATE/one-file ORCHESTRATION → the advance engine; its human-batching → `orchestrate` + `surface-questions`. Remove the skill file (+ any registration/index), update doc/skill/ADR references to the new homes, and VERIFY no live code path emits the literal `batch-qa` name (the gate-nit generator was already made skill-agnostic in `gate-nit-triage-text-skill-agnostic` — confirm it still holds). `to-slices`/`review` stay UNCHANGED.
>
> READ FIRST: the existing `batch-qa` skill (what is being retired), the new `surface-questions` skill (`surface-questions-skill`), the advance engine (`advance-drivers-and-gates`), and grep the codebase for `batch-qa` to find every reference. Check `gate-nit-triage-text-skill-agnostic` (landed) for the already-fixed generator.
>
> FIRST, check this slice against current reality (drift). If something still depends on `batch-qa` in a way the new homes don't cover, route to `needs-attention/` rather than removing blindly.
>
> "Done" = the skill is retired with no dangling references and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

### Claiming this slice

```sh
dorfl claim retire-batch-qa-skill --arbiter origin
git fetch origin && git switch -c work/retire-batch-qa-skill origin/main
git mv work/in-progress/retire-batch-qa-skill.md work/done/retire-batch-qa-skill.md
```
