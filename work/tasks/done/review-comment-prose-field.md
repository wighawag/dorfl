---
title: review-comment-prose-field — post a deliberately-authored `review` prose field FROM the verdict JSON (not the agent's stream-of-consciousness); retire the verbatim-output/stripVerdictJson path
slug: review-comment-prose-field
prd: review
blockedBy: []
covers: [3]
---

> **Why this exists (the bug it fixes):** `review-gate-pr-comment` (MERGED, PR #19) posts the review as a PR comment by taking `LaunchResult.output` (the agent's final message) verbatim and stripping only the trailing `{verdict,findings}` JSON (`stripVerdictJson`). On its DEBUT (PR #20) the posted comment was the review agent's casual STREAM-OF-CONSCIOUSNESS ("Let me check…", "All four lenses pass") — not a clean review. Root cause: `buildReviewPrompt` says _"Output ONLY a single JSON object … no other prose"_ (correct for a GATE that just parses a verdict), which DIRECTLY CONTRADICTS the comment slice's assumption that the output is "rich prose worth posting verbatim." The agent split the difference and emitted messy prose AROUND the JSON; stripping the JSON left the mess. Full analysis + all resolved decisions: `work/findings/review-comment-posts-agent-thinking-not-a-review.md`.

## What to build

Make the Gate-2 PR comment a **deliberately-authored review**, NOT the residue around the JSON, by carrying the review prose IN the verdict JSON as a `review` field and posting THAT. Keep the single-JSON-object contract intact (it still carries `verdict`/`findings` for routing AND structures the agent's output — that discipline is exactly what we must NOT lose by "asking for prose").

Concretely (all decisions RESOLVED 2026-06-07 — see the finding):

1. **Prompt (`buildReviewPrompt`, `src/review-gate.ts`):** require a **`review` PROSE field INSIDE the JSON object** — a human-readable review that LEADS WITH the verdict (Approved/Blocked) and gives the lenses + destination-check reasoning, written for a human landing on the PR. Keep "a single JSON object" (still the source of structure). Add GUIDANCE on the field's content, but **do NOT impose a length limit and do NOT force verbosity** — length is whatever the review needs, neither capped nor padded. The shape becomes:
   ```json
   {
     "verdict": "approve" | "block",
     "review": "<prose: lead with Approved/Blocked, then the lenses + destination-check reasoning>",
     "findings": [ {"severity": "...", "question": "...", "context": "..."} ]
   }
   ```
2. **Parsed verdict (`ReviewVerdict` + `validateVerdict`, `src/review-gate.ts`):** add `review?: string`. Routing still uses ONLY `verdict`/`findings` (unchanged).
3. **Comment poster (`src/integration-core.ts`, the step-6 block the comment slice added):** post **`verdict.review`** (regardless of verdict; the EXISTING PR-url-present gate decides whether there is a PR to comment on — so a block that is ever posted as a PR also gets its `review` prose; a propose-path block opens no PR and so no-ops as today). **RETIRE** the verbatim-output path: remove `stripVerdictJson`, remove the `output`-verbatim comment role, and drop the `ReviewVerdict.output` field's comment purpose. We ASSUME `review` is filled (the prompt requires it); there is NO fallback to posting "the final message minus JSON" (that residue-posting IS the bug).

> **`ReviewVerdict.output`:** confirmed (2026-06-07) that ONLY the comment poster reads `output` today (it was added BY the comment slice for exactly this). So switching the poster to `verdict.review` lets `output` + `stripVerdictJson` be removed cleanly — nothing else depends on them. (`harness-agent-output`'s `LaunchResult.output` STAYS — that is the harness channel `parseReviewVerdict` reads to GET the JSON in the first place; we are only retiring the SEPARATE `output`-on-`ReviewVerdict` field + the verbatim-comment path.)

## Why NOT "just ask the agent for prose" (the constraint)

The single-JSON-object contract does two jobs we keep BOTH of: it carries the machine verdict for routing, AND it STRUCTURES the agent's output (a strict shape is emitted + parsed reliably; it disciplines the agent). Loosening it to "emit prose" risks breaking both — and we SAW that failure mode on PR #20 (informal narration leaks out). Putting the prose in a FIELD keeps the structure and makes the comment a first-class authored artifact rather than the unstructured residue.

## Why the `output` capture itself needs NO change (confirmed)

`pi-harness.ts` sets `output: readLastAssistantText(sessionFile)` → `watch-session.ts` `assistantContentText`, which keeps ONLY `type:'text'` parts and **drops `thinking`/reasoning + `toolCall` blocks**, taking the LAST assistant message with non-empty text. So `output` is already the clean final ANSWER (not hidden chain-of-thought) — the PR #20 mess was the agent's actual final answer written casually, a PROMPT problem, not a capture problem. This is WHY the `review`-field approach is the right fix: we post an authored field, not the raw final message.

## Scope fence

- IN: the `review` field in the prompt's required JSON shape (with guidance, no length cap); `review?: string` on `ReviewVerdict`/`validateVerdict`; posting `verdict.review` from the step-6 comment poster; RETIRING `stripVerdictJson` + the `output`-verbatim comment path + the `ReviewVerdict.output` field.
- OUT: changing the gate's verdict/ROUTING logic (approve→integrate / block→needs-attention — unchanged; only the COMMENT source changes); the needs-attention BLOCK reason (`formatBlockReason` still re-formats from `findings[]` for the needs-attention body — only the PR COMMENT uses `review`); the provider `postComment` seam itself (unchanged — it still posts whatever text it is handed); `harness-agent-output`'s `LaunchResult.output` (stays — it carries the JSON the parser reads).

## Acceptance criteria

- [ ] `buildReviewPrompt` requires a `review` prose field inside the single JSON object, instructing the agent to lead with the verdict (Approved/Blocked) + the lenses/destination-check reasoning; it keeps the single-JSON-object contract and adds NO length limit / no forced verbosity.
- [ ] `ReviewVerdict` gains `review?: string`, populated by `validateVerdict`; `verdict`/`findings` routing is unchanged (a test asserts the same approve/block routing as before).
- [ ] The step-6 comment poster posts `verdict.review` (not the verbatim output-minus-JSON). A test asserts the posted comment IS the `review` prose and is NOT the agent's surrounding narration / raw final message.
- [ ] `stripVerdictJson`, the `output`-verbatim comment path, and the `ReviewVerdict.output` field are REMOVED (assume `review` is filled; no residue fallback). Build is green with them gone (confirming nothing else used them) — `LaunchResult.output` (the harness channel) STAYS.
- [ ] A block that IS posted as a PR comment posts its `review` prose too; a propose-path block (no PR opened) still no-ops (the existing PR-url gate).
- [ ] The comment remains ADVISORY: no gate/verdict/merge/integration logic changes (assert the integration outcome is identical with and without commenting).
- [ ] Tests (stubbed gate + stubbed provider, no real model/gh): a verdict carrying `review` posts that field; the comment contains the authored prose and NOT raw narration; routing is unchanged; degraded provider / no PR ⇒ clean no-op.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None. `review-gate-pr-comment` (the comment poster + the `output`/`stripVerdictJson` this REPLACES) is MERGED (PR #19), and `harness-agent-output` (the `LaunchResult.output` channel the parser reads) is MERGED — both foundations on `main`, not pending deps. This slice REFINES the merged comment's source.

## Prompt

> Fix the Gate-2 PR comment so it posts a deliberately-authored REVIEW, not the review agent's stream-of-consciousness. Today (`review-gate-pr-comment`, MERGED PR #19) the comment is `LaunchResult.output` with the trailing `{verdict,findings}` JSON stripped (`stripVerdictJson`) — and on PR #20 that posted the agent's casual thinking ("Let me check…", "All four lenses pass") because the review PROMPT says "JSON only, no prose," contradicting the comment slice's assumption of rich prose. Full analysis + all resolved decisions: `work/findings/review-comment-posts-agent-thinking-not-a-review.md` (READ IT FIRST — every design question is already resolved there).
>
> Implement (decisions are settled — do not relitigate): (1) `buildReviewPrompt` (`src/review-gate.ts`): require a `review` PROSE field INSIDE the single JSON object — lead with Approved/Blocked + the lenses/destination-check reasoning; guidance only, NO length cap, NO forced verbosity; keep the single-JSON-object contract (it still carries verdict/findings AND structures the output). (2) Add `review?: string` to `ReviewVerdict` + `validateVerdict`; routing still uses only `verdict`/`findings`. (3) `src/integration-core.ts` step-6 comment poster: post `verdict.review` (the existing PR-url-present gate decides if there is a PR); RETIRE `stripVerdictJson` + the `output`-verbatim comment path + the `ReviewVerdict.output` field (assume `review` is filled; no residue fallback). Confirmed only the comment poster reads `output`, so it removes cleanly; `LaunchResult.output` (the harness channel the parser reads to GET the JSON) STAYS. The comment is ADVISORY — change no gate/verdict/merge logic.
>
> READ FIRST: `work/findings/review-comment-posts-agent-thinking-not-a-review.md` (the resolved design); `work/done/review-gate-pr-comment.md` (what you are refining); `src/review-gate.ts` (`buildReviewPrompt`, `parseReviewVerdict`, `validateVerdict`, `stripVerdictJson` — to retire, and `ReviewVerdict`); `src/integration-core.ts` (the step-6 comment poster + how `verdict.output` is used today); `src/integrator.ts` + `src/github.ts` (the `postComment` seam — UNCHANGED, it just posts the text it is handed); `work/prd/review.md` (Gate 2 "more VISIBLE — posted as a PR comment/review", items 3).
>
> TDD with vitest, house style (stubbed gate carrying a `review` field, stubbed recording provider, no real model/gh): a verdict with `review` posts that field; the comment is the authored prose, NOT raw narration / the raw final message; routing unchanged; a block posted as a PR posts its `review`; degraded provider / no PR ⇒ clean no-op; build green with `stripVerdictJson`/`output`-field removed. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim review-comment-prose-field --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/review-comment-prose-field <remote>/main
git mv work/in-progress/review-comment-prose-field.md work/done/review-comment-prose-field.md
```
