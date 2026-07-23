---
title: 'review-prompt-assume-gate-green — tell the Gate-2 review agent the acceptance gate already passed, so it does NOT re-run the suite'
slug: review-prompt-assume-gate-green
spec: review
blockedBy: []
covers: []
---

## What to build

Add ONE instruction to the Gate-2 review-agent prompt: the acceptance gate (Gate 1 — `verify`: build + tests + format) has ALREADY passed and is green, so the reviewer must ASSUME green and NOT re-run the suite — it spends its budget on JUDGEMENT only.

Spotted live on PR #15 (`propose-pr-body`): the review agent re-ran the test suite as part of its review. That is wasted time/tokens (and `--watch` noise). Gate 2 runs ONLY after a green Gate 1 (`complete.ts` reaches the review block exclusively on `gate.passed` — the deterministic floor is authoritative and non-skippable, ADR §8). Re-running it inside the review buys nothing. See `work/observations/review-agent-reruns-the-verify-gate.md`.

### Where (verified 2026-06-07)

The ONLY change is in `buildReviewPrompt(slug)` in `src/review-gate.ts` — the single pure function that renders the review-agent prompt. Add the assume-green instruction right next to the existing constraint line:

```
`Do NOT edit any files, run no git — you EMIT a verdict only.`
```

so the constraints read together: the deterministic gate already passed (assume the suite is green; do NOT re-run build/tests/format), you edit nothing, you run no git, you EMIT a verdict only.

### The nuance (do NOT overreach)

This is **"do not EXECUTE the suite to confirm green,"** NOT "ignore tests." The reviewer may still READ tests and reason about coverage — its job is judgement (does the diff deliver the slice / drift from its premise / hide a defect / reach the slice+SPEC destination). Word the instruction so it forbids RE-RUNNING the acceptance gate, not reading/reasoning about tests.

### Scope fence

- IN: one added instruction in `buildReviewPrompt` stating Gate 1 (build + tests + format) already passed → assume green, do NOT re-run the suite; a test asserting the rendered prompt carries it.
- OUT: changing the verdict/parse logic, the routing, `verify`, the lenses in the `review` SKILL itself, or any other prompt. Prompt text only.

## Acceptance criteria

- [ ] `buildReviewPrompt(slug)` renders an instruction telling the reviewer the acceptance gate (build + tests + format) has ALREADY passed (Gate 1, green) and to ASSUME green / NOT re-run the suite.
- [ ] The instruction makes clear it forbids RE-RUNNING the suite, not reading or reasoning about tests (no "ignore tests" wording).
- [ ] A unit test asserts the rendered prompt for a sample slug contains the assume-green instruction (alongside the existing "EMIT a verdict only").
- [ ] No change to `parseReviewVerdict`, the verdict routing, `verify`, or any other prompt — prompt text only (the existing review-gate tests still pass).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None. Builds on the merged review gate (#11–#14). Pure prompt-text change to one existing function.

## Prompt

> Add ONE instruction to the Gate-2 review-agent prompt: the acceptance gate (Gate 1 — `verify`: build + tests + format) has ALREADY passed and is green when the review runs (`complete.ts` reaches the review block only on `gate.passed`), so the reviewer must ASSUME green and NOT re-run the suite — spend the budget on JUDGEMENT. Spotted live on PR #15: the review agent re-ran the tests, which is wasted time/tokens. See `work/observations/review-agent-reruns-the-verify-gate.md`.
>
> The ONLY change is in `buildReviewPrompt(slug)` (`src/review-gate.ts`) — add the assume-green line next to the existing `Do NOT edit any files, run no git — you EMIT a verdict only.` constraint. NUANCE: forbid RE-RUNNING the suite, NOT reading/reasoning about tests (no "ignore tests"). Change NOTHING else (no verdict/parse/routing/verify changes; prompt text only).
>
> READ FIRST: `src/review-gate.ts` (`buildReviewPrompt` — the function to edit — and its existing tests); `work/observations/review-agent-reruns-the-verify-gate.md` (the signal); `work/spec/review.md` (Gate 1 = non-skippable floor, Gate 2 = judgement on top, ADR §8).
>
> TDD with vitest, house style: a test asserts the rendered prompt contains the assume-green instruction; the existing review-gate tests stay green. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim review-prompt-assume-gate-green --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/review-prompt-assume-gate-green <remote>/main
git mv work/in-progress/review-prompt-assume-gate-green.md work/done/review-prompt-assume-gate-green.md
```
