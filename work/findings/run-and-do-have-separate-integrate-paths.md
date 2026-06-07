---
title: run and do have SEPARATE gate+integrate pipelines — the review gate (#11/#12) covers do/complete but NOT run
date: 2026-06-06
status: open
---

## The finding (verified against the code)

`run` does NOT reuse the `do`/`complete` integrate path. Checked 2026-06-06:

- `src/run.ts` does **not** import `performDo` or `performComplete`.
- `run` has its **own** copy of the back-half: its own `testGate` (`pnpm -r test`,
  `run.ts` ~line 113/375), its own `applyNeedsAttentionTransition` calls
  (~316/391/453), and its own `integrateWithRebase` (~425). It is also currently
  SEQUENTIAL (a `for…await runOneItem` loop) — `run-daemon-reframe` is the slice
  that makes it genuinely concurrent.
- `do`/`complete` run the gate + integrate through `performComplete`
  (`src/complete.ts`), which is where the **review gate** (PR #11/#12) was inserted.

**Consequence:** the review gate (`reviewPr`/`autoMerge`/`reviewModel` + the
verdict→needs-attention routing) lives in `performComplete` and is therefore
inherited by `do` (and CI, which calls `do`) — but **`run` does NOT get it.** The
maintainer's assumption that "run reuses the do code path" does NOT hold for the
gate/integrate back-half.

## Why it matters

This is latent DUPLICATION of the gate→needs-attention→integrate logic across
`run.ts` and `complete.ts`. Every back-half feature (the review gate today; future
ones) must EITHER be duplicated into `run`, OR `run` should be refactored to share
`performComplete`. Duplication is how the two drift (the review gate already
demonstrates the drift: one path has it, the other doesn't).

## Disposition (resolve in the review grilling pass + a possible refactor slice)

- **Decide in the review grilling pass:** the review gate must cover BOTH `do` and
  `run`. Prefer making `run`'s per-item back-half CALL `performComplete` (one
  shared integrate path) over copying the review wiring into `run.ts`. That way the
  gate — and everything after it — is defined once.
- If full convergence is too big for the review slices, the minimum is: the
  review-gate slice(s) must EXPLICITLY wire the gate into `run`'s per-item path too
  (not silently only `do`), with a test asserting a `run` item is review-gated.
- A separate **`run`/`do` integrate-path convergence** refactor (route `run`'s
  per-item completion through `performComplete`) is the clean long-term fix —
  candidate for its own slice, possibly sequenced with `run-daemon-reframe`.

(Captured 2026-06-06 while checking whether the just-built review gate covers `run`.
It does not — `run` has its own integrate pipeline.)
