---
title: STEP A for PRDs — pre-prd/ staging + runner-deterministic PRD placement (prd/ stays the pool)
slug: pre-prd-staging-pool-split-and-untrusted-prd-placement
spec: staging-pool-position-gate-and-trust-model
blockedBy: [runner-deterministic-slice-placement-policy-and-precedence]
covers: [2, 6, 12, 14]
---

## What to build

The PRD-lifecycle MIRROR of the slice staging/pool split, done as a SYMMETRIC
STEP-A baby-step (matching the maintainer's decision): introduce a `work/pre-prd/`
STAGING folder while `work/prd/` KEEPS meaning the auto-slice POOL — so the
existing PRD readers (the auto-slice candidate pool, `sliceAfter` resolution) are
unchanged and EXISTING PRDs in `work/prd/` are left exactly as they are. The new
behaviour:

1. **`intake`-authored and untrusted-origin PRD output lands STAGED in
   `pre-prd/`,** not in the auto-slice pool, so it is not auto-sliceable the moment
   an agent writes it. Placement is the SAME runner-deterministic precedence the
   slice slice built (`explicit operator flag > untrusted-origin forces staging >
   configured default > built-in`), with a per-lifecycle default `prdsLandIn: prd |
   pre-prd` resolved like `slicesLandIn`. Reuse that resolver — do not fork it.
2. **A runner/human-owned `pre-prd → prd` PROMOTION** moves a staged PRD into the
   auto-slice pool (a durable `main` move, mirroring the slice `pre-backlog →
   backlog` promotion). An agent path CANNOT perform it.
3. **`sliceAfter` / `blockedBy` resolution is UNCHANGED** — still resolved against
   `work/spec-sliced/` / `work/done/` residence respectively. This split changes only
   WHICH folder is the eligible/auto-slice pool, not dependency resolution
   (PRD US #14); add a check that proves it.

Do NOT rename `prd/` → `prd-ready/` (that is the STEP-B taxonomy rename, deferred).
Here `prd/` stays the pool and `pre-prd/` is the new staging neighbour, symmetric
with the slice STEP A.

## Acceptance criteria

- [ ] A `work/pre-prd/` staging folder exists; `intake`/untrusted-origin PRD output
      that the policy/trust routes to staging lands there, NOT in `work/prd/`.
- [ ] `work/prd/` STILL means the auto-slice pool: the auto-slice candidate pool and
      `sliceAfter` resolution read `work/prd/` / `work/spec-sliced/` and behave
      byte-for-byte as before; existing PRDs in `work/prd/` are untouched.
- [ ] A staged PRD in `pre-prd/` is NOT in the auto-slice pool (never auto-sliced)
      until promoted; the runner/human-owned `pre-prd → prd` promotion makes it
      sliceable; an agent cannot perform the promotion.
- [ ] PRD placement reuses the slice slice's runner-deterministic precedence +
      resolver (`prdsLandIn` resolved like `slicesLandIn`); the untrusted-origin
      force and the explicit-flag override both hold for PRDs.
- [ ] `sliceAfter` (against `prd-sliced/`) and `blockedBy` (against `done/`)
      resolution is unchanged — proven by a test.
- [ ] Tests use the `--bare file://` arbiter house pattern; no real environment
      touched. Acceptance gate green:
      `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `runner-deterministic-slice-placement-policy-and-precedence` — reuses its
  runner-deterministic placement resolver (and shares the slicing/config/intake
  modules, so serialized).

## Prompt

> Add the PRD-lifecycle staging/pool split as a SYMMETRIC STEP-A baby-step: a
> `work/pre-prd/` staging folder while `work/prd/` KEEPS meaning the auto-slice
> pool. Read `work/prd/staging-pool-position-gate-and-trust-model.md` (US #2, #6,
> #12, #14) and the governing ADR. First check for drift: the placement-precedence
> slice (`runner-deterministic-slice-placement-policy-and-precedence`) must be in
> `done/` — you REUSE its resolver. If it landed differently, route to
> `needs-attention/` (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> WHERE TO LOOK: `intake` authors PRDs and writes them to `work/prd/<slug>.md`
> (`src/intake.ts` — the `prd` verdict emit path, and its per-emitted-type
> integration resolver). Route the PRD emit destination through the SAME
> runner-deterministic placement resolver the slice slice built (do NOT fork it):
> add a `prdsLandIn: prd | pre-prd` default resolved per-repo like `slicesLandIn`
> in `src/config.ts`, and apply the precedence `explicit operator flag >
> untrusted-origin ⇒ staging > prdsLandIn default > built-in` from the PRD's
> `originTrust:` stamp. The auto-slice POOL READERS to leave UNCHANGED read
> `work/prd/` + resolve `sliceAfter` against `work/spec-sliced/` residence
> (`src/ledger-read.ts`, `src/slicing.ts readSlicedSlugs`, the mirror PRD pool,
> `src/select-priority.ts`). The promotion verb mirrors the slice `pre-backlog →
> backlog` promotion: a runner/human-owned `work/pre-prd/<slug>.md →
> work/prd/<slug>.md` durable `main` move; no agent path performs it.
>
> Keep `prd/` as the pool name — do NOT rename to `prd-ready/` (the STEP-B taxonomy
> rename is deferred to `work/prd/folder-taxonomy-reorg-and-rename.md`).
>
> SEAMS TO TEST AT: the `--bare file://` arbiter house pattern
> (`test/helpers/gitRepo.ts`). Prove staged PRDs are not auto-sliced, the promotion
> makes them sliceable, the agent cannot promote, and `sliceAfter`/`blockedBy`
> resolution is unchanged.
>
> "DONE" = the acceptance criteria hold and
> `pnpm -r build && pnpm -r test && pnpm format:check` is green (`pnpm format` to
> fix formatting). Do NOT commit or move work/ files — the runner owns git. Record
> the `prdsLandIn` key + any reuse-vs-fork decision on the resolver as a `##
> Decisions` note (or an ADR if it meets the gate).
