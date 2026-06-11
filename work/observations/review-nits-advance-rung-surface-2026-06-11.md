---
title: review-gate non-blocking nits for 'advance-rung-surface' (Gate 2 approve)
date: 2026-06-11
status: open
slug: advance-rung-surface
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-rung-surface' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the default: the SURFACE agent runs on `config.model` (the build/agent model), with NO dedicated `surfaceModel` config key — diverging from the review gate's de-correlated `reviewModel`. Is running the surfacer on the same model as the builder the intended default, or should surfacing get its own de-correlated model knob like review does?
  (cli.ts threads `surfaceModel: config.model` with an inline comment 'no dedicated surfaceModel config key is introduced by this slice.' The seam (`surfaceModel` on SurfaceGateInput/AdvanceContext) exists and routes through LaunchInput.model, so adding a config key later is a thin, reversible follow-up. This is an in-scope user-visible default the slice did not explicitly specify; recorded here for ratification.)
- Acknowledge the latent (currently-unreachable) edge: `persistSurfacedQuestions` relies on `setNeedsAnswersMarker`, which no-ops silently if the item file has no `---` frontmatter fence — leaving a sidecar written but `needsAnswers` NOT set, breaking invariant 1. Safe today because the surface classifier guarantees `needsAnswers:true` is already present, but should `persistSurfacedQuestions` fail loudly (rather than silently skip the flag) if the frontmatter fence is ever absent, to harden it for future non-gated callers?
  (frontmatter.ts setNeedsAnswersMarker: 'A document with no frontmatter fence is returned unchanged.' advance-classify.ts only emits 'surface' when needsAnswers===true, so the item always has the fence in this path — the edge is unreachable via the engine today. No test covers the no-frontmatter item because none can occur in the surface cell. Non-blocking; raised as a robustness note for the persist primitive's future reuse by apply/triage.)
