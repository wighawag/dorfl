---
title: a committed work/observations/ file fails `prettier --check`, so the `format:check` acceptance gate is RED on a clean checkout (pre-existing, unrelated to any in-flight slice)
date: 2026-06-10
slug: preexisting-prettier-violation-review-nits-observation
---

## What was spotted

`work/observations/review-nits-explicit-do-prd-not-gated-by-autoslice-2026-06-10.md` (committed in `6df4082`, slice #61) is NOT prettier-formatted: `pnpm format:check` (`prettier --check .`) flags it as a `[warn]` and exits 1. Because `format:check` globs the WHOLE tree (including `work/`), this makes the acceptance gate (`pnpm -r build && pnpm -r test && pnpm -r format:check`) RED on a clean checkout, independent of any in-flight slice — confirmed by running prettier against the `HEAD` blob directly.

Spotted 2026-06-10 while finishing the `intake-lone-slice-bounded-internal-review` slice: `pnpm format` (the writer) reformatted that file as a side-effect, which would otherwise have been swept into this slice's commit; reverting it to keep a scoped tree re-exposes the pre-existing gate failure.

## Why it matters

The done-gate is supposed to be green for a correctly-finished slice. A pre-existing unformatted committed file means EVERY slice either (a) inherits a red gate it did not cause, or (b) silently sweeps an unrelated formatting fix into its own commit (scope creep). Either is a small but real tax on every future slice.

## Suggested fix (out of scope here)

Run `pnpm format` and commit the single-file reformat on its own (a tiny chore commit / slice), so the gate is green on a clean base and no future slice has to choose between a red gate and unrelated scope creep.
