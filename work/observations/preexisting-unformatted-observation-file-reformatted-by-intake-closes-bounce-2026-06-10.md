---
title: a pre-existing base-branch observation file (review-nits-intake-self-awareness-…) is RED on format:check; intake-closes-issue-on-bounce's `pnpm format` reformatted it
date: 2026-06-10
slug: preexisting-unformatted-observation-file-reformatted-by-intake-closes-bounce
---

## What was spotted

While finishing `intake-closes-issue-on-bounce`, running `pnpm format` (the repo's documented fix step) reformatted ONE file unrelated to this slice: `work/observations/review-nits-intake-self-awareness-resumption-tracking-2026-06-10.md`. The change is pure whitespace/line-wrap (long bullet lines re-joined onto one line) — NO content change. That file is committed UNFORMATTED on the base branch and is RED on `pnpm format:check` independent of this slice (reverting it turns the gate red again).

This is the SAME class of issue the prior slice already flagged (its own last "Ratify reformatting a pre-existing, unrelated observation file" bullet, and `preexisting-unformatted-observation-file-fails-format-check-2026-06-10.md`): a base-branch markdown file that prettier wants to rewrap, so any slice that runs `pnpm format` to keep its gate green sweeps the reformat into its diff.

## Why it matters

- The acceptance gate (`pnpm format:check`) is RED on `main` for this file, so a scoped slice cannot leave a clean tree AND keep the gate green without either touching this file or fixing the base separately.
- Recording so the human ratifies including the content-neutral reformat in this slice's PR rather than treating it as scope creep.

## Scope / candidate fix

A tiny standalone "format the base" chore (run `pnpm format` on `main`, commit the whitespace-only fixes to the lingering observation files) would stop every future slice from inheriting this cross-touch. Not folded here (out of this slice's scope).

## References

- `work/observations/preexisting-unformatted-observation-file-fails-format-check-2026-06-10.md`
- `work/observations/review-nits-intake-self-awareness-resumption-tracking-2026-06-10.md` (the reformatted file).
