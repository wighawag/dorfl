---
title: intake's lone-slice bounded review shipped as M=3 fresh-context LAUNCHES (one agent per round) instead of the settled ONE-agent / N-in-context-passes loop — the drift entered at SLICE-AUTHORING (the "small loop in the dispatcher + injectable per-round gate seam" framing), losing the dogfooded in-context-loop design; the built mechanism is the exact combination prd/review.md argued against
date: 2026-06-10
slug: intake-lone-slice-review-built-as-per-round-launches-not-in-context-loop
---

## What was spotted

Reviewing the just-merged `intake-lone-slice-bounded-internal-review` (PR #62) with the maintainer, we found the bounded review was built with the **runner looping and launching a FRESH review agent per round** (`harnessLoneSliceReviewGate` calls `launchWithOptionalWatch` once per round, distinct `sessionId: …-r${round}`; `runLoneSliceReview`'s `for` loop calls the gate up to 3 times). That is **M=3 fresh-context launches, N=1 in-context pass each** — the exact INVERSION of the settled design.

The settled, documented mechanism (resolved Q1 in `work/prd/review.md` §"Shape 2", and built into `work/done/slicer-review-edit-loop.md`):

> **ONE agent reviews-and-EDITS in a SINGLE context** (the N in-context multipass, accumulating across angle-switched passes). A **fresh context is simply a NEW EXECUTION of that same loop** (the M). So the M×N grid = run the (review+edit) loop N passes deep, M times in fresh contexts.

So the canonical shape is **N = passes INSIDE one agent launch; M = number of launches**. The intake review should have been **one launch, the agent doing its own bounded (≤3) review→edit→re-review internally**, returning the converged body or the open question(s). Instead each "round" is a blind fresh context.

## Why the built shape is wrong (the maintainer's two-axis argument)

A fresh-context agent cannot "build on" the prior round's refinement unless that refinement is HANDED to it — and there are only two channels:

1. **Via disk** — round 1 writes, round 2 reads. The source observation (`intake-lone-slice-skips-adversarial-review-the-prd-path-gets.md`, override #4) FORBIDS this ("intake hasn't emitted yet, so you'd write-then-maybe-unwrite pre-emit disk state"), and the maintainer confirms intake does NO disk write before convergence.
2. **Via the prompt** — carry the prior body forward as a string. This is what the built code does (`body = verdict.edit` held in a TS var, re-injected into the next round's prompt).

So the built code dodges the disk problem (good) ONLY by making the 3 launches **near-pointless**: it pays for 3 cold-start model contexts to approximate what ONE warm context does better and cheaper. `prd/review.md` explicitly calls "another fresh-context pass" the INFERIOR option. The build landed on the one combination — fresh-context-per-round + in-prompt hand-off + no disk — argued against on BOTH axes. As the maintainer put it: _"one internal loop does not require writing to disk as the agent can self review in memory, but with agent running then we add the need for writing to disk or the 3 runs are meaningless."_

## The dogfooding ALREADY validated the in-context loop (the authoring session, recovered)

The authoring session (`~/.pi/agent/sessions/--home-wighawag-dev-github-wighawag-agent-runner--/2026-06-10T12-43-25-113Z_*.jsonl`, around commit `22b10e5`) was read back in FULL. It SETTLES the design in favour of the SINGLE in-context loop — the corrective slice's destination is the dogfood-validated one:

- A fresh agent was handed a manual prompt to draft the slice AND run the bounded ≤3-round self-review on its own draft, in ONE context. **It ran the loop for real:** 3 lens-attributed rounds whose findings MATERIALISED in the final artifact (the `agent-failed` degrade criterion + the "zero new outcome/marker/flag" check were genuine round-2 additions, absent from the first draft — real refinement with fingerprints, not narrated-but-fake).
- **The in-memory model is the NATURAL behaviour:** the agent held the candidate in context across the 3 rounds, converged, and wrote the artifact to disk ONCE, post-convergence. It did NOT write-edit-delete across rounds. This empirically CONFIRMS the slice's no-disk-before-converge / in-memory choice.
- A mid-session doubt ("an in-context 'do 3 passes' instruction doesn't bind — the agent will one-shot it") was RAISED and then EXPLICITLY RETRACTED in the same session: the doubt came from grepping the FILE on disk (only the slice body) instead of the SESSION (which carried the round-by-round `REVIEW-NOTES` trace). Once the real session was read, the conclusion was "I was wrong to doubt it — it did loop, observably." Do NOT cite the retracted doubt as a reason to prefer per-round launches; it was withdrawn.

NOTE on the dogfooded prompt: it is a REFERENCE for the loop SHAPE only, NOT a verbatim production source. It carries two dry-run-only framings that must NOT enter the production prompt: (1) it tells the agent to TREAT the observation file AS IF it were a GitHub issue thread (a simulation, because the real intake reads an ACTUAL issue); and (2) a `REVIEW-NOTES` reporting block that exists only so the human could SEE the rounds in the manual run (the real in-code loop's rounds are internal/invisible).

## Where the useful info went (the honest root cause)

The in-context-loop design was dogfood-VALIDATED (above), but its tested SHAPE **never made it into the slice BODY** as the build instruction. The slice body (`done/intake-lone-slice-bounded-internal-review.md`, "What to build") instead says:

- "a PROMPT + **a small loop in the dispatcher**",
- "an **injectable gate seam** so tests drive it with a canned verdict … mirror `IntakeDecider` / `SliceReviewGate`",
- "**Each round, the review agent** applies the `review` skill's lenses…".

A **per-round injectable gate** + "each round the agent applies…" literally encodes the runner-loops / one-launch-per-round shape — the OPPOSITE of the single in-context loop the dogfood run validated. So the slice BODY drifted from the validated design at slice-authoring time (the in-context-loop shape lived in the authoring conversation + session trace, but the body was written in per-round-gate language); the build agent then implemented the body FAITHFULLY. The drift entered at **slice-authoring**, not at build — a "design validated live, but the artifact's wording encoded a DIFFERENT mechanism" failure (cf. the orchestrate/setup principle: what is not written precisely into the artifact does not survive; here the imprecise words were the per-round "gate seam" / "each round the agent applies" framing).

## Why Gate-3 (conductor review) missed it

The acceptance criteria pin the CONTROL FLOW + dispatch outcomes (3-round cap, no config, converge→emit, non-converge→ASK-with-draft) — all satisfiable by EITHER mechanism. The criteria are mechanism-blind. Gate-3 checked the diff against the criteria (pass) and did not catch that the criteria themselves had drifted from the documented M×N model. (A reminder that "criteria pass" ≠ "design intent honoured" — the exact gap Gate-3 exists to catch.)

## Disposition

The merged code is BEHAVIOURALLY correct (tested; avoids disk; converges or flips to ASK) — it is _wasteful + conceptually off_, not broken. Fix deliberately via a corrective slice (`intake-lone-slice-review-single-context-loop`), NOT a rushed `main` edit. The corrective slice reshapes the seam from per-round gate → single bounded in-context review-edit launch (one agent does ≤3 internal passes, returns the final body or the questions), keeping every acceptance behaviour and the no-disk-before-converge invariant. The early-flip nit (the loop flips to ASK only at the cap, never early on a `block`+`questions` round — nit #1 in `review-nits-intake-lone-slice-bounded-internal-review-2026-06-10.md`) folds into the same corrective slice (the in-context agent can flip early by returning a non-converge verdict on the single launch).

## Recover the dogfooded prompt

The real in-context review prompt we tested at authoring time should be recovered from the authoring session (around commit `22b10e5`, 2026-06-10 ~14:16) and used as the basis for the corrective slice's prompt, rather than re-derived. If it cannot be recovered, the corrective slice re-authors it from the `review` skill's per-slice + destination lenses (N=1, SET lenses off) — but recovery is preferred (it was already validated).
