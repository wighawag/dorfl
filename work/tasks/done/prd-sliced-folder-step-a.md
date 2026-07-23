---
title: 'Introduce spec-sliced/ as the source of truth for sliced-ness (folder = truth, sliced: as derived copy), flip the readers, backfill, re-slice path, sliceAfter reads the folder — STEP A (non-breaking)'
slug: prd-sliced-folder-step-a
spec: slicing-coherence
blockedBy: [slice-output-through-integration, slice-acceptance-gate]
covers: [7, 8, 9, 10, 11]
---

## What to build

Give PRDs the same folder lifecycle as slices, **minus `done/`**:

| build | SPEC analogue | meaning |
| --- | --- | --- |
| `backlog/` | `work/spec/` | ready to slice ("what needs slicing" at a glance) |
| `in-progress/` | `work/slicing/` | locked, being sliced (the held lock — exists) |
| `done/` | `work/spec-sliced/` | sliced, resting (NEW) |

This is STEP A — the **non-breaking** half (Step B, the `sliced:` marker removal, is the separate `remove-sliced-marker-step-b` slice, sequenced LAST). After Step A:

- **`work/spec-sliced/` exists and is the SOURCE OF TRUTH for sliced-ness**, exactly as `done/` is canonical for slices (with no `done:` marker). The release transition moves the SPEC `work/slicing/ → work/spec-sliced/` in the SAME runner-owned commit that emits the slices (one owner, no drift) — US #8.
- **`sliced:` is kept as a DERIVED COPY** written by the same release owner in that commit (so nothing that still reads the marker breaks). It is NOT yet removed — that is Step B.
- **The two `slicedSlugs` builders flip to folder-residence:** `slicing.ts:readSlicedSlugs` and `ledger-read.ts`'s SPEC-pool reader (`readLocalPrdPool`, behind `resolvePrdPool`) resolve sliced-ness from `work/spec-sliced/<slug>.md` residence, not the `sliced:` marker. Downstream (`slicing-eligibility.ts`, `select-priority.ts`) is UNCHANGED — they only see the resulting `Set<string>`.
- **`sliceAfter` resolves against `spec-sliced/` residence** (mirroring `blockedBy` → `done/`), since it consumes the flipped `slicedSlugs` — US #9.
- **Re-slicing a sliced SPEC is `work/spec-sliced/ → work/spec/`** (reopen-to-ready, mirroring `done/ → backlog/`), so a reshaped SPEC re-enters the slice pool with no special case — US #10.
- **BACKFILL:** the migration moves every existing `sliced:` SPEC in `work/spec/` into `work/spec-sliced/`, so the new folder is the complete canonical view from day one — US #11. (`work/spec/auto-slice.md` carries `sliced: 2026-06-04` today and must land in `spec-sliced/`.)
- **NAME is `spec-sliced/`** (NOT bare `sliced/` — too close to the `slicing/` LOCK; the `spec-` prefix keeps the three SPEC-state folders reading as a family).

Update WORK-CONTRACT.md, `CONTEXT.md`'s glossary, and any skill/ADR path references that describe the SPEC lifecycle so the on-disk contract documents `spec-sliced/`. In particular CONTEXT.md's `sliceAfter` glossary entry currently reads "resolved against the `sliced:` marker, NOT `done/`" — Step A makes that FALSE (US #9); update it to say residence in `work/spec-sliced/`, and add the SPEC lifecycle `work/spec/ → work/slicing/ → work/spec-sliced/` to the glossary so the next author cannot re-fork the term.

## Acceptance criteria

- [ ] The `do prd:` release moves the SPEC `work/slicing/ → work/spec-sliced/` ATOMICALLY with slice emission (ONE runner-owned commit), and writes the `sliced:` derived copy in that same commit.
- [ ] `readSlicedSlugs` (`slicing.ts`) and the `ledger-read.ts` SPEC-pool reader resolve sliced-ness from `spec-sliced/` residence; downstream `slicing-eligibility` / `select-priority` are unchanged (they see only the `Set`).
- [ ] `sliceAfter` resolves against `spec-sliced/` residence (a SPEC whose `sliceAfter` SPEC sits in `spec-sliced/` is sliceable; one still in `spec/` is not).
- [ ] Re-slice path: `git mv work/spec-sliced/<slug>.md work/spec/<slug>.md` reopen-to-ready re-enters the slice pool (test the round-trip).
- [ ] Backfill: a migration moves every existing `sliced:` SPEC from `work/spec/` into `work/spec-sliced/` (assert `auto-slice.md` lands there).
- [ ] The folder name is `spec-sliced/` (not bare `sliced/`).
- [ ] WORK-CONTRACT.md, CONTEXT.md (the `sliceAfter` glossary entry + the SPEC lifecycle `spec/ → slicing/ → spec-sliced/`), and relevant skill/ADR path references document `spec-sliced/` as the sliced-ness source of truth (no glossary line still claiming the `sliced:` marker resolves `sliceAfter`).
- [ ] `sliced:` is STILL written (derived copy) — NOT removed (that is Step B).
- [ ] Tests cover the lifecycle (release-move atomicity, both flipped readers, `sliceAfter`, re-slice, backfill), mirroring `slicing.test.ts` / `slicing-lock.test.ts` / `ledger-read.test.ts` style (throwaway git repos).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `slice-output-through-integration` — both edit `src/slicing.ts` (and the slicing release transition in `src/slicing-lock.ts`); serialise to avoid the merge conflict, and so the folder release-move sits cleanly on the already-reworked output path. (The SPEC's "Further Notes": the folder release-move sits on the keystone.)
- `slice-acceptance-gate` — FILE-OVERLAP serialization (no logical dependency): both edit `src/slicing.ts` / `performSlice`'s integrate region (the gate inserts review-before-integrate; this slice swaps the lifecycle-move destination). Serialise after the gate so the two changes to the same band do not collide; this also keeps Step B (`remove-sliced-marker-step-b`) genuinely last in the folder branch.

## Prompt

> Introduce `work/spec-sliced/` as the SOURCE OF TRUTH for SPEC sliced-ness, mirroring how `work/done/` is canonical for slices (covers US #7–#11 of `work/spec/slicing-coherence.md`). This is STEP A — the NON-breaking half; keep the `sliced:` frontmatter marker as a DERIVED COPY (its removal is the separate `remove-sliced-marker-step-b` slice, sequenced last).
>
> DOMAIN MODEL: SPEC lifecycle = `work/spec/` (ready to slice) → `work/slicing/` (held lock, being sliced) → `work/spec-sliced/` (sliced, resting), i.e. the build state machine minus `done/`. Folder = truth (like `done/`); `sliced:` becomes a derived copy written by the SINGLE release-transition owner in the SAME commit (no drift). Re-slice = `spec-sliced/ → spec/` (reopen-to-ready, like `done/ → backlog/`). `sliceAfter` then resolves against `spec-sliced/` residence (mirroring `blockedBy` → `done/`). See `work/ideas/folder-taxonomy-and-prd-edit-handshake.md` §"DECIDED 2026-06-08" (D1) and `work/observations/slice-output-bypasses-integration-vs-build.md`.
>
> WHERE TO LOOK (verify paths — they may have drifted): the release transition that moves `slicing/ → spec/` and emits slices (`src/slicing-lock.ts` `releaseSlicingLock` / `releaseAttempt`, + `src/slicing.ts` `performSlice` step 4); the TWO `slicedSlugs` builders — `src/slicing.ts:readSlicedSlugs` and `src/ledger-read.ts` `readLocalPrdPool` (behind `resolvePrdPool`); the downstream consumers `src/slicing-eligibility.ts` (`resolveSliceAfter`) and `src/select-priority.ts` (leave UNCHANGED — they only consume the `Set`). Also `ledger-read.ts`'s SPEC-existence read (it consults `spec/` + `slicing/` — add `spec-sliced/` where a sliced SPEC's slug must still be seen). Docs: `skills/to-slices/WORK-CONTRACT.md`, `CONTEXT.md` (the `sliceAfter` glossary entry
>
> - the lifecycle line), + any skill/ADR naming the SPEC lifecycle.
>
> NAME: `spec-sliced/` (NOT bare `sliced/` — it would sit confusingly beside the `slicing/` LOCK folder; the `spec-` prefix keeps the family readable).
>
> GLOSSARY: CONTEXT.md's `sliceAfter` entry currently says sliced-ness is "resolved against the `sliced:` marker, NOT `done/`" — this slice makes that FALSE (US #9). Update it to "resolved against `work/spec-sliced/` residence", and add the SPEC lifecycle `work/spec/ → work/slicing/ → work/spec-sliced/` to the glossary so the concept is pinned and cannot be re-forked.
>
> BACKFILL: move every existing `sliced:` SPEC in `work/spec/` into `work/spec-sliced/` (today `work/spec/auto-slice.md` has `sliced: 2026-06-04`). Decide whether this is a one-shot migration step or a `setup`/`scaffold`-time fixup; either way assert it lands `auto-slice` in `spec-sliced/`.
>
> SCOPE FENCE: keep `sliced:` WRITTEN (derived copy) — do NOT delete it, drop the frontmatter type, or remove back-compat (that is Step B). Do NOT touch the slicing LOCK semantics (stays the `spec → slicing/` CAS on `main`).
>
> FIRST run the drift check: confirm `readSlicedSlugs` + `ledger-read`'s SPEC pool still resolve sliced-ness from the `sliced:` MARKER (not a folder), and that `slice-output-through-integration` AND `slice-acceptance-gate` have landed (the release-move sits on the reworked output path, and the gate's edits to `performSlice` are already in so this slice's lifecycle-move swap does not collide). If a `spec-sliced/` folder already exists or a blocker has not landed, route to `needs-attention/` with the discrepancy.
>
> "Done" = `spec-sliced/` is the source of truth, both readers + `sliceAfter` flip to folder-residence, the release-move is atomic with slice emission, re-slice + backfill work, `sliced:` is kept as a derived copy, docs (incl. CONTEXT.md glossary) updated, tests green, and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Needs attention

agent failed: Connection error.

## Requeue 2026-06-08

Routed to needs-attention by a transient 'agent failed: Connection error.' (pi harness lost model connection mid-build), NOT a slice/gate defect. The partial work branch was never pushed to origin (the connection error killed the push). Re-claiming fresh; the local stale branch is discarded. Slice premises unchanged.
