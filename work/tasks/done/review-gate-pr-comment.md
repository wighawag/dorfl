---
title: review-gate-pr-comment — post the agent's VERBATIM Gate-2 review (incl. on approve) as a PR comment via a provider postComment seam
slug: review-gate-pr-comment
prd: review
blockedBy: []
covers: [3]
---

> **DRIFT UPDATE 2026-06-07 — re-reviewed against merged code. TWO changes:**
>
> 1. **`blockedBy` cleared:** `propose-pr-body` (the shared-seam dep) is MERGED (PR #15) — the `body`-on-`OpenRequestInput` seam is already on `main`, so it is a FOUNDATION, not a pending dep. `[propose-pr-body]` → `[]`.
> 2. **Wiring point MOVED:** the run/do convergence (PR #17/#18) moved the review/approve block + the integrate call out of `complete.ts` into `src/integration-core.ts` (`performIntegration`), shared by `do` AND `run`. The verdict (`lastVerdict`) is now produced INSIDE the core and is NOT returned (`IntegrationCoreResult` exposes only outcome/branch/reason/commitMessage/ integration — no verdict, no agent output). So the slice's old plan ("post from `complete.ts` after integrate, where `lastVerdict` + `result.url` are both in scope") NO LONGER WORKS — neither is in scope in `complete.ts` anymore. **RESOLVED (Option A): post the comment INSIDE `performIntegration`**, after the integrate, where `lastVerdict`, the resolved `provider`, AND `integration.url` are all in scope. This is clean (the core already resolves the provider) and parallels `review-nits-observation` (both use the verbatim review at the same in-core approve point), and it covers `do` AND `run` for free. The alternative (expose the verdict+output on `IntegrationCoreResult` and post from each tail) was REJECTED: it re-introduces the per-caller duplication the convergence just removed.

## What to build

Make the **PR/code review gate's verdict VISIBLE on the PR** by posting it as a PR comment, on the `--propose` path. Today (Gate 2, PRs #11/#12) the review runs and its verdict goes to the terminal `note(...)` (approve) or the needs-attention item body (block) — but **nothing is posted to the PR**, so a human landing on the proposed PR sees no review reasoning. This slice closes that (the `review` PRD's "Gate 2 is more VISIBLE — posted AS a PR review/comment" property).

**Decided (maintainer, 2026-06-06): post the verdict INCLUDING on APPROVE** — an approve comment is the audit trail ("the gate approved, here is why / the findings it weighed"), not just blocks/nits. (A `block` never opens a PR — it routes to needs-attention — so on the `--propose` path the comment is realistically the approve verdict + any non-blocking nits. If a future path opens a PR despite a block, the same comment mechanism posts the blocking findings.)

### The provider comment seam (SHARED surface with `propose-pr-body`)

Both this slice and `propose-pr-body` add a "write text to the PR" capability to the provider seam (`src/integrator.ts` `ReviewProvider`). They are DISTINCT operations on the SAME seam — keep them consistent (one provider, same graceful-degradation discipline), do NOT build two parallel posting mechanisms:

- `propose-pr-body` (its `blockedBy`) adds the **creation BODY** (`--body` at `gh pr create`).
- THIS slice adds a **follow-up COMMENT on the already-opened PR**: a new `postComment(input)` method on `ReviewProvider`. The GitHub provider implements it via `gh pr comment <pr> --body <text>` (or `gh api`); the `none` provider degrades (no API → surface the verdict in the run output / instruction, never throw — ADR §6, like `openRequest`).
- **PR identity — and the CORRECT wiring LAYER (re-verified 2026-06-07, post-convergence):** the review VERDICT (`lastVerdict`) is produced INSIDE `performIntegration` (`src/integration-core.ts`) — NOT `complete.ts` anymore. The integrate (which opens the PR and yields `integration.url`) ALSO happens inside the core, right after the review block. So `lastVerdict`, the resolved `provider`, and `integration.url` are ALL in scope in the core, after integrate. **Post the comment THERE (Option A), inside `performIntegration` after the integrate**, on the propose path. Order (all in the core): gate → review (`lastVerdict`) → done-move/commit/rebase → integrate (opens PR, yields `integration.url`) → `postComment(url, <verbatim review output, JSON block stripped>)`. If the url is absent (degraded / no PR — e.g. local `--bare` arbiter, or `merge` mode), no-op (verdict stays in the run output; no throw). Do NOT expose the verdict on `IntegrationCoreResult` to post from the tails — that re-introduces per-caller duplication; post in the one shared place.

### Where it wires in (post-convergence: INSIDE `performIntegration`, post-integrate)

The Gate-2 verdict (`lastVerdict`) is produced inside `performIntegration` (`src/integration-core.ts`, the `review` block), and the propose integrate runs in the same function and yields the opened PR `url` (`integration.url`). THAT is the wiring point: after a successful propose integrate, if a review ran and the url is present, `postComment` the review to that PR — using the `provider` the core already resolved for the integrate. `postComment` is a NEW method on the provider seam (so the core still never imports `gh`); the GitHub adapter shells out to `gh pr comment`. Because this is in the shared core, BOTH `do`/`complete` AND `run` post the comment — no per-caller wiring.

**Post the agent's VERBATIM review, NOT a re-formatted verdict (resolved 2026-06-06 — see `work/findings/review-nonblocking-findings-disposition.md`).** The review agent's output (`LaunchResult.output`, captured by `harness-agent-output`) is rich prose — the ordered lenses, the destination-check narrative, AND the `{verdict,findings}` JSON at the end. Re-formatting from the parsed JSON would THROW AWAY the reasoning (the most useful part) and silently drop non-blocking findings. So post the **verbatim `output`**, which AUTOMATICALLY includes the nits + the reasoning — richer, and LESS code (no `formatVerdict`/`formatBlockReason` formatter to write for the comment). **Strip only the trailing `{verdict,findings}` JSON block** before posting (the runner already locates that JSON to parse the verdict, so it knows where it starts — trimming it is near-free; a raw JSON blob in a PR comment is noise). The runner STILL parses the verdict for its ROUTING decision (approve→integrate / block→needs-attention) — unchanged; the verbatim text is ONLY for the comment. The COMMENT is advisory — it gates nothing; pure visibility.

### Scope fence

- IN: a `postComment` method on the provider seam (GitHub via `gh pr comment`; none degrades); posting the VERBATIM review (JSON block stripped) as a comment; wiring it INSIDE `performIntegration` (`src/integration-core.ts`) AFTER the integrate, on the propose path, using the resolved `provider` + `integration.url`; posting on approve (the decided behaviour); covers `do` AND `run` (shared core).
- OUT: the creation BODY (that is `propose-pr-body`, this slice's dep); changing the gate's verdict/routing logic (#11/#12 — unchanged; this only ADDS posting); auto-merge behaviour; the slicer edit loop. Block-routing still goes to needs-attention (a blocked item opens no PR on the propose path — the comment is for the PR that DID open).

## Acceptance criteria

- [ ] `ReviewProvider` gains `postComment(input)`; the GitHub provider posts via `gh pr comment` (or `gh api`) to the opened PR; the `none` provider degrades (surfaces the verdict in run output, never throws).
- [ ] On a `--propose` run with `review` on and an APPROVE verdict, the agent's VERBATIM review output (with the trailing `{verdict,findings}` JSON block stripped) is posted as a comment on the PR that `openRequest` opened — so the nits + reasoning are included automatically. PR identity comes from `openRequest`'s returned url/number.
- [ ] The posted text is the captured `LaunchResult.output`, NOT a re-formatted verdict (no `formatVerdict` for the comment); only the trailing JSON block is removed. A test asserts the comment contains the review prose and NOT the raw JSON.
- [ ] If `openRequest` degraded (no PR opened), `postComment` is a clean no-op (the review stays in the run output) — no throw, no lost work.
- [ ] The comment is advisory only: it changes no gate/verdict/merge/integration logic (assert the gate decision is identical with and without the comment).
- [ ] The runner still PARSES the verdict for routing (approve→integrate / block→needs-attention) — unchanged; the verbatim text is used ONLY for the comment.
- [ ] Consistent with `propose-pr-body` on the same seam (one provider, same degradation discipline; body-at-open vs comment-after are separate).
- [ ] Tests (stubbed provider, no real `gh`/network): approve → `postComment` called with the verbatim review text (JSON block stripped) + the right PR identity; degraded provider → no-op; the GitHub adapter builds the right `gh` args; the gate decision is unchanged by commenting.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None (cleared 2026-06-07). `propose-pr-body` (the shared "write text to the PR" seam) is MERGED (PR #15) — the `body`-on-`OpenRequestInput` half + the seam consistency are on `main`; this slice adds the sibling `postComment` half on the SAME seam, keeping the same graceful-degradation discipline. Also builds ON the merged Gate-2 work (#11/#12) and the run/do convergence (#17/#18, which moved the verdict into `integration-core.ts`). All foundations, not pending deps.

## Prompt

> Make the Gate-2 review VISIBLE on the PR: post the agent's VERBATIM review as a PR COMMENT on the `--propose` path, INCLUDING on approve (decided 2026-06-06 — the comment is the audit trail; verbatim auto-includes the non-blocking nits + the reasoning). Today the verdict only hits the terminal `note(...)` / the needs-attention body; nothing reaches the PR.
>
> FIRST run the drift check (the layer MOVED in the run/do convergence — #17/#18): confirm `src/integration-core.ts` `performIntegration` is now where the `review` block produces `lastVerdict` AND where the integrate runs (yielding the PR url via `integration.url`) — NOT `complete.ts`; confirm the core RESOLVES a `provider` instance for the integrate (you reuse it for `postComment`); confirm `src/integrator.ts` `ReviewProvider`'s `openRequest` returns `OpenRequestResult.url`; confirm `src/github.ts` opens via `gh pr create` (you add a sibling `gh pr comment`); confirm `propose-pr-body` (MERGED, #15) landed the `body`-on-`OpenRequestInput` seam you extend. Route to needs-attention on any real discrepancy.
>
> Implement: add `postComment(input)` to `ReviewProvider` (GitHub: `gh pr comment <pr> --body <text>` / `gh api`; none: degrade — surface in run output, never throw, ADR §6). INSIDE `performIntegration` (`src/integration-core.ts`), AFTER the propose integrate (where `lastVerdict`, the resolved `provider`, and the PR url are all in scope), if a review ran and a PR url is present, post the AGENT'S VERBATIM review output (`LaunchResult.output`) with the trailing `{verdict,findings}` JSON block STRIPPED — NOT a re-formatted verdict (do NOT write a `formatVerdict`; verbatim auto- includes the nits + reasoning and is less code). The runner already locates the JSON to parse the verdict, so trimming it is near-free. `postComment` it to the opened PR (thread the url from `openRequest`). The runner STILL parses the verdict for ROUTING (unchanged). If no PR opened (degraded), no-op. The comment is ADVISORY — it must change no gate/verdict/merge logic.
>
> READ FIRST: `work/prd/review.md` RESOLVED DESIGN (Gate 2 "more visible — posted as a PR comment"); `src/integration-core.ts` (`performIntegration` — the `review` block / `lastVerdict`, the integrate + resolved `provider` + `integration.url`; THIS is the wiring point, shared by `do` AND `run`); `src/integrator.ts` (`ReviewProvider`, `OpenRequestResult.url` — add `postComment`); `src/github.ts` (`gh pr create` → add `gh pr comment`); `src/review-gate.ts` (`LaunchResult.output` carries the verbatim review; the JSON-extraction logic already there tells you where the trailing JSON block starts, so you can strip it); `work/done/propose-pr-body.md` (the shared seam — body-at-open, MERGED; keep consistent); `work/backlog/review-nits-observation.md` (the sibling that also uses the verbatim review at the same in-core approve point — keep them coherent); ADR §6 (provider seam + graceful degradation).
>
> TDD with vitest, house style (stubbed provider, no real gh/network): approve → postComment with the verbatim review (JSON stripped) + right PR identity; the comment contains the review prose, NOT the raw JSON; degraded provider → no-op; gh adapter builds the right args; the gate decision is unchanged by commenting. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim review-gate-pr-comment --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/review-gate-pr-comment <remote>/main
git mv work/in-progress/review-gate-pr-comment.md work/done/review-gate-pr-comment.md
```
