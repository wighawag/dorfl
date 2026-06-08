---
title: --review-max-rounds bounds a revise↔review loop whose REVISE step does not exist yet — so >1 round is near-useless today (re-reviews unchanged bytes); it earns its keep only once the builder-revise step lands
type: observation
status: spotted
spotted: 2026-06-08
---

# `--review-max-rounds` is a knob for a half-built loop

Spotted 2026-06-08 while designing the slice-path review flags
(`work/prd/slicing-coherence.md`), examining what `--review-max-rounds` actually
does on the build/`do slice:` path.

## What it does today (verified in `integration-core.ts`)

The Gate-2 acceptance loop is `for (round = 1..maxRounds)`: it invokes the
fresh-context `review` gate **on the UNCHANGED artifact each round**. `approve` →
break + integrate; a persistent `block` exhausts the rounds → routed to
needs-attention (never silently merges). `reviewMaxRounds` defaults to 2.

The code comment marks the gap explicitly: *"A `block`: re-review up to
`reviewMaxRounds` (**a future builder-revise step plugs in here**). A persistent
block exhausts the loop → routed below."*

## Why >1 round is near-useless RIGHT NOW

Nothing changes between rounds — there is no revise step that edits the artifact
after a `block`. So round 2..N re-reviews IDENTICAL bytes. Per the `review` skill's
own discipline, **re-running the same angle converges on nothing**: a fresh context
*might* catch something by luck (reviews are non-deterministic), but that is a weak
return for N extra agent launches. The bound is bounding a loop that does not
improve anything between iterations.

The feature only earns its keep once the **builder-revise step** lands: then the
loop becomes the intended `review → block → builder REVISES → re-review`, and
`--review-max-rounds` meaningfully bounds the revise↔review cycles before forcing
needs-attention (mirroring how `--slicer-loop-max` bounds the slicer IMPROVER
loop, which DOES edit between passes).

## Decision / disposition

- **Leave `--review-max-rounds` as-is for now** (maintainer's call) — ripping it
  out is churn and it is harmless at its default; it is a real bound for the
  revise loop once that exists.
- **Do NOT advertise it as a slice-path FEATURE.** On the slicing-coherence PRD the
  slice acceptance gate INHERITS `--review-max-rounds` for free via
  `performIntegration` (same gate machinery as build) — list it as "comes along,
  latent value," NOT a headline user story. Its slice-path value is exactly as
  latent as its build-path value.
- **The real follow-up is the builder-revise step** (its own future slice/PRD): the
  step that, on a `block`, hands the builder the findings to REVISE before
  re-review. Until then both `do slice:` and `do prd:` get a rounds knob that only
  pays off after that step ships.

Contrast (so the two are not confused): the slicer IMPROVER loop
(`--slicer-loop-max`, `slicer-review-loop.ts`) ALREADY edits between passes (it
feeds findings back as edits) — so ITS max is a real convergence bound today. The
GATE's `--review-max-rounds` is the one waiting on a revise step.
