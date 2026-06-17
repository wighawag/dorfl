---
title: De-overload humanOnly — narrow the slice guard, shift the slicer heuristic to staging-birth, name the three modes
slug: de-overload-humanonly-narrow-slice-guard-and-slicer-heuristic
prd: staging-pool-position-gate-and-trust-model
humanOnly: true
blockedBy: [runner-deterministic-slice-placement-policy-and-precedence]
covers: [8, 9, 10, 11]
---

## What to build

De-overload `humanOnly` now that the folder takes the position/review job:

- **Narrow slice `humanOnly`** to the rare "never-for-agents BY NATURE" guard
  (secrets/release/security) that survives EVEN in the pool — the predicate still
  excludes a `humanOnly` slice when it is in the pool. PRD `humanOnly` is UNCHANGED
  (it gates auto-slicing; no folder substitute). `needsAnswers` unchanged. The
  result is three orthogonal axes each meaning ONE thing.
- **Shift the slicer heuristic** from "stamp `humanOnly: true` for REVIEW"
  (overloaded) to "birth the slice in the STAGING folder for review; flag
  `humanOnly` ONLY for genuinely never-agent-buildable." The common review-first
  case becomes a POSITION (staging), not a flag.
- **MIGRATE existing slice-`humanOnly` uses** (the judgement core): re-home the
  review-first ones to staging-birth; LEAVE the genuinely-never ones flagged. This
  is a content/judgement decision per existing use — the reason this slice is
  `humanOnly`.
- **Name the three honest modes explicitly** so they are documented and selectable:
  `--propose` = the PR path (where a host exists); `--merge` + land-in-staging =
  the PR-free review path; `--merge` + land-in-pool = the trusted no-review fast
  path. CODE/implementation review STILL uses a branch/PR (a diff cannot be
  folder-gated) — the position gate is scoped to LEDGER-FILE output (slicing) and
  the existing branch-based build review is unchanged (PRD US #9).

## Acceptance criteria

- [ ] A slice with `humanOnly: true` is NOT agent-eligible even when it resides in
      the pool (`backlog/`); PRD `humanOnly` still blocks auto-slicing;
      `needsAnswers` semantics unchanged — the three axes are orthogonal and each
      means one thing.
- [ ] The slicer's review-first heuristic produces STAGING-birth (not a
      `humanOnly` stamp) for the common review case; `humanOnly` is emitted ONLY for
      genuinely-never-agent-buildable slices.
- [ ] Existing slice-`humanOnly` uses are migrated: review-first ones re-homed to
      staging-birth, genuinely-never ones left flagged (the migration is recorded —
      which uses went which way and why).
- [ ] The three modes (`--propose`, `--merge`+staging, `--merge`+pool) are
      explicit and behave as specified; implementation/code review still uses the
      branch/PR path, unchanged.
- [ ] Tests cover the de-overloaded predicate (humanOnly slice not eligible in the
      pool; PRD humanOnly still blocks slicing) and the slicer heuristic shift, on
      the `--bare file://` arbiter house pattern. Acceptance gate green:
      `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `runner-deterministic-slice-placement-policy-and-precedence` — the "review-first →
  staging-birth" heuristic depends on runner-deterministic placement existing.

## Prompt

> A HUMAN must drive this slice: it migrates existing `humanOnly` uses by judgement
> (which are review-first vs genuinely never-for-agents) and decides the
> de-overloaded model's wording. Read
> `work/prd/staging-pool-position-gate-and-trust-model.md` (US #8, #9, #10, #11) and
> the governing ADR
> `docs/adr/placement-is-runner-deterministic-humanonly-is-agent-judgement.md`.
> First check for drift: the placement-precedence slice
> (`runner-deterministic-slice-placement-policy-and-precedence`) must be in `done/`.
>
> WHERE TO LOOK: the autonomy predicate + the two axes live in the WORK-CONTRACT
> and the gate resolution (`src/slicing-eligibility.ts`, the slice readiness/claim
> guard in `src/claim-cas.ts`, the `autoBuild`/`autoSlice` predicate). The slicer
> heuristic that stamps slice gates is the `to-slices` brief + the slicer
> review/edit loop (`src/slicing.ts buildSlicingBrief`, `src/slicer-review-loop.ts`)
> — shift it from "stamp humanOnly for review" to "birth in staging; flag humanOnly
> only for never-agent-buildable." The three integration modes are the
> `--propose`/`--merge` + `slicesLandIn` combination from the placement slices.
>
> THE JUDGEMENT WORK: enumerate current slice-`humanOnly` uses, decide per use
> whether it is review-first (→ staging-birth) or genuinely-never (→ keep flagged),
> and record the migration. Keep PRD `humanOnly` and `needsAnswers` exactly as they
> are. Update WORK-CONTRACT.md (and mirror into both `protocol/` copies — see this
> repo's AGENTS.md: `skills/setup/protocol/` is the source of truth, `work/protocol/`
> is the propagated copy; keep `diff -r` clean) so the de-overloaded semantics are
> documented.
>
> SEAMS TO TEST AT: the `--bare file://` arbiter house pattern
> (`test/helpers/gitRepo.ts`). "DONE" = the acceptance criteria hold and
> `pnpm -r build && pnpm -r test && pnpm format:check` is green (`pnpm format` to
> fix formatting). Do NOT commit or move work/ files — the runner/human owns git.
> Record the de-overload model + the migration decisions as an ADR if they meet the
> gate (the model likely does), else a `## Decisions` note.
