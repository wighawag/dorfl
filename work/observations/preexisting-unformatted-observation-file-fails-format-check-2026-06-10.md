---
date: 2026-06-10
slug: preexisting-unformatted-observation-file-fails-format-check
---

## Pre-existing formatting violation on the base branch breaks the acceptance gate

`work/observations/review-nits-slice-level-issue-field-for-lone-issue-derived-slice-2026-06-10.md` was committed UNFORMATTED in `caa8b21` (slice `slice-level-issue-field-for-lone-issue-derived-slice`) and is identical on `origin/main`, so `pnpm format:check` (part of the acceptance gate `pnpm -r build && pnpm -r test && pnpm format:check`) is RED on `main` independent of any slice.

Noticed 2026-06-10 while building `intake-self-awareness-resumption-tracking`: running `pnpm format` (the repo's documented fix step) reformats it. To keep my slice's gate green I ran `pnpm format` and that one observation file got reformatted along with my own files — an unavoidable consequence of the whole-repo formatter on a base branch that was already non-compliant. The reformat is a pure whitespace/line-wrap fix (no content change).
