---
title: review-gate non-blocking nits for 'de-overload-humanonly-narrow-slice-guard-and-slicer-heuristic' (Gate 2 approve)
date: 2026-06-18
status: open
reviewOf: de-overload-humanonly-narrow-slice-guard-and-slicer-heuristic
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'de-overload-humanonly-narrow-slice-guard-and-slicer-heuristic' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the 'slicer heuristic shift' is implemented as prompt/brief guidance in `buildSlicingBrief` and `buildSliceReviewPrompt`, not as enforced runner code — relying on the already-landed runner-deterministic placement to make staging-birth structural. Is the prompt-only locus the intended level of enforcement, or did the slice expect a code-level guard against `humanOnly` being emitted for review-first cases?
  (The slice's brief tells the agent to birth slices in `work/pre-backlog/` and reserves `humanOnly` for never-by-nature. Tests assert the prompt text but do not assert a runner-side refusal of a slicer-emitted `humanOnly` slice that 'should have been' staging-birth — by design, since runner-deterministic placement is the structural guarantee. Worth a human ratification that this division of labour matches intent.)
- Ratify: the slice's own `humanOnly` gate was downgraded to undeclared mid-flight (recorded in `## Decisions`) on the grounds that the live migration surface was empty. Is the human happy to ratify that gate-drop as the canonical pattern for future 'judgement-core but empty-surface' slices?
  (Recorded in the slice frontmatter/body under `## Decisions` (2026-06-18). The decision is the legitimate kind to flag for human ratification: it sets precedent for treating a humanOnly slice as agent-buildable once its judgement surface is verified empty.)
