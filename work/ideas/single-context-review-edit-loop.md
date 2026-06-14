---
title: a truly SINGLE-CONTEXT review-edit loop (one agent launch looping internally, accumulating in its own context) - the original review-edit-loop idea, deferred when the first build implemented it as multiple fresh-context per-pass launches
slug: single-context-review-edit-loop
type: idea
status: incubating
---

# Single-context review-edit loop: one launch, internal multipass, in-context accumulation

## The original idea (this is what was first wanted)

The review-edit loop (`prd/review.md` Shape 2, the slicer + intake review-edit improver) was ORIGINALLY conceived as a **single-context** loop: ONE agent launch that runs its OWN bounded review -> edit -> re-review loop internally, accumulating findings + edits in its own working context across angle-switched passes, and emitting a terminal converged (or non-converged) result. The "single context" framing in `prd/review.md` Shape 2's headline is THAT idea.

## What actually got built (and why we kept it)

The first agent to build the loop implemented it as the OPERATIVE reading of the (internally contradictory) PRD instead: a **runner-driven PER-PASS loop** - one FRESH agent launch per pass, edits written to DISK between passes, the next pass's agent re-reading the edited slice files (`src/slicer-review-loop.ts` `runOneExecution`'s `for (pass ...)` + `applyEdits`). Intake's variant (`intake-lone-slice-bounded-internal-review`, PR #62) used per-ROUND launches with IN-MEMORY accumulation (in-memory is forced there: intake must not write `work/backlog/` pre-convergence).

We DECIDED to continue with the multiple-fresh-context per-pass model as the accepted end state (recorded 2026-06-10): it was the only built precedent's structure, it matched every operative instruction in the PRD except the headline, and it works. The corrective slice that tried to force intake back to single-context (`intake-lone-slice-review-single-context-loop`) was retired because its premise ("PR #62 inverted the canonical single-context model") was false - the single-context model was never built, so PR #62 inverted nothing.

Full adjudication: `work/findings/review-edit-loop-single-context-is-unbuilt-aspiration-vs-per-pass-disk-impl.md`. The sibling fresh-context M-layer idea: `work/ideas/lone-slice-review-fresh-context-m-layer.md`.

## Why revisit it (the incubating value)

The single-context loop is genuinely DIFFERENT, not just a refactor of the per-pass one, and may be better for SOME contexts:

- **Cheaper + faster where it fits:** one launch instead of N, no per-pass re-read of the (possibly large) slice files, no disk round-trip between passes. The agent holds the evolving slice + its own prior findings in context, so a later pass sees the REASONING of an earlier one, not just the edited file.
- **Richer accumulation:** per-pass re-launch loses the agent's intermediate reasoning (only the edited file survives); a single context keeps "I considered X and rejected it because Y", so a later angle does not re-litigate a settled point.
- **Maps cleanly onto the M x N model:** N = the in-context multipass depth (this idea), M = fresh-context re-launches for de-correlation. The per-pass build conflates them (every N pass is also an M launch). A true single-context N would let N and M be independent knobs (`prd/review.md` "Shape 2" + the fresh-context M-layer idea).

## The catches to design through (why it was deferred, not trivial)

- **Bounded + hard-capped:** the internal loop must be capped (the prompt instructs "at most K passes then stop") since the agent drives it, not the runner - no runner-side launch counter to enforce termination. A runaway internal loop is the risk the per-pass model avoids structurally.
- **Intake's no-pre-emit constraint:** intake must NOT write `work/backlog/<slug>.md` before convergence, so a single-context intake loop must accumulate IN MEMORY and emit the final body as TEXT (the terminal verdict), writing once on convergence. The slicer path CAN write to disk (the slice files already exist in `work/backlog/`), so the two contexts differ in where accumulation lives even under one launch.
- **Observability / resumability:** a per-pass loop has natural checkpoints (each launch + disk write); a single launch is more opaque (one session log) and a mid-loop crash loses the in-context accumulation. Weigh against the cost savings.
- **It touches the settled per-pass build:** adopting single-context means reworking `slicer-review-loop.ts` (and possibly intake) + reconciling `prd/review.md` Shape 2 - not an isolated add. A revisit should decide whether single-context REPLACES per-pass or coexists as a configured N>1-in-one-launch mode.

## If revisited, start here

1. Reconcile `prd/review.md` Shape 2 first (the headline-vs-operative contradiction) - decide whether single-context is the target and the per-pass build is the pre-target form, or whether per-pass is the end state and single-context is a distinct future mode.
2. Prototype the single-context loop on the SLICER path (it can write to disk, simpler) before intake (the no-pre-emit constraint adds the in-memory accumulator).
3. Keep the per-pass model available - the M (fresh-context) layer wants per-launch structure anyway (`lone-slice-review-fresh-context-m-layer.md`), so the two are complementary, not mutually exclusive.
