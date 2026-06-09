---
title: skill-set has no named entry for the "to-slices conversation vs do prd:<slug> autonomous" slicing choice
type: observation
status: spotted
spotted: 2026-06-09
---

## What was spotted

While slicing `work/prd/issue-intake.md`, the maintainer noted they keep reaching for
the `to-slices` SKILL and "keep forgetting" that `do prd:<slug>` exists as the other
way to slice a PRD — and wondered whether the skill set is missing something.

It is. There are TWO ways to turn a PRD into `work/backlog/*` slices, and NOTHING in
the skill set NAMES the choice between them:

- **`to-slices`** — the skill: model-driven, human-in-the-loop, provider-agnostic,
  runs anywhere (no agent-runner dependency). Has a memorable trigger, so it is the
  one that comes to mind.
- **`do prd:<slug>`** — the agent-runner COMMAND: drives the SAME slicing
  AUTONOMOUSLY (no human), gate-gated (`autoSlice` + the PRD's own `humanOnly` /
  `needsAnswers` / `sliceAfter`), runner-owns-git. Emits the same artifact.

They are not substitutes — they are two halves meeting at the same artifact. The
choice is "do I want a conversation, or an unattended run?" `drive-backlog` /
`orchestrate` CALL `do prd:` / `do <slice>` under the hood, but no skill DESCRIPTION
surfaces the bare decision, so `do prd:` stays invisible in conversation while
`to-slices` keeps coming up.

## Why it matters

- The maintainer wants to exercise `do prd:` whenever they can (to test the runner),
  but forgets it is an option because nothing prompts the choice.
- For THIS task `to-slices` was correct AND `do prd:` could not substitute: the PRD is
  `humanOnly: true`, so `do prd:` refuses it on the agent path (and even after
  `explicit-do-prd-not-gated-by-autoslice` lands, `humanOnly` still binds). The
  protocol was already saying "use the conversational path here" — but the skill set
  doesn't say WHY/WHEN out loud.

## The shape of the gap (not a fix — a candidate)

The fix is likely NOT a new slicer but a one-liner in the decision space that routes:
- slicing a `humanOnly` / unclear / not-yet-ready PRD, or wanting a conversation →
  `to-slices` (the skill);
- slicing a ready, agent-safe (`humanOnly: false`, no open `needsAnswers`, gates
  satisfied) PRD UNATTENDED, or wanting to test the runner → `do prd:<slug>`.

Candidate homes (for a human to decide — NOT auto-applied): a note in `to-slices`'s
description / WORK-CONTRACT cross-ref pointing at `do prd:`; or surfacing the choice
in `orchestrate`/`drive-backlog`; or a tiny dedicated routing skill. Possibly an
`ideas/` entry if it grows into a real enhancement.

## Refs

- Spotted during the `issue-intake` slicing session, 2026-06-09 (the slices written
  to `work/backlog/intake-*` + `prd-complete-query`; PRD moved to
  `work/prd-sliced/issue-intake.md`).
- Related: `work/backlog/explicit-do-prd-not-gated-by-autoslice.md` (the gate
  asymmetry on the explicit `do prd:` path).
