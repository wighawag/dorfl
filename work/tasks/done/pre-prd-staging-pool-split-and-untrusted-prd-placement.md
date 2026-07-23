---
title: 'STEP A for PRDs — pre-spec/ staging + runner-deterministic SPEC placement (spec/ stays the pool)'
slug: pre-prd-staging-pool-split-and-untrusted-prd-placement
spec: staging-pool-position-gate-and-trust-model
blockedBy: [runner-deterministic-slice-placement-policy-and-precedence]
covers: [2, 6, 12, 14]
---

## What to build

The SPEC-lifecycle MIRROR of the slice staging/pool split, done as a SYMMETRIC
STEP-A baby-step (matching the maintainer's decision): introduce a `work/pre-spec/`
STAGING folder while `work/spec/` KEEPS meaning the auto-slice POOL — so the
existing SPEC readers (the auto-slice candidate pool, `sliceAfter` resolution) are
unchanged and EXISTING PRDs in `work/spec/` are left exactly as they are. The new
behaviour:

1. **`intake`-authored and untrusted-origin SPEC output lands STAGED in
   `pre-spec/`,** not in the auto-slice pool, so it is not auto-sliceable the moment
   an agent writes it. Placement is the SAME runner-deterministic precedence the
   slice slice built (`explicit operator flag > untrusted-origin forces staging >
   configured default > built-in`), with a per-lifecycle default `prdsLandIn: spec |
   pre-spec` resolved like `slicesLandIn`. Reuse that resolver — do not fork it.
2. **A runner/human-owned `pre-spec → spec` PROMOTION** moves a staged SPEC into the
   auto-slice pool (a durable `main` move, mirroring the slice `pre-backlog →
   backlog` promotion). An agent path CANNOT perform it.
3. **`sliceAfter` / `blockedBy` resolution is UNCHANGED** — still resolved against
   `work/spec-sliced/` / `work/done/` residence respectively. This split changes only
   WHICH folder is the eligible/auto-slice pool, not dependency resolution
   (SPEC US #14); add a check that proves it.

Do NOT rename `spec/` → `spec-ready/` (that is the STEP-B taxonomy rename, deferred).
Here `spec/` stays the pool and `pre-spec/` is the new staging neighbour, symmetric
with the slice STEP A.

## Acceptance criteria

- [ ] A `work/pre-spec/` staging folder exists; `intake`/untrusted-origin SPEC output
      that the policy/trust routes to staging lands there, NOT in `work/spec/`.
- [ ] `work/spec/` STILL means the auto-slice pool: the auto-slice candidate pool and
      `sliceAfter` resolution read `work/spec/` / `work/spec-sliced/` and behave
      byte-for-byte as before; existing PRDs in `work/spec/` are untouched.
- [ ] A staged SPEC in `pre-spec/` is NOT in the auto-slice pool (never auto-sliced)
      until promoted; the runner/human-owned `pre-spec → spec` promotion makes it
      sliceable; an agent cannot perform the promotion.
- [ ] SPEC placement reuses the slice slice's runner-deterministic precedence +
      resolver (`prdsLandIn` resolved like `slicesLandIn`); the untrusted-origin
      force and the explicit-flag override both hold for PRDs.
- [ ] `sliceAfter` (against `spec-sliced/`) and `blockedBy` (against `done/`)
      resolution is unchanged — proven by a test.
- [ ] Tests use the `--bare file://` arbiter house pattern; no real environment
      touched. Acceptance gate green:
      `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `runner-deterministic-slice-placement-policy-and-precedence` — reuses its
  runner-deterministic placement resolver (and shares the slicing/config/intake
  modules, so serialized).

## Prompt

> Add the SPEC-lifecycle staging/pool split as a SYMMETRIC STEP-A baby-step: a
> `work/pre-spec/` staging folder while `work/spec/` KEEPS meaning the auto-slice
> pool. Read `work/spec/staging-pool-position-gate-and-trust-model.md` (US #2, #6,
> #12, #14) and the governing ADR. First check for drift: the placement-precedence
> slice (`runner-deterministic-slice-placement-policy-and-precedence`) must be in
> `done/` — you REUSE its resolver. If it landed differently, route to
> `needs-attention/` (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> WHERE TO LOOK: `intake` authors PRDs and writes them to `work/spec/<slug>.md`
> (`src/intake.ts` — the `spec` verdict emit path, and its per-emitted-type
> integration resolver). Route the SPEC emit destination through the SAME
> runner-deterministic placement resolver the slice slice built (do NOT fork it):
> add a `prdsLandIn: spec | pre-spec` default resolved per-repo like `slicesLandIn`
> in `src/config.ts`, and apply the precedence `explicit operator flag >
> untrusted-origin ⇒ staging > prdsLandIn default > built-in` from the SPEC's
> `originTrust:` stamp. The auto-slice POOL READERS to leave UNCHANGED read
> `work/spec/` + resolve `sliceAfter` against `work/spec-sliced/` residence
> (`src/ledger-read.ts`, `src/slicing.ts readSlicedSlugs`, the mirror SPEC pool,
> `src/select-priority.ts`). The promotion verb mirrors the slice `pre-backlog →
> backlog` promotion: a runner/human-owned `work/pre-spec/<slug>.md →
> work/spec/<slug>.md` durable `main` move; no agent path performs it.
>
> Keep `spec/` as the pool name — do NOT rename to `spec-ready/` (the STEP-B taxonomy
> rename is deferred to `work/spec/folder-taxonomy-reorg-and-rename.md`).
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
