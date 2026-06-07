---
title: review-gate-pr-comment — post the Gate-2 review verdict (incl. on approve) as a PR comment via a provider postComment seam
slug: review-gate-pr-comment
prd: review
blockedBy: [propose-pr-body]
covers: [3]
---

## What to build

Make the **PR/code review gate's verdict VISIBLE on the PR** by posting it as a PR
comment, on the `--propose` path. Today (Gate 2, PRs #11/#12) the review runs and
its verdict goes to the terminal `note(...)` (approve) or the needs-attention item
body (block) \u2014 but **nothing is posted to the PR**, so a human landing on the
proposed PR sees no review reasoning. This slice closes that (the `review` PRD's
"Gate 2 is more VISIBLE \u2014 posted AS a PR review/comment" property).

**Decided (maintainer, 2026-06-06): post the verdict INCLUDING on APPROVE** \u2014 an
approve comment is the audit trail ("the gate approved, here is why / the findings
it weighed"), not just blocks/nits. (A `block` never opens a PR \u2014 it routes to
needs-attention \u2014 so on the `--propose` path the comment is realistically the
approve verdict + any non-blocking nits. If a future path opens a PR despite a
block, the same comment mechanism posts the blocking findings.)

### The provider comment seam (SHARED surface with `propose-pr-body`)

Both this slice and `propose-pr-body` add a "write text to the PR" capability to the
provider seam (`src/integrator.ts` `ReviewProvider`). They are DISTINCT operations
on the SAME seam \u2014 keep them consistent (one provider, same graceful-degradation
discipline), do NOT build two parallel posting mechanisms:

- `propose-pr-body` (its `blockedBy`) adds the **creation BODY** (`--body` at
  `gh pr create`).
- THIS slice adds a **follow-up COMMENT on the already-opened PR**: a new
  `postComment(input)` method on `ReviewProvider`. The GitHub provider implements
  it via `gh pr comment <pr> --body <text>` (or `gh api`); the `none` provider
  degrades (no API \u2192 surface the verdict in the run output / instruction, never
  throw \u2014 ADR \u00a76, like `openRequest`).
- **PR identity:** `postComment` needs to target the opened PR. `openRequest`
  already returns the PR `url` (`OpenRequestResult.url`); thread that (or the PR
  number parsed from it) into `postComment`. So the order is: gate runs \u2192 verdict
  \u2192 `openRequest` opens the PR (propose) \u2192 `postComment` posts the verdict to it.
  If `openRequest` degraded (no PR opened \u2014 e.g. local `--bare` arbiter), there is
  no PR to comment on \u2192 the verdict stays in the run output (no-op, no throw).

### Where it wires in (the gate \u2192 propose \u2192 comment order)

The Gate-2 verdict is produced in `performComplete` (`src/complete.ts`, the
`reviewPr` block). Today on approve it falls through to integrate; on the propose
path that calls `openRequest`. This slice: after the PR is opened in propose mode,
if a review verdict was produced, `postComment` the formatted verdict to it. Reuse
`review-gate.ts`'s `formatBlockReason` shape for findings; add a `formatVerdict`
(approve + any non-blocking findings) for the approve case. The COMMENT is advisory
\u2014 it gates nothing (the gate already decided); it is pure visibility.

### Scope fence

- IN: a `postComment` method on the provider seam (GitHub via `gh pr comment`; none
  degrades); formatting the verdict (approve-with-nits AND block) into a comment;
  wiring it AFTER `openRequest` on the propose path, threading the PR url/number;
  posting on approve (the decided behaviour).
- OUT: the creation BODY (that is `propose-pr-body`, this slice's dep); changing the
  gate's verdict/routing logic (#11/#12 \u2014 unchanged; this only ADDS posting);
  auto-merge behaviour; the slicer edit loop. Block-routing still goes to
  needs-attention (a blocked item opens no PR on the propose path \u2014 the comment is
  for the PR that DID open).

## Acceptance criteria

- [ ] `ReviewProvider` gains `postComment(input)`; the GitHub provider posts via
      `gh pr comment` (or `gh api`) to the opened PR; the `none` provider degrades
      (surfaces the verdict in run output, never throws).
- [ ] On a `--propose` run with `reviewPr` on and an APPROVE verdict, the verdict
      (approve + any non-blocking findings) is posted as a comment on the PR that
      `openRequest` opened. PR identity comes from `openRequest`'s returned url/number.
- [ ] If `openRequest` degraded (no PR opened), `postComment` is a clean no-op (the
      verdict remains in the run output) \u2014 no throw, no lost work.
- [ ] The comment is advisory only: it changes no gate/verdict/merge/integration
      logic (assert the gate decision is identical with and without the comment).
- [ ] Verdict formatting covers approve-with-nits and (for any path that opens a PR
      despite findings) blocking findings; reuses/extends `review-gate.ts`'s
      formatting, not a parallel formatter.
- [ ] Consistent with `propose-pr-body` on the same seam (one provider, same
      degradation discipline; body-at-open vs comment-after are separate).
- [ ] Tests (stubbed provider, no real `gh`/network): approve \u2192 `postComment`
      called with the formatted verdict + the right PR identity; degraded provider
      \u2192 no-op; the GitHub adapter builds the right `gh` args; the gate decision is
      unchanged by commenting.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `propose-pr-body` \u2014 SHARED provider seam ("write text to the PR"). That slice
  establishes the body-at-open half + the seam consistency; this adds the
  comment-after half. Serialised so both shape the provider seam coherently (and to
  avoid two slices editing `src/integrator.ts` + `src/github.ts` in parallel).
- (Builds ON the merged Gate-2 work, #11/#12 \u2014 the verdict it posts; that is on
  `main`, so it is a foundation, not a pending dep.)

## Prompt

> Make the Gate-2 review verdict VISIBLE on the PR: post it as a PR COMMENT on the
> `--propose` path, INCLUDING on approve (decided 2026-06-06 \u2014 the comment is the
> audit trail). Today the verdict only hits the terminal `note(...)` / the
> needs-attention body; nothing reaches the PR.
>
> FIRST run the drift check: confirm `src/integrator.ts` `ReviewProvider` has
> `openRequest` returning `OpenRequestResult.url` (the PR identity you thread into
> the comment); confirm `src/github.ts` opens the PR via `gh pr create` (you add a
> sibling `gh pr comment`); confirm `src/complete.ts`'s `reviewPr` block produces
> the verdict and, on propose, reaches `openRequest`; confirm `propose-pr-body`
> (your dep) landed the `body`-on-`OpenRequestInput` seam shape you build alongside.
> Route to needs-attention on any real discrepancy.
>
> Implement: add `postComment(input)` to `ReviewProvider` (GitHub: `gh pr comment
> <pr> --body <text>` / `gh api`; none: degrade \u2014 surface in run output, never
> throw, ADR \u00a76). After `openRequest` opens the PR on the propose path, if a review
> verdict exists, format it (approve + non-blocking nits, reusing/extending
> `review-gate.ts`'s `formatBlockReason` \u2014 add a `formatVerdict`) and `postComment`
> it to the opened PR (thread the url/number from `openRequest`). If no PR opened
> (degraded), no-op. The comment is ADVISORY \u2014 it must change no gate/verdict/merge
> logic.
>
> READ FIRST: `work/prd/review.md` RESOLVED DESIGN (Gate 2 "more visible \u2014 posted as
> a PR comment"); `src/integrator.ts` (`ReviewProvider`, `OpenRequestResult.url`);
> `src/github.ts` (`gh pr create` \u2192 add `gh pr comment`); `src/complete.ts` (the
> `reviewPr` verdict + the propose `openRequest` call site); `src/review-gate.ts`
> (`ReviewVerdict`/`formatBlockReason` to reuse); `work/backlog/propose-pr-body.md`
> (the shared seam \u2014 body-at-open; keep consistent); ADR \u00a76 (provider seam +
> graceful degradation).
>
> TDD with vitest, house style (stubbed provider, no real gh/network): approve \u2192
> postComment with the formatted verdict + right PR identity; degraded provider \u2192
> no-op; gh adapter builds the right args; the gate decision is unchanged by
> commenting. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim review-gate-pr-comment --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/review-gate-pr-comment <remote>/main
git mv work/in-progress/review-gate-pr-comment.md work/done/review-gate-pr-comment.md
```
