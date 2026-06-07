---
title: review-gate-pr-comment — post the agent's VERBATIM Gate-2 review (incl. on approve) as a PR comment via a provider postComment seam
slug: review-gate-pr-comment
prd: review
blockedBy: [propose-pr-body]
covers: [3]
---

## What to build

Make the **PR/code review gate's verdict VISIBLE on the PR** by posting it as a PR
comment, on the `--propose` path. Today (Gate 2, PRs #11/#12) the review runs and
its verdict goes to the terminal `note(...)` (approve) or the needs-attention item
body (block) — but **nothing is posted to the PR**, so a human landing on the
proposed PR sees no review reasoning. This slice closes that (the `review` PRD's
"Gate 2 is more VISIBLE — posted AS a PR review/comment" property).

**Decided (maintainer, 2026-06-06): post the verdict INCLUDING on APPROVE** — an
approve comment is the audit trail ("the gate approved, here is why / the findings
it weighed"), not just blocks/nits. (A `block` never opens a PR — it routes to
needs-attention — so on the `--propose` path the comment is realistically the
approve verdict + any non-blocking nits. If a future path opens a PR despite a
block, the same comment mechanism posts the blocking findings.)

### The provider comment seam (SHARED surface with `propose-pr-body`)

Both this slice and `propose-pr-body` add a "write text to the PR" capability to the
provider seam (`src/integrator.ts` `ReviewProvider`). They are DISTINCT operations
on the SAME seam — keep them consistent (one provider, same graceful-degradation
discipline), do NOT build two parallel posting mechanisms:

- `propose-pr-body` (its `blockedBy`) adds the **creation BODY** (`--body` at
  `gh pr create`).
- THIS slice adds a **follow-up COMMENT on the already-opened PR**: a new
  `postComment(input)` method on `ReviewProvider`. The GitHub provider implements
  it via `gh pr comment <pr> --body <text>` (or `gh api`); the `none` provider
  degrades (no API → surface the verdict in the run output / instruction, never
  throw — ADR §6, like `openRequest`).
- **PR identity — and the CORRECT wiring LAYER (verified against the code, review
  finding 2026-06-06):** the review VERDICT is produced in `src/complete.ts`
  (`performComplete`'s `review` block, as `lastVerdict`). `openRequest` is NOT
  called there — it is called DEEP inside the integrator (`src/integrator.ts`
  `integrateWithRebase`'s propose branch), TWO LAYERS DOWN, where the verdict is
  NOT in scope. **Do NOT post the comment "after `openRequest`" in the
  integrator.** Instead: the integrator RETURNS the opened PR `url` back UP
  (`IntegrateWithRebaseResult` → `complete.ts`'s `result.url`, exposed as `prUrl`).
  Post the comment FROM `complete.ts`, AFTER integrate returns, on the propose
  path, where BOTH `lastVerdict` AND `result.url` are in scope. Order: gate →
  `lastVerdict` → integrate (opens PR, returns `url`) → (in `complete.ts`)
  `postComment(url, <verbatim review output, JSON block stripped>)`. If `result.url`
  is absent (degraded / no PR — e.g. local `--bare` arbiter), no-op (verdict stays in the run
  output; no throw).

### Where it wires in (verified: in `complete.ts`, post-integrate — NOT the integrator)

The Gate-2 verdict (`lastVerdict`) is produced in `performComplete`
(`src/complete.ts`, the `review` block). The propose integrate call returns the
opened PR `url` (`result.url` / `prUrl`) back into `complete.ts` — THAT is the
wiring point: after a successful propose integrate, if a review ran and
`result.url` is present, `postComment` the review to that PR. `postComment` is a NEW
method on the provider seam (so the core still never imports `gh`); the GitHub
adapter shells out to `gh pr comment`.

**Post the agent's VERBATIM review, NOT a re-formatted verdict (resolved 2026-06-06
— see `work/findings/review-nonblocking-findings-disposition.md`).** The review
agent's output (`LaunchResult.output`, captured by `harness-agent-output`) is rich
prose — the ordered lenses, the destination-check narrative, AND the
`{verdict,findings}` JSON at the end. Re-formatting from the parsed JSON would THROW
AWAY the reasoning (the most useful part) and silently drop non-blocking findings.
So post the **verbatim `output`**, which AUTOMATICALLY includes the nits + the
reasoning — richer, and LESS code (no `formatVerdict`/`formatBlockReason` formatter
to write for the comment). **Strip only the trailing `{verdict,findings}` JSON
block** before posting (the runner already locates that JSON to parse the verdict,
so it knows where it starts — trimming it is near-free; a raw JSON blob in a PR
comment is noise). The runner STILL parses the verdict for its ROUTING decision
(approve→integrate / block→needs-attention) — unchanged; the verbatim text is ONLY
for the comment. The COMMENT is advisory — it gates nothing; pure visibility.

### Scope fence

- IN: a `postComment` method on the provider seam (GitHub via `gh pr comment`; none
  degrades); formatting the verdict (approve-with-nits AND block) into a comment;
  wiring it in `complete.ts` AFTER integrate returns (post-integrate, propose
  path), threading the PR url from `result.url`;
  posting on approve (the decided behaviour).
- OUT: the creation BODY (that is `propose-pr-body`, this slice's dep); changing the
  gate's verdict/routing logic (#11/#12 — unchanged; this only ADDS posting);
  auto-merge behaviour; the slicer edit loop. Block-routing still goes to
  needs-attention (a blocked item opens no PR on the propose path — the comment is
  for the PR that DID open).

## Acceptance criteria

- [ ] `ReviewProvider` gains `postComment(input)`; the GitHub provider posts via
      `gh pr comment` (or `gh api`) to the opened PR; the `none` provider degrades
      (surfaces the verdict in run output, never throws).
- [ ] On a `--propose` run with `review` on and an APPROVE verdict, the agent's
      VERBATIM review output (with the trailing `{verdict,findings}` JSON block
      stripped) is posted as a comment on the PR that `openRequest` opened — so the
      nits + reasoning are included automatically. PR identity comes from
      `openRequest`'s returned url/number.
- [ ] The posted text is the captured `LaunchResult.output`, NOT a re-formatted
      verdict (no `formatVerdict` for the comment); only the trailing JSON block is
      removed. A test asserts the comment contains the review prose and NOT the raw
      JSON.
- [ ] If `openRequest` degraded (no PR opened), `postComment` is a clean no-op (the
      review stays in the run output) — no throw, no lost work.
- [ ] The comment is advisory only: it changes no gate/verdict/merge/integration
      logic (assert the gate decision is identical with and without the comment).
- [ ] The runner still PARSES the verdict for routing (approve→integrate /
      block→needs-attention) — unchanged; the verbatim text is used ONLY for the
      comment.
- [ ] Consistent with `propose-pr-body` on the same seam (one provider, same
      degradation discipline; body-at-open vs comment-after are separate).
- [ ] Tests (stubbed provider, no real `gh`/network): approve → `postComment`
      called with the verbatim review text (JSON block stripped) + the right PR identity; degraded provider
      → no-op; the GitHub adapter builds the right `gh` args; the gate decision is
      unchanged by commenting.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `propose-pr-body` — SHARED provider seam ("write text to the PR"). That slice
  establishes the body-at-open half + the seam consistency; this adds the
  comment-after half. Serialised so both shape the provider seam coherently (and to
  avoid two slices editing `src/integrator.ts` + `src/github.ts` in parallel).
- (Builds ON the merged Gate-2 work, #11/#12 — the verdict it posts; that is on
  `main`, so it is a foundation, not a pending dep.)

## Prompt

> Make the Gate-2 review VISIBLE on the PR: post the agent's VERBATIM review as a PR
> COMMENT on the `--propose` path, INCLUDING on approve (decided 2026-06-06 — the
> comment is the audit trail; verbatim auto-includes the non-blocking nits + the
> reasoning). Today the verdict only hits the terminal `note(...)` / the
> needs-attention body; nothing reaches the PR.
>
> FIRST run the drift check: confirm `src/integrator.ts` `ReviewProvider` has
> `openRequest` returning `OpenRequestResult.url` (the PR identity you thread into
> the comment); confirm `src/github.ts` opens the PR via `gh pr create` (you add a
> sibling `gh pr comment`); confirm `src/complete.ts`'s `review` block produces
> `lastVerdict`; confirm the propose integrate call RETURNS the PR `url` back into
> `complete.ts` as `result.url`/`prUrl` (the integrator's `openRequest` is two
> layers down — do NOT wire there); confirm `propose-pr-body`
> (your dep) landed the `body`-on-`OpenRequestInput` seam shape you build alongside.
> Route to needs-attention on any real discrepancy.
>
> Implement: add `postComment(input)` to `ReviewProvider` (GitHub: `gh pr comment
> <pr> --body <text>` / `gh api`; none: degrade — surface in run output, never
> throw, ADR §6). In `complete.ts`, AFTER the propose integrate returns (where both
> `lastVerdict` and `result.url` are in scope — NOT in the integrator), if a review
> ran and a PR url is present, post the AGENT'S VERBATIM review output
> (`LaunchResult.output`) with the trailing `{verdict,findings}` JSON block STRIPPED
> — NOT a re-formatted verdict (do NOT write a `formatVerdict`; verbatim auto-
> includes the nits + reasoning and is less code). The runner already locates the
> JSON to parse the verdict, so trimming it is near-free. `postComment` it to the
> opened PR (thread the url from `openRequest`). The runner STILL parses the verdict
> for ROUTING (unchanged). If no PR opened (degraded), no-op. The comment is
> ADVISORY — it must change no gate/verdict/merge
> logic.
>
> READ FIRST: `work/prd/review.md` RESOLVED DESIGN (Gate 2 "more visible — posted as
> a PR comment"); `src/integrator.ts` (`ReviewProvider`, `OpenRequestResult.url`);
> `src/github.ts` (`gh pr create` → add `gh pr comment`); `src/complete.ts` (the
> `review` block, `lastVerdict`, `result.url`); `src/review-gate.ts`
> (`LaunchResult.output` carries the verbatim review; the JSON-extraction logic
> already there tells you where the trailing JSON block starts, so you can strip it)
> (`ReviewVerdict`/`formatBlockReason` to reuse); `work/backlog/propose-pr-body.md`
> (the shared seam — body-at-open; keep consistent); ADR §6 (provider seam +
> graceful degradation).
>
> TDD with vitest, house style (stubbed provider, no real gh/network): approve →
> postComment with the verbatim review (JSON stripped) + right PR identity; the
> comment contains the review prose, NOT the raw JSON; degraded provider →
> no-op; gh adapter builds the right args; the gate decision is unchanged by
> commenting. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim review-gate-pr-comment --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/review-gate-pr-comment <remote>/main
git mv work/in-progress/review-gate-pr-comment.md work/done/review-gate-pr-comment.md
```
