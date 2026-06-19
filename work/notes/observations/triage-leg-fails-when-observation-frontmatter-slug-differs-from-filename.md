---
title: a propose-matrix obs:<slug> triage leg FAILS ("could not find its item file") when the observation's frontmatter slug differs from its filename — enumerate (frontmatter-slug) and resolve (filename-only) disagree
type: observation
status: spotted
spotted: 2026-06-17
slug: triage-leg-fails-when-observation-frontmatter-slug-differs-from-filename
---

## What was seen

The newly-landed CI lifecycle propose matrix (`ci-propose-matrix-enumerates-lifecycle-items`) ran ~33 parallel legs and MANY `obs:<slug>` triage legs failed with:

```
error: advance classified the 'triage' rung for observation:<slug> but could not
find its item file under work/ — a human must reconcile the item's location.
(exit 1)
```

Examples (all FAILED): `obs:advance-in-place-publishes-treeless-results`,
`obs:install-ci-core-and-github-adapter`,
`obs:continue-rebase-auto-resolves-protocol-bookkeeping-conflicts`,
`obs:install-ci-build-slice-tick-workflow`,
`obs:install-ci-emits-no-gate-env-let-config-decide`,
`obs:install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick`.

## Root cause (VERIFIED against the code, 2026-06-17)

The triage ENUMERATE and RESOLVE halves key the observation slug DIFFERENTLY:

- **Enumerate** (`readLocalObservations` / `readMirrorObservations` in `src/ledger-read.ts` ~L380): resolves the slug as `fm.slug ?? basename(file, '.md')` — **frontmatter `slug:` WINS over filename**. The scan lifecycle pool (`src/scan.ts` → `gatherLifecycle*` → `buildLifecyclePools`) emits THAT slug into the matrix as `obs:<slug>`.
- **Resolve** (`findItemPath` in `src/advance.ts` ~L718): looks ONLY for `work/observations/<slug>.md` by FILENAME (`existsSync`), never consulting frontmatter.

So when an observation file's frontmatter slug differs from its filename, the matrix emits `obs:<frontmatter-slug>` but `findItemPath` then searches `work/observations/<frontmatter-slug>.md`, which does not exist → fail. This is reachable on the AUTO disposition path (`observationTriage: 'auto'`, the triage rung's `findItemPath` call at `advance.ts` ~L568) and the same find pattern guards the surface/apply rungs (~L475/~L637).

## Why it surfaced NOW (not my slice's bug — it EXPOSED a latent one)

`ci-propose-matrix-enumerates-lifecycle-items` did not introduce the mismatch; it routed the triage pool through the CI propose matrix at 33-way scale, so a pre-existing slug-keying inconsistency that was rarely hit via `advance -n`/`run` now fires loudly and in bulk.

## The specific data trigger (see the sibling observation)

Every failing slug is a `review-nits-*` observation whose frontmatter `slug:` is the REVIEWED SLICE's slug (now in `work/done/`), not its own filename — see `work/observations/review-nits-observation-slug-collides-with-reviewed-done-slice.md`. That data defect is the trigger; THIS observation is the CODE defect (the two halves must agree, and a non-resolvable triage leg should SKIP gracefully, not exit 1 and demand a human).

## Why it matters / suggested fix shape (decide when slicing)

A triage leg that cannot resolve its own file should NOT be a hard exit-1 "a human must reconcile" — at 33-way matrix scale that is a wall of red for a calm, expected condition. Two coordinated fixes:

1. **Make enumerate + resolve agree on the slug key.** Either `findItemPath` resolves observations by frontmatter-slug too (a `findObservationFileBySlug` mirroring `findPrdFileBySlug`), OR the enumerator emits the FILENAME-derived slug. Pick one and make the round-trip total. (Filename-as-identity is the simpler invariant and matches slices.)
2. **An unresolvable lifecycle leg should be a benign SKIP, not exit 1.** A slug that resolved at enumerate-time but vanished/relocated by run-time (the cross-tick window) is expected under parallelism; classify it as a no-op skip, not a needs-human error.

Also note the CONTENTION nuisance seen in the same run (separate issue): many legs hit `push rejected N times (main is contended)` (exit 3) under 33-way parallel CAS to `main` — transient, re-run clears it, but the retry/backoff budget is thin for that parallelism.

## Refs

- `src/ledger-read.ts` `readLocalObservations`/`readMirrorObservations` (slug = `fm.slug ?? basename`).
- `src/advance.ts` `findItemPath` (~L718, filename-only), triage rung (~L568), surface (~L475), apply (~L637).
- `src/scan.ts` lifecycle pool + `src/lifecycle-gather.ts` (the enumerate path my slice wired to CI).
- Minting site of the trigger data: `src/integration-core.ts` ~L1697.
