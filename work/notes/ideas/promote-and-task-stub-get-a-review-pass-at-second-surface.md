---
title: 'A promoted observation''s task stub (and any thin minted task) should get a REVIEW pass — best run at its SECOND surface, so the human''s first answer turns a thin stub into a STRONG, buildable task'
slug: promote-and-task-stub-get-a-review-pass-at-second-surface
type: idea
status: incubating
---

# Give the observation→task promote path a review pass, like intake's lone-slice review and the brief→task slicer review

> Captured 2026-06-22 from a design conversation while testing the advance lifecycle
> on a real promoted observation. NOT built; pre-brief. Names are placeholders.

## The gap

`promote-slice` (a human answering "promote" on an untriaged observation) currently
mints a MINIMAL task stub and nothing reviews it:

- `promoteObservation` (`src/triage-persist.ts:294`) → `defaultStub` (~L377): a stub
  with only `title` / `slug` / `needsAnswers: true` / `blockedBy: []` and a one-line
  body. No slicer, no review runs at promote time.
- By contrast, the codebase ALREADY has TWO established review patterns the promote
  path skips:
  1. **Intake's LONE-SLICE review** (`src/intake.ts`, `reviewSlice:
     LoneSliceReviewGate`, `harnessLoneSliceReviewGate`): a 3-round, HARD-CAPPED
     adversarial self-review on a SINGLE drafted slice. (Slice
     `intake-lone-slice-skips-adversarial-review-the-spec-path-gets`.)
  2. **The slicer SET review** (`src/slicing.ts`, `review?` + the slicer
     review→edit loop `slicer-review-loop.ts`): a fresh-context review of the WHOLE
     produced slice SET (coherence / dependency graph), config-gated by `review`.

So a brief→task breakdown and the intake flow both get a quality pass; an
observation→task promotion does not. The minted stub is thin and unreviewed, and a
human then has to do the sharpening by hand (or the task gets claimed thin).

## The proposal (the clever bit: review at the SECOND surface)

The minted stub is born `needsAnswers: true`, so it RE-ENTERS the existing
surface→answer→apply loop as a SURFACE candidate. That second surface is the natural
place to run the review pass — NOT a new gate bolted onto promote. Concretely:

- **Stage 1 — first surface (triage):** the runner surfaces the promote/keep/delete
  triage question on the observation. Human answers `promote-slice`.
- **Stage 2 — apply → mint stub → SECOND surface:** apply mints the
  `needsAnswers:true` stub; the stub is then a surface candidate. AT THIS SECOND
  SURFACE, run a REVIEW pass over the drafted stub (reuse intake's lone-slice
  review machinery, or the `review` discipline against the task) whose OUTPUT
  FEEDS the surfaced questions — so the questions the human answers in round two are
  the SHARP ones that turn a thin stub into a STRONG, well-specified, buildable task
  (acceptance criteria, scope fence, the open design choices the reviewer flags as
  blocking). The human answers → apply resolves the stub into a strong task.

This means: review is woven into the question loop the system already runs, the
human's SECOND answer does the sharpening (guided by the review's findings), and no
unreviewed thin task ever becomes claimable. The goal is a strong task, produced
by review-informed questions, with the human still the clock.

## Why this seam (not promote-time)

- Promote-time has no human in the loop to answer review-raised questions; the
  SECOND surface does (it is a surface rung — its whole job is to ASK). Running
  review at the second surface lets the reviewer's BLOCKING findings become surfaced
  QUESTIONS (the existing surface contract already routes review `block` findings
  into questions — see `work/protocol/SURFACE-PROTOCOL.md` "What you COMPOSE" §1).
- It reuses the lone-slice review gate (one drafted item, bounded rounds) — the
  RIGHT granularity for a single task, vs the slicer SET reviewer (whole set
  coherence). The intake lone-slice gate is the closest existing analogue.
- It is consistent with "review enters at build/land (Gate 2) regardless" — this
  ADDS an EARLIER, cheaper authoring-time review so the task is strong BEFORE it is
  claimed, not only judged after it is built.

## Open questions to resolve in a brief / grilling

- **Which reviewer:** reuse `harnessLoneSliceReviewGate` (intake's), or the generic
  `review` discipline against a task? (Lone-slice is the closer fit.)
- **Rounds / cost:** bounded like intake's 3-round hard cap? Config-gated by the
  same `review` key, or its own (e.g. `reviewPromotedTasks`)? Default on or off?
- **Trigger scope:** ONLY observation-promoted stubs, or ANY thin `needsAnswers:true`
  task at its first/second surface (a general "review thin tasks at surface" rung)?
  The latter is more powerful but widens the blast radius.
- **Surface-vs-review ordering:** does review run BEFORE the surfacer composes
  questions (so its findings ARE the questions), or alongside? (The surface
  contract already composes `review` block findings — so "before, feeding the
  compose" is the natural wiring.)
- **Idempotency:** the second-surface review must not re-fire forever (tie into the
  pending-sidecar no-op + the once-surfaced state).
- **Does promote itself stay thin?** Yes — keep `promoteObservation` minimal; the
  strengthening happens at the second surface, so promote stays a cheap CAS create.

## Provenance / refs

- `src/triage-persist.ts:294` (`promoteObservation`) + `:377` (`defaultStub`, the
  thin stub).
- `src/intake.ts` (`reviewSlice: LoneSliceReviewGate`, `harnessLoneSliceReviewGate`,
  the 3-round hard-capped lone-slice review — the closest analogue).
- `src/slicing.ts` (`review?` + the slicer set-review loop) — the brief→task pass.
- `src/advance-classify.ts` (the surface/apply state machine the minted
  `needsAnswers:true` stub re-enters).
- `work/protocol/SURFACE-PROTOCOL.md` ("What you COMPOSE" §1: surface already routes
  `review` BLOCK findings into questions — the hook this idea leans on).
- Related: `work/notes/observations/answered-observation-body-block-is-invisible-to-promote-path-needs-sidecar-2026-06-22.md`
  (the silent-stall trap discovered in the same session).

## Note on scope

A pre-brief enhancement: weave an authoring-time review into the observation→task
promote path via the existing second-surface question loop, so a promoted task is
STRONG before it is claimable, mirroring intake + brief→task. A human decides whether
to brief/slice it and which reviewer + gating to use.
