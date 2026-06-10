---
title: the review-edit loop's "ONE agent reviews-and-edits in a SINGLE context" (N) is an UNBUILT ASPIRATION — prd/review.md §Shape 2 is internally contradictory (single-context headline vs "apply edits to the slice FILES / each pass sees the edited slices" operative spec), and the ONLY built loop (slicer-review-loop.ts) is runner-driven PER-PASS launches + DISK accumulation
date: 2026-06-10
slug: review-edit-loop-single-context-is-unbuilt-aspiration-vs-per-pass-disk-impl
---

## The finding (verified against the code, not the prose)

`work/prd/review.md` §"Shape 2" (resolved Q1) and the `slicer-review-edit-loop` slice both describe the review-edit loop's **N axis** as:

> "**ONE agent reviews-and-EDITS in a SINGLE context** (the N in-context multipass, accumulating across angle-switched passes)."

That headline implies: ONE agent launch, looping internally, accumulating findings in its own working memory. **That is NOT what is built, and the PRD's own operative wording does not actually ask for it.**

What is BUILT (`packages/agent-runner/src/slicer-review-loop.ts`, `runSliceReviewLoop` → `runOneExecution`):

- `runOneExecution` has `for (let pass = 1; pass <= slicerLoopMax; pass++)` — the runner drives the N loop.
- Each pass calls `gate(...)` ONCE — in production (`harnessSliceReviewGate`) that is ONE fresh agent launch per pass (a distinct `LaunchInput`).
- Between passes the RUNNER writes the agent's edits to DISK (`applyEdits(cwd, verdict.edits, …)` under `work/backlog/`); the next pass's agent re-reads the edited slice FILES.
- So accumulation is via **disk + re-launch**, NOT via one agent's retained context. The "single context" never exists at runtime — every pass is its own launch.

## Why the confusion is the PRD's fault (it is internally contradictory)

`prd/review.md` §Shape 2 / the slice say "single context" in the **headline**, but the **operative** instructions in the very same section (and the slice's acceptance criteria + prompt) say the opposite:

- "apply the resulting edits to the candidate slice **FILES**, then re-review"
- "Passes accumulate (each sees prior findings + **the edited slices**)" — i.e. sees the edited FILES, not in-memory state
- slice AC: "APPLIES its edits to the candidate slice **files**, and re-reviews"
- slice prompt: "apply edits to the candidate slice **files**, re-review"

"Single context" (in-memory, one launch) and "apply edits to the files / each pass sees the edited slices" (disk, re-launch) are INCOMPATIBLE. The build agent resolved the contradiction toward the **operative** reading (files + per-pass), which is what every instruction except the headline demanded — so the build is faithful to the criteria. The "single context" HEADLINE is the part that was never built.

## Why this matters (it is the ROOT CAUSE of a multi-artifact tangle)

Three artifacts inherited this ambiguity and drifted from it:

1. `prd/review.md` — contradictory ("single context" vs "edit the files").
2. `work/done/slicer-review-edit-loop.md` — copied the contradiction; built the per-pass + disk reading.
3. `intake-lone-slice-bounded-internal-review` (PR #62) — built a per-ROUND-launch loop with **in-memory** accumulation (in-memory is CORRECT for intake: it has not emitted the slice yet, so it must not write to `work/backlog/` pre-convergence). PR #62 is thus the MOST coherent reading for its context — it matches the only built precedent's STRUCTURE (per-pass launches) and adapts the accumulator to intake's no-pre-emit-disk constraint.

It also caused a live review tangle (2026-06-10): a corrective slice (`intake-lone-slice-review-single-context-loop`) was authored on the premise "PR #62 inverted the canonical single-context model — fix it to one in-context launch." That premise is FALSE: the single-context model is unbuilt, so PR #62 inverts nothing. The corrective slice is now `humanOnly: true` (parked) pending a human decision, not deleted (we may want to revisit it).

## The actual open question (for a human; do NOT let an agent guess it)

Do we WANT a truly single-launch in-context review-edit loop (the unbuilt aspiration), or is the runner-driven per-pass + accumulation model (disk for the slicer; in-memory for intake) the intended end state? Two sub-decisions:

- **Reconcile `prd/review.md` §Shape 2**: either (a) rewrite the headline to match what is built + intended (per-pass launches; accumulation via disk/in-memory per context), OR (b) keep "single context" as a deliberate future target and mark the built loop as the pre-target form. Pick one; the current contradictory text must not stand.
- **For intake specifically**: confirm PR #62's per-round-launch + in-memory shape is the accepted end state (it is ACCEPTED as of 2026-06-10), so the parked corrective slice stays parked unless the model decision reopens it.

## Where this is documented in place (so the next reader sees it where they look)

- `work/prd/review.md` §Shape 2 — an inline ASPIRATION-VS-BUILT note next to the "single context" line.
- `packages/agent-runner/src/slicer-review-loop.ts` — a docstring note on the N axis (the runtime is per-pass launches + disk, NOT single-context).
- `work/done/slicer-review-edit-loop.md` — a note that the built loop is per-pass + disk despite the "single context" framing.
- `work/backlog/intake-lone-slice-review-single-context-loop.md` — the parked corrective slice's human-only banner points here.

## Provenance

Spotted 2026-06-10 during a post-merge review of PR #62 with the maintainer, after reading `slicer-review-loop.ts`'s actual `for (pass …)` driver (not just its type defs). Verified by reading `runOneExecution` (the per-pass `gate()` call + `applyEdits` to disk) against `prd/review.md` §Shape 2's "single context" headline. Maintainer reaction: "so prd/review.md was mis-implemented" — refined here to: the PRD was internally contradictory and the build followed its operative (not headline) reading; the single-context loop is unbuilt.
