---
title: in-place `do`'s main-divergence guard is mode-agnostic, but its slice rationale was "paths that ff local main" (propose never ffs)
date: 2026-06-07
kind: observation
area: packages/agent-runner/src/do.ts (main-divergence-guard slice, PR #30)
severity: low
status: open
---

## What I noticed (during the PR #30 self-review)

`main-divergence-guard` shipped two guard sites with DELIBERATELY DIFFERENT
mode-scoping:

- `complete --merge`'s pre-flight divergence guard is **merge-mode-only**
  (`requestedMode === 'merge' && options.ignoreDivergedMain !== true`) — test
  `a diverged main in PROPOSE mode is NOT guarded (propose never ff's local main)`.
- in-place `do`'s pre-flight guard is **mode-agnostic** — it refuses a diverged
  local `main` in BOTH `--merge` AND `--propose` (test `refuses in propose mode
  too (the guard is mode-agnostic at pre-flight)`).

The Gate-2 review raised this as a non-blocking nit
(`work/observations/review-nits-main-divergence-guard-2026-06-07.md`): the slice's
*rationale* for the guard is "the same class of checkout state that breaks the
**paths that ff local main**" — and `do --propose` never ff's local `main` (it only
switches to it; onboarding cuts `work/<slug>` off `<arbiter>/main`). So by the
rationale, the `do` guard arguably should be merge-mode-only too.

## Why it landed anyway (not a blocker)

- Acceptance criterion #3 is written WITHOUT a mode qualifier for `do` ("In-place
  `do` (and `complete --merge`) REFUSE up front when local `main` is
  diverged/ahead… UNLESS the `--ignore-...` override is passed"). The
  implementation conforms to the criterion as literally written.
- The acceptance-criteria tests EXPLICITLY pin the mode-agnostic `do` behaviour as
  intended (`refuses in propose mode too`), so this is a designed choice, not an
  accident.
- It is loud + overridable (`--ignore-diverged-main`), so the blast radius is
  small.

## The open question (for batch-qa triage)

Is the mode-agnostic `do` guard the RIGHT long-term behaviour, or should it be
narrowed to merge-mode-only to match `complete` and the "paths that ff local main"
rationale?

A reasonable case FOR keeping it mode-agnostic: a diverged/unpushed local `main` is
a "your checkout is in a surprising state" smell regardless of integration mode,
and refusing-loudly-with-an-override is a defensible safety default (sibling to the
dirty-tree refusal, which is also mode-agnostic). A reasonable case AGAINST: it
refuses a `do --propose` that would have worked fine, adding friction with no ff to
protect.

Captured (not fixed in-place) because it is a design judgment outside this drive's
build-and-merge scope; route via batch-qa (keep as-is / narrow to merge-mode /
promote to a slice).
