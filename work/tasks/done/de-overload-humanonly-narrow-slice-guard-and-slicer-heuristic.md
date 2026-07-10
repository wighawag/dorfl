---
title: De-overload humanOnly — narrow the slice guard, shift the slicer heuristic to staging-birth, name the three modes
slug: de-overload-humanonly-narrow-slice-guard-and-slicer-heuristic
spec: staging-pool-position-gate-and-trust-model
blockedBy: [runner-deterministic-slice-placement-policy-and-precedence]
covers: [8, 9, 10, 11]
---

## What to build

De-overload `humanOnly` now that the folder takes the position/review job:

- **Narrow slice `humanOnly`** to the rare "never-for-agents BY NATURE" guard
  (secrets/release/security) that survives EVEN in the pool — the predicate still
  excludes a `humanOnly` slice when it is in the pool. SPEC `humanOnly` is UNCHANGED
  (it gates auto-slicing; no folder substitute). `needsAnswers` unchanged. The
  result is three orthogonal axes each meaning ONE thing.
- **Shift the slicer heuristic** from "stamp `humanOnly: true` for REVIEW"
  (overloaded) to "birth the slice in the STAGING folder for review; flag
  `humanOnly` ONLY for genuinely never-agent-buildable." The common review-first
  case becomes a POSITION (staging), not a flag.
- **MIGRATE existing slice-`humanOnly` uses** (the would-be judgement core): re-home
  the review-first ones to staging-birth; LEAVE the genuinely-never ones flagged.
  **VERIFIED 2026-06-18: this sub-task is a NO-OP.** The ONLY live (`backlog/`/
  `in-progress/`/`needs-attention/`) slice carrying `humanOnly: true` was THIS slice
  itself; every other `humanOnly: true` slice is in `work/done/` (historical, never
  re-homed) and every `humanOnly` SPEC is out of scope (SPEC `humanOnly` is unchanged).
  So there is NO live slice to classify, and this slice's own gate was dropped on
  that finding (the human judgement that made it `humanOnly` had an empty surface).
  Do NOT go hunting for slices to re-home or guess a classification — confirm the
  surface is still empty (`grep -rl 'humanOnly: true' work/backlog/ work/in-progress/
  work/needs-attention/` returns only slices you would treat as genuinely-never), then
  move on. If a NEW live `humanOnly` slice has appeared since, STOP and route to
  needs-attention rather than reclassifying it unsupervised (that reclassification IS
  a human judgement).
- **Name the three honest modes explicitly** so they are documented and selectable:
  `--propose` = the PR path (where a host exists); `--merge` + land-in-staging =
  the PR-free review path; `--merge` + land-in-pool = the trusted no-review fast
  path. CODE/implementation review STILL uses a branch/PR (a diff cannot be
  folder-gated) — the position gate is scoped to LEDGER-FILE output (slicing) and
  the existing branch-based build review is unchanged (SPEC US #9).

## Acceptance criteria

- [ ] A slice with `humanOnly: true` is NOT agent-eligible even when it resides in
      the pool (`backlog/`); SPEC `humanOnly` still blocks auto-slicing;
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
      pool; SPEC humanOnly still blocks slicing) and the slicer heuristic shift, on
      the `--bare file://` arbiter house pattern. Acceptance gate green:
      `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `runner-deterministic-slice-placement-policy-and-precedence` — the "review-first →
  staging-birth" heuristic depends on runner-deterministic placement existing.

## Decisions

- **Gate dropped from `humanOnly: true` to undeclared (2026-06-18, human call).** The
  flag was set because the slice's core was a per-use security/trust classification
  of existing `humanOnly` slices (review-first vs genuinely-never). On inspection the
  LIVE surface for that classification is EMPTY (the only live `humanOnly` slice was
  this one; the rest are `done/` history or out-of-scope PRDs). With the judgement
  sub-task a verified no-op, what remains is mechanical + gate-verifiable (narrow the
  predicate, shift the slicer heuristic, document the modes), so the slice is
  agent-buildable. The guard was not removed blindly — it was removed because the work
  it guarded has no live judgement surface. (If that surface becomes non-empty, the
  reclassification reverts to human-driven — see the no-op note above.)

## Prompt

> This slice is the MECHANICAL de-overload of `humanOnly`. The per-use migration of
> existing `humanOnly` slices (the part that once needed human judgement) is a
> VERIFIED NO-OP — see `## Decisions` + the `## What to build` migration bullet; do
> not reclassify any existing slice unsupervised. Decide only the de-overloaded
> model's wording. Read
> `work/spec/staging-pool-position-gate-and-trust-model.md` (US #8, #9, #10, #11) and
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
> THE (NO-OP) MIGRATION: confirm the live migration surface is still empty
> (`grep -rl 'humanOnly: true' work/backlog/ work/in-progress/ work/needs-attention/`
> — a `done/` slice is NEVER re-homed; a `humanOnly` SPEC is out of scope). If it is
> empty (the verified state), there is nothing to migrate — do not invent a
> reclassification. If a NEW live `humanOnly` slice has appeared, do NOT reclassify
> it yourself (that is a human security judgement) — route this slice to
> needs-attention noting the new item. Keep SPEC `humanOnly` and `needsAnswers`
> exactly as they are. Update WORK-CONTRACT.md (and mirror into both `protocol/`
> copies — see this
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
