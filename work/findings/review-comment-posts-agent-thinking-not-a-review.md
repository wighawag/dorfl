---
title: the Gate-2 PR comment posts the review agent's stream-of-consciousness (prompt says "JSON only", postComment wants prose) — RESOLVED fix: a `review` prose field INSIDE the verdict JSON; retire the verbatim-output/stripVerdictJson path
date: 2026-06-07
status: resolved
---

## The signal (observed on PR #20, the feature's debut)

PR #20 (`autoslice-gate`) is the FIRST PR to receive a Gate-2 review comment now that `review-gate-pr-comment` (PR #19) has landed. The posted comment is "a weird message" — it reads like the review agent THINKING OUT LOUD, not a review:

> "Let me check whether registering a CLI flag is in scope… Let me confirm the `categorise.ts`/`format.ts`/`scan.ts` consumers don't need… All four lenses pass. The diff: …"

It is the agent's running narration / chain-of-thought, not a clean reviewer's verdict + reasoning.

## Root cause — NOT a bug in postComment; a CONTRADICTION between two slices

The `postComment` code is working as built: it posts `LaunchResult.output` (the agent's final message) verbatim with ONLY the trailing `{verdict,findings}` JSON block stripped (`stripVerdictJson`). So it faithfully posts whatever prose the agent emitted AROUND the JSON.

The problem is what the agent emits, which is governed by the review PROMPT — and the prompt and the comment feature want OPPOSITE things:

- **`buildReviewPrompt` (`src/review-gate.ts`) says:** _"Output ONLY a single JSON object of this exact shape (no other prose)."_ It was written for a GATE that only needs to PARSE a verdict — JSON-only is correct + useful there (it STRUCTURES the output and makes parsing robust).
- **`review-gate-pr-comment` assumed:** the agent's output is "rich prose — the ordered lenses + the destination-check narrative" worth posting verbatim (JSON stripped). That premise CONTRADICTS the prompt: the prompt asks for no prose.
- **The agent split the difference:** it ignored "JSON only" and emitted informal stream-of-consciousness prose PLUS the JSON. `stripVerdictJson` removes the JSON, leaving the messy thinking — which is what got posted.

So the slice shipped against an assumption the prompt never reconciled. The fix is a PROMPT/CONTRACT change, not a `postComment` code change.

## The constraint we must NOT break (why "just ask for prose" is wrong)

Asking for a SINGLE JSON object is doing two useful jobs, and we want to keep both:

1. it carries the machine-readable VERDICT (`approve`/`block` + `findings[]`) the runner parses for ROUTING; and
2. it STRUCTURES the agent's output (a strict shape is easier to emit reliably + parse than free prose; it disciplines the agent).

Removing "JSON only" / adding "emit prose" instructions risks breaking BOTH — the parse robustness AND the structuring discipline. (We just SAW the failure mode of a loose contract: informal narration leaks out.)

## Fix DIRECTION (maintainer lean, 2026-06-07 — needs more thought before building)

Keep the structured JSON contract; add a PROSE field INSIDE it that is what gets posted. Sketch:

```json
{
  "verdict": "approve" | "block",
  "review": "<human-readable prose: a short title/heading conveying APPROVED/BLOCKED, then the lenses + destination-check reasoning, written FOR a human landing on the PR>",
  "findings": [ {"severity": "...", "question": "...", "context": "..."} ]
}
```

Then:

- the runner PARSES `verdict`/`findings` for routing (unchanged);
- the comment poster posts the `review` FIELD (not "the output minus the JSON") — so the comment is a deliberately-authored review, and `stripVerdictJson` / "post the verbatim output" can be RETIRED in favour of "post `verdict.review`";
- the agent still emits ONE structured JSON object (the parse + structuring discipline is preserved); its informal scratch-thinking is no longer the comment, because the comment is an explicit field it must write WELL.

This makes the comment a first-class authored artifact while keeping the JSON the single source of structure — the inverse of today (today the comment is the unstructured residue; the JSON is structured).

## Open questions — RESOLVED (maintainer, 2026-06-07)

1. **Does a `review` prose field re-introduce the prose-reliability problem?** **RESOLVED:** add GUIDANCE, but do NOT impose a length limit and do NOT force verbosity. The field should lead with the verdict (Approved/Blocked) and give the lenses + destination-check reasoning; length is whatever the review needs — neither capped nor padded for its own sake. ("Guidance should not hurt; length is fine either way.")
2. **Retire `stripVerdictJson` / the "post verbatim output" path?** **RESOLVED: RETIRE it.** Post `verdict.review` only — we ASSUME the `review` field is filled (the prompt requires it). No fallback to posting the raw final message minus JSON (that residue-posting is exactly the bug). The verbatim-output path + `stripVerdictJson` go away.
3. **`ReviewVerdict` shape change?** **RESOLVED: YES.** Add `review?: string` to the parsed verdict (`review-gate.ts` `validateVerdict`); the comment poster reads `verdict.review` instead of `verdict.output`. Confirmed (2026-06-07) that ONLY the comment poster reads `output` today — `output` was added BY the comment slice — so switching the poster + retiring `output`/`stripVerdictJson` touches nothing else.
4. **The `block` path?** **RESOLVED (conditional): YES, IF a block is still posted as a PR.** On the propose path a block routes to needs-attention and opens no PR, so there is normally nothing to comment on. But IF a block ever IS posted as a PR comment, post the `review` prose there too (consistent with approve). So the poster uses `verdict.review` regardless of verdict; whether a PR exists to receive it is the existing url-present gate.
5. **Issue 2 — what does the pi adapter actually put in `LaunchResult.output`?** **RESOLVED — CONFIRMED CLEAN; Issue 2 is NOT the cause.** `pi-harness.ts` `output: readLastAssistantText(sessionFile)` → `watch-session.ts` `lastAssistantText` → `assistantContentText`, which keeps ONLY `p.type === 'text'` parts and **explicitly DROPS `thinking`/reasoning and `toolCall` blocks**, taking the LAST assistant message with non-empty text. So `output` is already the clean final ANSWER, not hidden chain-of-thought. The PR #20 mess was the agent's actual FINAL ANSWER written as casual prose (because the prompt only asked for "JSON only"), not a capture artifact. This CONFIRMS the fix direction: since `output` is a clean final-message read, posting a deliberately-authored `review` FIELD (not "final message minus JSON") is exactly right — `output` capture itself needs NO attention.

## Disposition

- **SLICED 2026-06-07 → `work/backlog/review-comment-prose-field.md`** (all open questions resolved; decisions 1–5 above are baked into the slice). The design is settled: the `review`-field-in-the-JSON approach.
- **PRD-/slice-READY (all open questions resolved 2026-06-07).** The design is settled: the `review`-field-in-the-JSON approach, decisions 1–5 above.
- **The slice (when built):**
  - `buildReviewPrompt` (`review-gate.ts`): require a `review` PROSE field IN the JSON object (lead with Approved/Blocked + the lenses + destination-check reasoning; guidance, no length cap, no forced verbosity). Keep the single-JSON- object contract (it still carries `verdict`/`findings` + STRUCTURES the output).
  - `validateVerdict` / `ReviewVerdict`: add `review?: string`.
  - `integration-core.ts` step 6 (the comment poster): post `verdict.review` (regardless of verdict; the existing PR-url-present gate decides if there is a PR). **RETIRE** `stripVerdictJson` + the `output`-verbatim path + the `output` field's comment role (assume `review` is filled; no residue fallback).
  - Tests: a verdict carrying `review` posts that field; the comment is the authored prose, never the raw final message; the parse still reads `verdict`/`findings` for routing unchanged.
- Related: `work/findings/review-nonblocking-findings-disposition.md` (the verbatim- output / nits decisions this SUPERSEDES on the comment surface — the comment is now `verdict.review`, not the verbatim output).

(Captured 2026-06-07 from PR #20 — the first live Gate-2 comment after #19 landed.)
