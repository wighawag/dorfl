---
title: 'do --isolated -n/auto-pick already WORKS (mirror-pool scan + sequential refetch) but its help text still says "a single named item; not for -n/auto-pick" — fix the stale doc + lock the behaviour with an explicit drain test'
slug: advance-do-isolated-autopick-and-help
spec: advance-loop
blockedBy: []
covers: []
---

## What to build

A small correctness/doc slice that makes `do --isolated`'s ISOLATED auto-pick behaviour HONEST and locked-in, so the sibling `advance --isolated` slice can mirror a verified reference rather than a stale-doc premise.

The capability is NOT missing: `do --isolated -n <x>` (and `do --isolated` with zero args, and `do --isolated <a> <b>`) ALREADY route through the mirror-side eligible-pool path. The `advance-drivers-and-gates` work REMOVED the old inline `-n`×`--remote`/`--isolated` REFUSAL once `mirror-side-eligible-pool-scan` landed, and the dispatch now sends those forms to `performDoRemoteAuto` / `performDoRemoteArgs` (`do-remote-auto.ts`). That driver is exactly the "each step in its own worktree, fetch the previous work from the arbiter first" model:

1. `ensureMirror` once up front (pool scan reads the freshest committed `main`);
2. `scanMirrorPool` over the bare hub mirror's `main` (the isolated counterpart to the in-place scan);
3. `selectPrioritised` (slices-first / `prdsFirst`, bounded by `count`);
4. a SEQUENTIAL loop over the FROZEN selected set (selected ONCE in steps 2–3, never re-scanned) where EACH per-item `performDoRemote` re-`ensureMirror`s + RE-FETCHES the SAME mirror (a fetch, never a re-clone) and runs in its own job worktree — so item N's worktree branches off a `main` that contains item N-1's merge (FRESHNESS: item N rebases onto the latest main; the selected SET does not grow, so this is not re-selection).

This is already covered by a test: `test/do-isolated.test.ts:323` ("do --isolated — -n/auto-pick now SELECTS over the mirror-side pool (refusal removed)").

The DEFECT is a stale help string. `packages/dorfl/src/cli.ts:1453` (the `do` command's `--isolated` option description) STILL says:

> "... the in-place-but-isolated form (a single named item; not for -n/auto-pick). ..."

That is contradicted by the code AND by its own test. A user reading `do --isolated --help` is told the exact thing they CAN do is unsupported. Fix the doc; add an explicit end-to-end DRAIN assertion (item N's worktree rebases onto a `main` containing item N-1's merge via the per-item refetch — FRESHNESS, two INDEPENDENT items) so the sequential-refetch contract is pinned, not just the "refusal removed" negative test.

### Why this is the blocker for `advance --isolated`

The `advance-isolated-one-shot` slice mirrors `do --isolated` onto `advance`, INCLUDING `-n`/auto-pick. It must build on the CONFIRMED-correct `do` shape (the scan + select + refetch loop) and the corrected understanding, not on the stale "single named item" help that would wrongly justify scoping `advance --isolated` to single-item-only. Land this first so the reference is honest.

## Acceptance criteria

- [ ] The `do` command's `--isolated` help text NO LONGER claims "a single named item; not for -n/auto-pick". It accurately states `--isolated` supports a single named item, multiple named items (sequential), AND `-n`/auto-pick over the mirror-side eligible-pool scan (always SEQUENTIAL; parallelism is `run`/the CI matrix). Wording mirrors the no-checkout forms' actual grammar.
- [ ] A test asserts the help/usage text does NOT contain the stale "not for -n/auto-pick" claim (a doc-drift guard, so it cannot silently regress).
- [ ] An explicit DRAIN test for `do --isolated -n` (or `do --remote -n`, the shared driver) proves the SEQUENTIAL-REFETCH FRESHNESS contract: with TWO INDEPENDENT eligible items (NOT a `blockedBy` chain — see the scope note below), the run integrates item 1 THEN item 2, and item 2's job worktree was branched off a `<arbiter>/main` that ALREADY CONTAINS item 1's merge (the per-item `ensureMirror`+refetch is load-bearing: item 2 rebases onto the latest main, not the stale pre-run main). NOTE this is NOT a one-line extension of the existing `do-isolated.test.ts:323` test: that test deliberately runs with `autoBuild` OFF so the mirror scan selects NOTHING (calm-at-rest, asserting only that the REFUSAL is gone). A real drain needs `autoBuild` ON + two genuinely buildable fixtures whose ORDER is OBSERVABLE (e.g. item 2's rebased base contains item 1's commit), so budget for a NEW fixture, not an assertion bolted onto the calm-at-rest test.
- [ ] SCOPE FENCE (do NOT over-build): the contract this proves is REFETCH FRESHNESS (item N rebases onto a main containing item N-1's merge), NOT DEPENDENCY-AWARE SCHEDULING. The pool is scanned + `selectPrioritised`'d EXACTLY ONCE up front (`do-remote-auto.ts` — `scanMirrorPool` then `selectPrioritised`, then the loop iterates the FROZEN selected set; it does NOT re-scan). So a slice that is `blockedBy:[other]` and INELIGIBLE at scan time is NEVER selected and CANNOT be drained in the same `-n` run — even if its blocker is also selected and lands first. That limitation is DELIBERATELY out of scope here (it is a separate enhancement: `work/observations/do-autopick-no-dependency-aware-scheduling.md`). The drain test MUST use two INDEPENDENT items so it tests freshness, not scheduling; do NOT "fix" the snapshot-once behaviour in this slice.
- [ ] No behaviour change to the dispatch (it already works) beyond the doc + test — this slice is correctness/honesty, not new capability. (If a real bug in the refetch loop is found while writing the drain test, fix it here and note it in `## Decisions`.)
- [ ] Tests in the repo's existing vitest style (throwaway git repos, `GIT_CONFIG_GLOBAL=/dev/null`-style isolation, temp workspace dirs, real shared dirs untouched); reuse `test/do-isolated.test.ts` / the mirror-pool-scan harness.
- [ ] No shared/global location touched outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green (this repo's gate).

## Blocked by

- None — can start immediately. The code already supports the behaviour (`do-remote-auto.ts` `performDoRemoteAuto`; the refusal was removed in `advance-drivers-and-gates`); this slice corrects the doc + pins the contract.

## Decisions (to record while building)

- Whether the `do --isolated -n` drain is genuinely sequential-refetch end-to-end — i.e. the per-item `ensureMirror`+fetch makes item N's worktree branch off a `main` that ALREADY CONTAINS item N-1's merge (FRESHNESS / rebase-onto-latest, NOT re-selection of a dependent — keep this distinction sharp; this slice does NOT touch scheduling). Confirm empirically while writing the drain test; if the refetch is somehow short-circuited so item N rebases onto a STALE pre-run main, that IS a bug to fix here (record it).

## Prompt

> Fix a STALE help string and pin a real contract: dorfl's `do --isolated` ALREADY supports `-n`/auto-pick/multi-arg over the mirror-side eligible-pool scan (the old `-n`×`--isolated`/`--remote` refusal was removed in `advance-drivers-and-gates` once `mirror-side-eligible-pool-scan` landed; the forms now route through `performDoRemoteAuto`/`performDoRemoteArgs` in `do-remote-auto.ts`, with each per-item `performDoRemote` re-`ensureMirror`+RE-FETCHING the same mirror so item N's worktree branches off a `main` containing item N-1's merge — FRESHNESS, each in its own job worktree; the selected SET is frozen up front, so this is not re-selection). But the `--isolated` option's help text at `packages/dorfl/src/cli.ts:1453` STILL says "a single named item; not for -n/auto-pick" — contradicted by the code AND by `test/do-isolated.test.ts:323` ("refusal removed"). Fix the doc and lock the sequential-refetch contract with an explicit drain test.
>
> FIRST, re-confirm against CURRENT code (drift): the `do` `--isolated` dispatch still routes `args.length===0 || count!==undefined` and `args.length>1` into `performDoRemoteAuto`/`performDoRemoteArgs` (the `isolatedNoRemote`/`--remote` shared block in `cli.ts` ~1721); `do-remote-auto.ts` still does `ensureMirror` once + `scanMirrorPool` + `selectPrioritised` + a sequential loop with per-item `performDoRemote` (which re-ensures/fetches the mirror); `cli.ts:1453` still carries the stale "not for -n/auto-pick" text. If it landed differently, reconcile or route to `needs-attention/`.
>
> BUILD: (1) correct the `--isolated` help text so it accurately describes single + multi + `-n`/auto-pick (always SEQUENTIAL; parallelism is `run`/the CI matrix), mirroring the no-checkout grammar; (2) add a doc-drift guard test asserting the stale "not for -n/auto-pick" phrasing is gone; (3) add (or extend) an explicit DRAIN test proving `do --isolated -n` over TWO INDEPENDENT items integrates item 1 THEN item 2 with item 2's worktree branched off a main that ALREADY CONTAINS item 1's merge (per-item `ensureMirror`+refetch — the FRESHNESS contract). DO NOT use a `blockedBy` chain: the pool is scanned + selected ONCE up front (`do-remote-auto.ts`) and the loop never re-scans, so a dependent that is ineligible at scan time is never selected — that is DEPENDENCY-AWARE SCHEDULING, a SEPARATE out-of-scope enhancement (`work/observations/do-autopick-no-dependency-aware-scheduling.md`), NOT this slice. No dispatch behaviour change beyond doc+test unless the drain test exposes a real refetch bug (then fix it here, record in `## Decisions`).
>
> TEST (TDD, vitest, house style — throwaway git repos, `GIT_CONFIG_GLOBAL=/dev/null`-style isolation, temp workspace dirs, real shared dirs untouched; reuse `test/do-isolated.test.ts` + the mirror-pool-scan harness).
>
> "Done" = the corrected `--isolated` help, the doc-drift guard, the sequential-refetch drain test, and the gate green.
