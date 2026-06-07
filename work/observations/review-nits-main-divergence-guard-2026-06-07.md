---
title: review-gate non-blocking nits for 'main-divergence-guard' (Gate 2 approve)
date: 2026-06-07
status: open
slug: main-divergence-guard
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'main-divergence-guard' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- The in-place `do` divergence guard fires regardless of integration mode, so `do --propose` with a diverged local `main` is refused even though propose-mode `do` never fast-forwards local `main` (it only switches to it) and onboarding cuts `work/<slug>` off `<arbiter>/main`. Was the mode-agnostic refusal on `do` intended (the `complete` guard is correctly scoped to merge mode), or should the `do` guard also be merge-mode-only to match the slice's "paths that ff local main" rationale?
  (src/do.ts step 3b runs the guard unconditionally (`if (options.ignoreDivergedMain !== true)`), whereas src/complete.ts gates it on `requestedMode === 'merge'`. Conforms to acceptance criterion #3 (which states the `do` refusal unconditionally) and is loud + overridable, so impact is low; flagged only as a deliberate-or-not consistency point.)
