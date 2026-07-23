---
title: 'Rename the slicer improver loop to a distinct --slicer-loop* flag family (on/off, --slicer-loop-max, --slicer-loop-model) — unmistakable from the gate''s --review*'
slug: slicer-loop-flag-family
spec: slicing-coherence
blockedBy: [slice-acceptance-gate]
covers: [4]
---

## What to build

Give the slicer IMPROVER loop (`slicer-review-loop.ts`) its OWN, distinct flag family so it can never be confused with the acceptance GATE's `--review*` family. Today the loop is controlled by `--max-review`/`maxReview` and shares the `reviewModel` name with the gate — both are name-collisions the SPEC wants gone.

Rename across flag + config key + env var + internal fields (mirror the `reviewPr → review` clean-rename precedent in `work/done/rename-reviewpr-to-review.md` — a clean isolated rename, no back-compat alias unless the maintainer asks):

- `--slicer-loop` / `--no-slicer-loop` — turn the improver loop on/off. **ON by default** (auto-slicing has no `verify` floor, so the loop is the slice path's quality engine). Today there is NO on/off flag — the loop runs whenever its seam is wired; add the explicit toggle.
- `--slicer-loop-max <n>` — the in-context convergence cap. This is today's `--max-review` / `maxReview` (config key + env `DORFL_MAX_REVIEW`); RENAME it. Default unchanged (3).
- `--slicer-loop-model <id>` — the loop reviewer's de-correlated model. The seam already exists internally as the loop's `reviewModel` field; RENAME that field to `slicerLoopModel` and EXPOSE it as this flag, so the loop stops sharing the `reviewModel` name with the acceptance gate.

NAMING RULE (the whole point): gate family = `--review*` (shared with build); improver-loop family = `--slicer-loop*` (slice-only). No flag/key/field name spans both. After this, the two review concepts are unmistakable at the CLI and in code.

Behaviour is otherwise IDENTICAL — this is a rename + an explicit on/off toggle, not a logic change to the loop.

## Acceptance criteria

- [ ] `--slicer-loop` / `--no-slicer-loop` toggle the improver loop on the `do prd:` (and `do --remote prd:`) path; ON by default.
- [ ] `--max-review` is GONE and replaced by `--slicer-loop-max <n>` (flag, config key, env var); resolution precedence (flag > env > per-repo > global > default) and the default (3) unchanged.
- [ ] The loop's internal `reviewModel` field is renamed `slicerLoopModel` and exposed as `--slicer-loop-model <id>`; the ACCEPTANCE GATE's `reviewModel` (build `--review-model`) is UNTOUCHED and still distinct.
- [ ] `grep` finds no `maxReview` / loop-side `reviewModel` left meaning the OLD thing (the loop now uses `slicerLoop*` names); the gate's `reviewModel` / `reviewMaxRounds` are untouched.
- [ ] Behaviour is byte-for-byte identical aside from the new on/off toggle (a renamed-flag run does exactly what the old `--max-review`-driven run did).
- [ ] In-tree specs/docs naming the old loop flags are updated for honesty.
- [ ] Existing slicer-loop tests pass under the new names (`slicer-maxreview-config.test.ts`, `slicer-review-loop.test.ts`, `slicing.test.ts` — rename references, keep assertions).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `slice-acceptance-gate` — the rename's WHOLE POINT is to make the improver loop unmistakable FROM the acceptance gate's `--review*` family, so the gate must exist first (and both touch `cli.ts` / `do-config.ts` / `config.ts` / `slicing.ts` / `slicer-review-loop.ts` — serialise to avoid the merge conflict).

## Prompt

> Rename the slicer IMPROVER loop's flag family so it is unmistakable from the acceptance GATE's `--review*` family (US #4). Mirror the clean-rename precedent in `work/done/rename-reviewpr-to-review.md` (rename across flag + config key + env + internal field; no back-compat alias unless asked; ZERO behaviour change beyond adding the on/off toggle).
>
> RENAMES:
>
> - ADD `--slicer-loop` / `--no-slicer-loop` (on by default) — today the loop has no on/off flag (it runs whenever the `reviewLoop` seam is wired in `cli.ts`); add an explicit toggle that gates wiring the seam.
> - `--max-review` / `maxReview` / `DORFL_MAX_REVIEW` → `--slicer-loop-max` / `slicerLoopMax` / `DORFL_SLICER_LOOP_MAX` (default 3, precedence unchanged).
> - the loop's internal `reviewModel` (in `slicer-review-loop.ts` / `slicing.ts`'s `PerformSliceOptions.reviewModel` for the LOOP) → `slicerLoopModel`, exposed as `--slicer-loop-model <id>`. LEAVE the acceptance gate's `reviewModel` / build `--review-model` UNTOUCHED.
>
> WHERE TO LOOK (verify — paths may have drifted): `src/cli.ts` (the `--max-review` option on the `do` command + the `reviewLoop`/`maxReview` wiring for in-place AND `--remote` prd: paths), `src/do-config.ts` (`maxReview` flag mapping + `ReviewFlags`), `src/config.ts` + `src/repo-config.ts` (`maxReview` in `Config` / `DEFAULT_CONFIG` / `REPO_ALLOWED_KEYS`), `src/env-config.ts` (`maxReview: 'number'`), `src/do.ts` (`DoOptions`/`DoRemoteOptions` `maxReview`/`reviewLoop` fields + threading), `src/slicing.ts` (`PerformSliceOptions` loop fields + the `runSliceReviewLoop` call), `src/slicer-review-loop.ts` (the loop's `reviewModel` field + `SliceReviewGateInput.reviewModel`). Tests: `test/slicer-maxreview-config.test.ts`, `test/slicer-review-loop.test.ts`, `test/slicing.test.ts`, `test/do-config.test.ts`, `test/env-config.test.ts`.
>
> SCOPE FENCE: do NOT touch the acceptance-gate `--review*` family (`review`/`reviewModel`/`reviewMaxRounds`/`autoMerge`) — those are correct. NAMING RULE: gate = `--review*`; improver loop = `--slicer-loop*`; no name spans both.
>
> FIRST run the drift check: confirm the loop is still driven by `--max-review`/`maxReview` and a loop-side `reviewModel`, and that `slice-acceptance-gate` has landed (so the `--review*` gate exists to be distinguished FROM). If the loop flags already carry `--slicer-loop*` names, or the gate slice has not landed, route to `needs-attention/` with the discrepancy rather than guessing.
>
> "Done" = the improver loop is driven by `--slicer-loop`/`--no-slicer-loop`/ `--slicer-loop-max`/`--slicer-loop-model` with the old names gone, the gate family untouched, behaviour identical aside from the toggle, tests green, and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
