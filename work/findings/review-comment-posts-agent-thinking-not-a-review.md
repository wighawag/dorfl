---
title: the Gate-2 PR comment posts the review agent's stream-of-consciousness (prompt says "JSON only", postComment wants prose) — fix direction: a structured `review` prose field INSIDE the verdict JSON
date: 2026-06-07
status: open
---

## The signal (observed on PR #20, the feature's debut)

PR #20 (`autoslice-gate`) is the FIRST PR to receive a Gate-2 review comment now
that `review-gate-pr-comment` (PR #19) has landed. The posted comment is "a weird
message" — it reads like the review agent THINKING OUT LOUD, not a review:

> "Let me check whether registering a CLI flag is in scope… Let me confirm the
> `categorise.ts`/`format.ts`/`scan.ts` consumers don't need… All four lenses
> pass. The diff: …"

It is the agent's running narration / chain-of-thought, not a clean reviewer's
verdict + reasoning.

## Root cause — NOT a bug in postComment; a CONTRADICTION between two slices

The `postComment` code is working as built: it posts `LaunchResult.output` (the
agent's final message) verbatim with ONLY the trailing `{verdict,findings}` JSON
block stripped (`stripVerdictJson`). So it faithfully posts whatever prose the
agent emitted AROUND the JSON.

The problem is what the agent emits, which is governed by the review PROMPT —
and the prompt and the comment feature want OPPOSITE things:

- **`buildReviewPrompt` (`src/review-gate.ts`) says:** *"Output ONLY a single JSON
  object of this exact shape (no other prose)."* It was written for a GATE that
  only needs to PARSE a verdict — JSON-only is correct + useful there (it
  STRUCTURES the output and makes parsing robust).
- **`review-gate-pr-comment` assumed:** the agent's output is "rich prose — the
  ordered lenses + the destination-check narrative" worth posting verbatim (JSON
  stripped). That premise CONTRADICTS the prompt: the prompt asks for no prose.
- **The agent split the difference:** it ignored "JSON only" and emitted informal
  stream-of-consciousness prose PLUS the JSON. `stripVerdictJson` removes the JSON,
  leaving the messy thinking — which is what got posted.

So the slice shipped against an assumption the prompt never reconciled. The fix is
a PROMPT/CONTRACT change, not a `postComment` code change.

## The constraint we must NOT break (why "just ask for prose" is wrong)

Asking for a SINGLE JSON object is doing two useful jobs, and we want to keep both:

1. it carries the machine-readable VERDICT (`approve`/`block` + `findings[]`) the
   runner parses for ROUTING; and
2. it STRUCTURES the agent's output (a strict shape is easier to emit reliably +
   parse than free prose; it disciplines the agent).

Removing "JSON only" / adding "emit prose" instructions risks breaking BOTH — the
parse robustness AND the structuring discipline. (We just SAW the failure mode of a
loose contract: informal narration leaks out.)

## Fix DIRECTION (maintainer lean, 2026-06-07 — needs more thought before building)

Keep the structured JSON contract; add a PROSE field INSIDE it that is what gets
posted. Sketch:

```json
{
  "verdict": "approve" | "block",
  "review": "<human-readable prose: a short title/heading conveying APPROVED/BLOCKED, then the lenses + destination-check reasoning, written FOR a human landing on the PR>",
  "findings": [ {"severity": "...", "question": "...", "context": "..."} ]
}
```

Then:
- the runner PARSES `verdict`/`findings` for routing (unchanged);
- the comment poster posts the `review` FIELD (not "the output minus the JSON") —
  so the comment is a deliberately-authored review, and `stripVerdictJson` /
  "post the verbatim output" can be RETIRED in favour of "post `verdict.review`";
- the agent still emits ONE structured JSON object (the parse + structuring
  discipline is preserved); its informal scratch-thinking is no longer the comment,
  because the comment is an explicit field it must write WELL.

This makes the comment a first-class authored artifact while keeping the JSON the
single source of structure — the inverse of today (today the comment is the
unstructured residue; the JSON is structured).

## Open questions (resolve before building — this is a DIRECTION, not a decision)

1. **Does adding a `review` prose field re-introduce the "agent writes prose"
   reliability problem we just hit?** A field is more constrained than free output
   (it is inside the JSON the agent already emits reliably), but it is still prose.
   Does it need length/shape guidance ("a few short paragraphs; lead with the
   verdict") to stay clean?
2. **`stripVerdictJson` + the "post verbatim output" path:** retire them entirely
   (post `verdict.review` only), or keep verbatim as a fallback when `review` is
   absent (older agents / a stub with no field)? Graceful-degradation discipline
   says: if `review` is missing, post nothing rather than the raw thinking? Or fall
   back? Decide.
3. **`ReviewVerdict` shape change:** add `review?: string` to the parsed verdict
   (`review-gate.ts` `validateVerdict`); the comment poster reads `verdict.review`
   instead of `verdict.output`. Does anything else rely on `output`? (Today only
   the comment poster does — `output` was added BY the comment slice.)
4. **The `block` path:** `review` prose could also improve the needs-attention
   reason (today `formatBlockReason` re-formats from `findings[]`). In scope, or
   keep that separate?
5. **Confirm Issue 2 (secondary):** is the pi adapter's `LaunchResult.output` even
   the clean "final assistant message", or does it include thinking/narration? If
   the latter, the verbatim approach was doubly doomed and the `review`-field
   approach side-steps it entirely (we post a field, not the raw message). Worth
   confirming so we know whether `output` capture itself needs attention.

## Disposition

- **Capture only (this file).** The maintainer wants the FIX to get more thought —
  the `review`-field direction above is the lean, not a settled design. Do NOT
  build yet.
- When it ripens: likely a small slice (amend `buildReviewPrompt` to require the
  `review` field; add `review?` to `ReviewVerdict`/`validateVerdict`; switch the
  comment poster to post `verdict.review`; decide the degradation + whether to
  retire `stripVerdictJson`). It touches the same `review-gate.ts` +
  `integration-core.ts` step-6 the comment slice did.
- Related: `work/findings/review-nonblocking-findings-disposition.md` (the verbatim-
  output / nits decisions this would partly supersede).

(Captured 2026-06-07 from PR #20 — the first live Gate-2 comment after #19 landed.)
