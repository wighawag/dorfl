---
title: intake's emitted commit subject + propose-PR title must carry the DRAFTED slice title — stop degrading to generic "complete work slice" / "feat(<slug>)" because integration-core reads titlePath BEFORE the dispatcher stages the output file
slug: intake-propose-title-from-drafted-slice
spec: issue-intake
blockedBy: []
covers: []
---

## What to build

Fix intake's degraded commit subject + propose-PR title. `integration-core` reads the slice title from `titlePath` BEFORE `dispatchSlice`'s `lifecycle.stage()` writes that file, so for the INTAKE lone-slice path the output `work/backlog/<slug>.md` does not yet exist at read time → `readSliceTitle` returns `undefined` → the commit subject falls back to `complete work slice` and the propose-PR title to the generic `feat(<slug>)`.

- For the `do prd:` SLICING path this works by accident: `titlePath` points at an ALREADY-EXISTING held PRD, so the read succeeds.
- For INTAKE the title source (the just-drafted slice) is written by `stage()` AFTER the title read — a read that races the write. The slice file's own frontmatter `title:` is correct (`renderBacklogSlice` writes it); only the COMMIT subject + PR title are lost.

Fix the ordering/threading so the drafted title reaches the commit subject + propose-PR title.

### Precise scope

- Make the drafted slice title available to `performIntegration` BEFORE it computes the commit subject / propose title — EITHER write the output `work/backlog/<slug>.md` in `dispatchSlice` BEFORE calling `performIntegration` (so `titlePath` resolves), OR pass the drafted title explicitly via the `message`/lifecycle-stage option instead of relying on a read-from-path that races the write. Prefer the explicit-title option if it is the cleaner seam (no reliance on file-existence ordering).
- Do NOT regress the `do prd:` slicing path (where `titlePath` is an existing PRD and the read already succeeds) — whatever the fix, that path must keep its current title.
- Add the missing test coverage: assert the intake-emitted COMMIT SUBJECT and the propose-PR TITLE carry the drafted human-readable slice title (today nothing asserts either, which is why it passed the green gate silently — a test-coverage gap as much as a bug).

## Acceptance criteria

- [ ] An intake lone-SLICE outcome emits a commit subject + propose-PR title carrying the DRAFTED slice title (not `complete work slice` / `feat(<slug>)`) — proven by a test asserting both strings.
- [ ] The `do prd:` slicing path's commit subject / title is unchanged (regression guard).
- [ ] The slice file's own frontmatter `title:` remains correct (unchanged).
- [ ] Tests mirror the repo's existing intake / integration-core test style (no shared/global location touched).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. Independent of the other intake slices.

## Prompt

> Fix intake's DEGRADED commit subject + propose-PR title. `integration-core` reads the slice title from `titlePath` BEFORE `dispatchSlice`'s `lifecycle.stage()` writes that file. For the `do prd:` slicing path `titlePath` is an already-existing PRD so the read succeeds; for the INTAKE lone-slice path the output `work/backlog/<slug>.md` does NOT exist yet at read time → `readSliceTitle` returns `undefined` → the commit subject falls back to `complete work slice` and the propose-PR title to generic `feat(<slug>)`. The slice file's frontmatter `title:` is correct; only the commit subject + PR title are lost.
>
> Fix the ordering/threading so the drafted title reaches `performIntegration` before it computes the commit subject / propose title: EITHER write the output file in `dispatchSlice` BEFORE `performIntegration`, OR (preferred if cleaner) pass the drafted title explicitly via the `message`/stage option instead of a read-from-path that races the write. Do NOT regress the `do prd:` path (titlePath = existing PRD, already works).
>
> READ FIRST: `src/intake.ts` `dispatchSlice()` (sets `lifecycle.titlePath` + the `stage()` that writes the output file); `src/integration-core.ts` around the title read (`defaultSummary` / `readSliceTitle` / `synthesiseProposeTitle`) vs. the later `lifecycle.stage()` call — confirm the read happens before the stage write. `work/spec-sliced/issue-intake.md` for the lone-slice outcome.
>
> SEAM TO TEST AT: the intake dispatch + integration path — assert the emitted COMMIT SUBJECT and the propose-PR TITLE both carry the drafted slice title (this is also the missing test that let the bug ship green).
>
> SCOPE FENCE: lone-SLICE title path only; do NOT touch the PRD/ASK/BOUNCE outcomes or the `do prd:` title behaviour beyond a regression guard.
>
> FIRST run the drift check (launch snapshot): confirm the title read still precedes the stage write for the intake path. If a later slice already reordered it, narrow or route to `needs-attention/`.
>
> "Done" = intake's commit subject + propose-PR title carry the drafted title, the `do prd:` path is unchanged, tests cover both, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

## Source

Promotes `work/observations/intake-propose-title-degrades-output-file-read-before-staged.md` (Gate-3 nit on PR #50, `intake-tracer-slice-outcome`). Related: `intake-decision-prompt-and-four-outcome-dispatch` (same write-then-integrate ordering).

---

### Claiming this slice

```sh
dorfl claim intake-propose-title-from-drafted-slice --arbiter origin
git fetch origin && git switch -c work/intake-propose-title-from-drafted-slice origin/main
git mv work/in-progress/intake-propose-title-from-drafted-slice.md work/done/intake-propose-title-from-drafted-slice.md
```
