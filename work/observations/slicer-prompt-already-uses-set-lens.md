---
title: slicing-coherence US #3 (slicer improver prompt lacks a whole-SET lens) is largely ALREADY satisfied — buildSliceReviewPrompt already invokes the review skill's set/decomposition lens + destination check
type: observation
status: spotted
spotted: 2026-06-08
---

# US #3's premise has drifted: the set lens is already in the prompt

Spotted while slicing `work/prd/slicing-coherence.md` (2026-06-08), doing the to-slices drift check against the code.

## The PRD's premise (US #3 + Problem #2)

The PRD says the slicer improver loop's prompt "reviews slices WITHOUT a whole-SET lens (graph coherence, gaps, overlap, 'does the set compose into the PRD goal')" and asks to FIX the prompt to invoke the `review` skill's set-of-slices mode.

## What the code actually does NOW

`src/slicer-review-loop.ts` `buildSliceReviewPrompt()` (landed via the `slicer-review-edit-loop` slice, in `done/`) ALREADY:

- frames the artifact as "the CANDIDATE SLICES just produced for the PRD" (the whole set, listed), and tells the agent to "review the candidate DECOMPOSITION adversarially";
- instructs "Apply the review skill's lenses IN ORDER, ENDING in the DESTINATION CHECK ('if every slice is built exactly as written, do we end up with the system the PRD describes?')";
- carries the two non-converge routing channels (`uncertainSlices`, `decompositionUnclear`) that are inherently set-level judgements.

So the "does the set compose into the PRD goal" lens + the destination check are PRESENT. The loop already reviews at the set level, not just per-slice well-formedness.

## Consequence for slicing

US #3 is NOT a from-scratch "add a set lens" job — it is at most a VERIFY + TIGHTEN: confirm the `review` skill's set-of-slices mode is named explicitly and that graph-coherence / gaps / overlap are each called out (the destination check implies them but may not name them). The slice emitted for US #3 (`slicer-loop-set-lens-prompt`) is therefore scoped narrowly and flags `needsAnswers` for the maintainer to confirm whether ANY prompt change is wanted at all, rather than guessing a rewrite of an already-correct prompt.

The other axes of the PRD (output-through-`performIntegration`, the acceptance gate, the `--slicer-loop*` flag rename, the `prd-sliced/` folder) are NOT drifted — they are genuinely unbuilt.
