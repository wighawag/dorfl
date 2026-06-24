---
title: Gate-2 review verdict intermittently emitted invalid JSON, stopping `do` before the PR open
date: 2026-06-24
status: open
noticedDuring: do-allow-backlog drive-staged-tasks set (human-driven, the old way)
---

## What I noticed

While driving the 5-task `do-allow-backlog` set with explicit `dorfl do
task:<slug> --isolated` (config `review: true`, `integration: "propose"`), the
Gate-2 PR/code-review gate FAILED TO PARSE its own verdict as JSON on 2 of the
~6 build runs, with:

    error: review verdict was not valid JSON: Expected ',' or '}' after property
    value in JSON at position 8353 (line 9 column 2)

(positions varied: 8353 on the keystone, 5390 on work-contract). Each time the
acceptance gate had ALREADY passed green (build + 2611/2622 tests +
format:check), the work was committed + done-moved on the kept branch, and only
the Gate-2 verdict parse failed — so `do` stopped BEFORE opening the PR, leaving
a stranded already-complete worktree.

On the later 2 runs (leak-fence, drive-tasks) the SAME gate parsed fine and
posted an APPROVE + a nit. So it is INTERMITTENT, not a hard breakage.

## Why it matters

- It is a recoverable but manual-intervention-forcing failure: the build is
  done and green, yet the happy path (`do` → PR) does not complete. I recovered
  each via `complete --isolated` (stranded-recover, which integrates the kept
  commit and opens the PR), but an unattended `run`/`advance` leg hitting this
  would bounce or stall on work that is actually GATE-GREEN.
- The recover path SKIPS the Gate-2 re-run, so the human Gate-3 review has to
  fully substitute for the missed Gate-2 on those runs.

## Likely shape (hypothesis, not verified)

The review agent's structured-output emission is occasionally not strict JSON
(trailing prose after the object, an unescaped char, a truncation at a token
boundary). Candidates: tighten the verdict parse (extract the first balanced
JSON object / strip a markdown fence / retry once on parse failure) rather than
hard-failing the whole gate, OR constrain the review agent to emit a fenced
JSON block and parse only that.

## Pointer

The error string `review verdict was not valid JSON` is the grep anchor (the
Gate-2 verdict-parse site in the review-gate machinery). Out of scope for the
`do-allow-backlog` set; surfaced here for triage (promote-to-task / keep /
delete).
