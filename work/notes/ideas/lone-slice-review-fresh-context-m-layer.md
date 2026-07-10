---
title: The per-round-launch scaffold removed from intake's lone-slice review is the M-LAYER (fresh-context second-opinion) template — revive it for M>1 ONLY after de-chaining it (independent fresh draft per M-pass), if/when a lone-slice review wants the full M×N model
slug: lone-slice-review-fresh-context-m-layer
type: idea
status: incubating
---

# The intake per-round-launch scaffold = an M-layer template (salvage, don't delete the idea)

> Captured 2026-06-10 from the post-merge review of `intake-lone-slice-bounded-internal-review` (PR #62) with the maintainer. The corrective slice `intake-lone-slice-review-single-context-loop` REMOVES the per-round-launch loop from the intake path (intake's rulings A/B say `M=1`, hard-cap 3, no M×N knob). This idea records WHY that removed code is not worthless — it is the proven scaffold for the M (fresh-context) axis — so the insight is not lost when the code goes.

## The canonical model (settled)

`work/spec/review.md` §"Shape 2" (resolved Q1) + `work/done/slicer-review-edit-loop.md` define the review-edit loop as an **M×N grid**:

- **N — in-context passes:** ONE agent does review→edit→re-review N times INSIDE a single context, accumulating (each pass sees prior findings + its own edits). This is the cheap default (`M=1, N=…`).
- **M — fresh-context executions:** run that whole loop again in a SEPARATE, INDEPENDENT launch — a fresh context that did not see the first one's rationalisations. `M=k` = k independent fresh loops. A fresh context catches what the first one talked itself out of (the empirical reason an independent adversarial pass beats a self-check).

The corrective slice gives intake the **N** axis (one launch, ≤3 in-context passes). It does NOT give intake **M** — by ruling.

## What the removed code actually was

PR #62 built the bounded review as the RUNNER looping and launching a fresh agent PER ROUND (distinct `sessionId: …-r${round}`). That scaffold — _runner re-invokes the review in a fresh context, up to a cap_ — is structurally the **M loop**. It was mislabelled as N (the "rounds" were meant to be in-context passes) and, critically, it was **CHAINED**: each launch was fed the PRIOR launch's edited body. That chaining is the incoherent part:

- It is not clean **N** (those passes belong in ONE context, not fresh ones).
- It is not clean **M** either — a legitimate M-pass is an INDEPENDENT fresh opinion on the SAME draft, not a continuation of the previous fresh context's edit. Chaining fresh contexts gets the cost of M (k cold-start launches) with the coherence of neither.

So the scaffold is reusable, but only after **de-chaining**: each M-pass must review the same starting draft independently, and convergence = a fresh pass adds no NEW blocking finding (the `slicer-review-edit-loop` M semantics).

## When this idea would activate

Revive the M layer for a lone-slice review IF either:

1. a lone-slice review ever wants to match the FULL M×N model the slicer edit loop has (a configurable fresh-context second opinion), OR
2. evidence shows intake's single in-context pass (N-only) misses things a fresh independent look would catch — i.e. the same "independent adversarial pass beats a self-check" finding that justified M for the slicer.

At that point, the template is: take the corrective slice's single-launch in-context review (the N unit) and wrap it in a runner loop that re-invokes it M times in **independent** fresh contexts on the SAME draft, converging when a fresh pass finds nothing new — exactly the `M=k` shape `slicer-review-edit-loop` already implements. Reuse that slice's M plumbing rather than re-deriving; do NOT chain the body across M-passes.

## Why NOT now (the fence)

Intake's settled rulings (observation `intake-lone-slice-skips-adversarial-review-the-spec-path-gets.md`, rulings A/B): hard-code 3, not configurable, NO M×N knob — because **intake's outer review loop is the human in the issue thread**, so a fresh-context second opinion is lower-value than just bouncing an unresolved blocker to the human (ASK). So M for intake is speculative until proven. This is an INCUBATING idea, not a slice — do not build it without evidence + a ruling that reopens A/B.

## Pointers

- Removed-from / reshaped-by: `work/backlog/intake-lone-slice-review-single-context-loop.md` (the corrective slice — N axis).
- Root-cause diagnosis: `work/observations/intake-lone-slice-review-built-as-per-round-launches-not-in-context-loop.md`.
- Canonical M×N model + M plumbing precedent: `work/spec/review.md` §"Shape 2" (resolved Q1); `work/done/slicer-review-edit-loop.md` (acceptance criterion "M fresh-context executions").
