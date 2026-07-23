---
title: 'Pre-build slice-review gate (review SPEC insertion point B) — an independent reviewer pass on a claimed slice BEFORE the agent builds it, to catch a slice that drifted between slicing and build'
slug: pre-build-slice-review-gate
type: idea
status: incubating
---

# Pre-build slice-review gate (insertion point B)

> Carried 2026-06-12 from `work/spec/review.md`'s deferred follow-up list (insertion point **B**) as that SPEC comes to rest in `spec-sliced/`. It is a SPECULATIVE-but-real future insertion point, parked here (alongside the other deferred review insertion-point ideas: `single-context-review-edit-loop.md`, `lone-slice-review-fresh-context-m-layer.md`) rather than left to evaporate with the SPEC. NOT a defect; NOT slice-ready until the overlap below is judged worth paying for.

## The idea

The `review` SPEC defines ONE review/edit mechanism plugged in at several lifecycle **insertion points**. Two bracket the build and are already built:

- **A — slice-generation review** (`do prd:<slug>`): a review→edit loop critiques + improves slices AS they are created (`work/done/slicer-review-edit-loop.md`).
- **C — post-build review / Gate 2** (`do <slug>` after the agent builds): review critiques the DIFF before integrate (`work/done/review-gate-pr.md`).

**B is the gap between them.** A slice can sit in `backlog/` for a while; then `do <slug>` claims it and an agent builds it. **B inserts an independent slice-review (a Shape-1 one-shot gate, slice-framed prompt) right after claim and BEFORE the agent writes any code** — so a slice that has gone stale or carries a missed judgement is caught/refined BEFORE a whole build is spent on a bad premise. Verdict routes through the EXISTING seam: `approve` ⇒ build proceeds; `block` ⇒ `needsAnswers` on the slice / route to `needs-attention`, no build.

## Why it is NOT obviously worth building (the overlap to judge first)

B's marginal value is narrow because three things already cover most of it:

1. **Every slice's `## Prompt` already carries a drift-check** ("FIRST, check this slice against current reality... route to `needs-attention/` if it drifted"). That is a SELF-check by the building agent at build-time — the same moment B would fire.
2. **Insertion point A** already reviewed the slice at BIRTH.
3. **Gate 2 (C)** catches a bad OUTCOME at the end.

So B's ONLY distinct value is: catching a slice that was sound when sliced but **DRIFTED between slicing and build-time**, in the case where the building agent's OWN drift-check is not trusted to catch it (an INDEPENDENT reviewer vs the builder self-assessing). That is a real but speculative concern.

## When to promote this to a slice (the trigger)

Promote B to a slice the moment a drifted slice is observed to get BUILT WRONG despite the per-slice self-check AND Gate 2 — i.e. an actual incident where the builder's own drift-check missed a stale premise and the bad build was not caught until late (or merged). THAT incident is the evidence that the independent pre-build pass earns its cost. Until then it is a YAGNI insertion point: the self-check + the two existing gates are the cheaper floor.

## If/when built (shape, so a future slice is grounded)

- Reuses the built `review` skill (the one-shot GATE shape, Shape 1 — NOT the edit loop). Slice-framed prompt = "does this slice still match current reality / `done/` / the ADRs; any missed judgement before code is written?" (the destination-check folded into the single pass).
- Insertion: on the `do <slug>` BUILD path, after claim, before the build agent launches.
- Per-repo toggle (resolved flag > env > per-repo > global > default), defaulting OFF (it adds a model invocation + latency to every build) — distinct from `review` (Gate 2) and `reviewSpec` (Gate 1 / point A).
- Verdict routing reuses the needs-attention / `needsAnswers` seam exactly as the other gates do; NO new surfacing mechanism.

## Refs

- `work/spec/review.md` (the originating SPEC — RESOLVED DESIGN section, insertion points A–E; this is B).
- Built siblings: `work/done/slicer-review-edit-loop.md` (A), `work/done/review-gate-pr.md` (C), `work/done/run-through-integration-core.md` (D).
- Parked siblings: `work/ideas/single-context-review-edit-loop.md`, `work/ideas/lone-slice-review-fresh-context-m-layer.md`.
