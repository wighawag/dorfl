---
title: intake's lone-SLICE outcome emits a one-shot, UN-reviewed slice — the PRD path gets the slicer review→edit loop, the issue-thread→slice path gets nothing; fix is a bounded internal review PROMPT (not slicer-loop integration), non-converge → ASK carrying the draft
date: 2026-06-10
slug: intake-lone-slice-skips-adversarial-review-the-prd-path-gets
---

## What was spotted

A slice born from an issue thread gets STRICTLY WEAKER scrutiny than one born from a PRD.

- `do prd:<slug>` runs `runSliceReviewLoop` (`src/slicer-review-loop.ts`): an adversarial fresh-context `review`-skill pass that proposes edits, applies them, and re-reviews until it converges or routes to a non-converge sink (`uncertain-slices` → `needsAnswers` on a slice; `decomposition-unclear` → PRD → needs-attention). It is OPTIONAL there (`--slicer-loop`/`--no-slicer-loop`) because the one-shot slicer is already trusted.
- `intake`'s lone-SLICE outcome (`dispatchSlice`, `src/intake.ts`) runs the decision prompt ONCE, emits one `work/backlog/<slug>.md`, and integrates. NO review-edit pass at all.

So the artifact whose SOURCE was a fuzzy, unreviewed human thread — the one that arguably needs adversarial refinement MOST — is the one that gets NONE. (The intake PRD outcome is already covered: it is sliced later by `do prd:`, which runs the loop. The gap is **lone-SLICE only**.)

Surfaced live (2026-06-10) while reviewing the just-landed intake slices (#57–#60), in conversation with the maintainer.

## Why it matters

- **Review asymmetry by accident.** In our recent slicing sessions the per-slice adversarial review was consistently useful — the maintainer "almost always just said yes" to each proposed fix. Intake's lone-slice path silently skips that value.
- **The honest diagnosis of WHY it was missed:** the slicer loop was conceived as a SET-level decomposition reviewer (graph coherence, gaps, overlap, "does the SET compose into the PRD goal" — see `buildSliceReviewPrompt`'s "reviewing the WHOLE SET, not just per-slice"). A lone slice is N=1: no set, no graph. So the loop's HEADLINE lenses no-op on a single slice, which is exactly what made "the loop applies here" feel false. That instinct is half-right (the SET part doesn't apply) and half-wrong (the per-slice well-formedness + DESTINATION CHECK absolutely do).

## The design conclusion: a PROMPT, not slicer-loop integration

Reusing `runSliceReviewLoop` for the lone-slice case is a COSTUME, not integration. To make it fit you must defeat every load-bearing part of it:

1. it reads its source off disk (`Read the source PRD work/prd/<slug>.md`) — intake would need a SYNTHETIC-SOURCE seam (the thread is not a PRD file);
2. its prompt reviews the WHOLE SET — you'd need an N=1 branch that turns OFF the part that is the loop's whole point;
3. its non-converge sinks (`needsAnswers`-on-a-slice, PRD→needs-attention) DO NOT EXIST for intake — you'd re-map BOTH to ASK;
4. it persists candidate files to `work/backlog/` and edits them across passes — but intake hasn't emitted yet, so you'd write-then-maybe-unwrite pre-emit disk state.

After overrides 1–4 the only reuse left is the pass counter + verdict parser (~tens of lines). So: do NOT integrate the slicer loop. Add a small intake-native step.

**The shape (a prompt + a bounded control-flow change in `dispatchSlice`):**

- AFTER the decision prompt says SLICE, run a BOUNDED internal adversarial self-review on the SINGLE drafted slice: propose a fix → apply → re-review.
- **Cap = 3 rounds, HARD-CODED** (maintainer ruling — no config). Bounds oscillation/flip-flop the way `slicerLoopMax` bounds the slicer loop.
- **Converge** (a round finds no new blocking issue) → emit the IMPROVED slice + post the completion comment (the existing slice-4 path).
- **Non-converge** (a round surfaces a question with NO clear answer in the thread, OR the 3-round cap is hit with an open question) → the verdict FLIPS to **ASK**. The ASK comment carries BOTH (a) the proposed slice DRAFT and (b) the open question(s) that arose — so the human reacts to a concrete draft ("yes, yes, but…"), strictly richer than today's blank-question ASK. NEVER silently emit the under-refined slice.

## Why a prompt is sufficient (and the loop is not needed)

The maintainer's key insight: **the issue thread IS the outer review loop, and the human is the corrector.** Internal iteration only needs to REFINE a slice the agent already judged buildable; the moment a question has no clear thread answer, bouncing to the human (ASK) is better than another fresh-context pass. So intake doesn't need multi-context self-correction with `needsAnswers` sinks — it needs "tighten the draft a few rounds, else ask the human, carrying the draft." A prompt does that.

## Maintainer rulings (2026-06-10 — these are settled)

- **A — cap:** hard-code 3 rounds. No need for a configurable cap.
- **B — optionality:** NONE. Not optional, not configurable at this stage. Always on, fixed depth. (Deliberately different from `do prd:`'s on/off: intake's one-shot decision is the UNDER-reviewed thing, so the refinement is pure upside you would never switch off — unlike the already-trusted slicer.)
- **C — marker:** the non-converge ASK reuses `kind=ask` (it is non-terminal/resume-able in triage terms); the slice DRAFT rides in the comment BODY, NOT a new marker kind. So this touches ZERO of the marker/triage machinery from `intake-self-awareness-resumption-tracking` — the triage gate already covers resume for free.

## Scope fence (for whoever promotes this to a slice)

- **Lone-SLICE outcome ONLY.** Do NOT touch the PRD outcome (covered downstream by `do prd:`'s loop), ASK, or BOUNCE.
- Do NOT integrate / call `runSliceReviewLoop`; do NOT add a synthetic-source seam, an N=1 loop mode, or a new non-converge outcome.
- No new `IntakeRunOutcome`, no new marker kind, no config flag, no `--slicer-loop`-style knob.
- The non-converge path is the EXISTING `asked` outcome (verdict flips SLICE→ASK), with the draft + question(s) in the comment body. The next intake run resumes via the already-built triage gate.

## Status

Captured for promotion to a slice (lone-slice-internal-review). The design is settled (prompt not loop; 3-round hard cap; non-optional; ASK-with-draft on non-converge; lone-slice-only) — only the slice authoring + the exact prompt wording remain. Not authored here.
