---
title: the review agent (Gate 2) re-runs the test/build suite that verify (Gate 1) already proved green — wasted time/tokens
date: 2026-06-07
status: open
---

## The signal

Watching the `propose-pr-body` review (PR #15) live, the Gate-2 review agent RE-RAN
the test suite as part of its review. That is wasted work: Gate 2 runs ONLY after a
GREEN `verify` (the deterministic build + test + format floor — `complete.ts` reaches
the review block only on `gate.passed`). The acceptance gate is the authoritative,
non-skippable floor; re-running it inside the review buys nothing and costs time +
tokens (and, with `--watch`, noise).

## Direction

The review agent's value is JUDGEMENT, not re-confirming the deterministic floor:
does the diff deliver the slice, does it drift from its premise, does it hide a
defect a human reviewer would flag, does it reach the slice/PRD destination. The
prompt should TELL the reviewer the acceptance gate already passed (build + tests +
format are green) so it can ASSUME green and NOT re-run the suite — spending its
budget on judgement instead.

Nuance: this is "do not EXECUTE the suite," not "ignore tests." The reviewer may
still READ tests and reason about coverage; it just must not re-run them to confirm
green (that is Gate 1's settled job).

## Where

`buildReviewPrompt(slug)` in `src/review-gate.ts` (the single pure function that
renders the review-agent prompt) — add the assume-green instruction next to the
existing `Do NOT edit any files, run no git — you EMIT a verdict only.` constraint.
Sliced as `review-prompt-assume-gate-green`.
