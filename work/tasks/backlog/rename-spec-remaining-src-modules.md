---
title: prd→spec batch 4 — remaining src modules (ledger, tasking, scan, close-job, prd-complete rename, prompts)
slug: rename-spec-remaining-src-modules
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-config-and-intake]
covers: [1]
---

## What to build

The BULK migrate batch: rename `prd` identifiers across the remaining `packages/dorfl/src` modules that were not owned by batches 1–3, plus the coupled tests. This is the largest single batch (~85 remaining src files with `prd`, ~100 test files); if it proves too big to land green in one context window, SPLIT it at file/module boundaries into `rename-spec-remaining-src-modules-a/-b/…` each `blockedBy` batch 3, keeping each green — that split is itself the §3a batch discipline.

High-density modules to cover (from the blast-radius scan): `intake.ts` residuals, `ledger-read.ts`, `tasking.ts`, `scan.ts`, `do.ts`, `advance.ts`, `close-job.ts` (incl. the `via: 'prd'` discriminated-union tag — note the mirror-image `via: 'brief'` leftover this cutover exists to avoid), `needs-attention.ts`, `lifecycle-gather.ts`, `prompt.ts`, `select-priority.ts`, `tasking-lock.ts`, `integration-core.ts`, `triage-persist.ts`, `item-lock.ts`, `do-autopick.ts`, `advance-drivers.ts`, `prd-complete.ts` (rename the FILE `prd-complete.ts → spec-complete.ts` + its symbols `renderPrdBody`, `PrdTask`, etc.), and every remaining `Prd*`/`*Prd*` symbol.

FILE renames (git mv, with their test siblings): `prd-complete.ts → spec-complete.ts`, `prd-complete.test.ts → spec-complete.test.ts`, `pre-prd-staging-and-promote.test.ts → pre-spec-…`, `tasked-prd-needsanswers-lifecycle.test.ts → tasked-spec-…`.

Keep the gate green; update each module's coupled tests in the SAME batch as the module. Because batches 1–3 already renamed the shared identity (layout, frontmatter, namespace, config), most of these are mechanical symbol renames with no cross-batch conflict.

## Acceptance criteria

- [ ] Every remaining `prd`/`Prd`/`PRD` identifier in `packages/dorfl/src` renamed to the `spec` spelling; `prd-complete.ts` + test siblings `git mv`'d and their symbols renamed.
- [ ] The coupled tests for each renamed module updated in this batch (or its sub-batches).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] A forward grep for a live `prd`/`Prd`/`PRD` code identifier in `packages/dorfl/src` returns only intentional survivors (provenance strings, historical references) — the exhaustive leak scan is batch 5's gate, but this batch should leave essentially nothing.

## Blocked by

- rename-spec-config-and-intake (shared identity — layout/frontmatter/namespace/config — is already renamed, so these are conflict-free symbol renames).

## Prompt

> Goal: rename all remaining `prd` identifiers across `packages/dorfl/src` (and their coupled tests) to `spec`, after batches 1–3 renamed the shared identity. Migrate-batch 4 (the bulk) of the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command` (read it + `TASKING-PROTOCOL.md` §3a). If too large for one context window, SPLIT at module boundaries into sub-batches each `blockedBy` batch 3 and keep each green — that IS the batch discipline.
>
> Domain vocabulary: after batches 1–3, `spec` is already the folder/frontmatter/namespace/config word; this batch propagates it through the remaining modules (ledger, tasking, scan, do, advance, close-job, prompts, `prd-complete.ts → spec-complete.ts`, etc.). Watch for `prd` inside discriminated-union tags (`via: 'prd'` in close-job.ts) — those are LIVE code, exactly the kind of thing the `via: 'brief'` leftover proves a sweep can miss.
>
> Where to look: grep `packages/dorfl/src` for `prd`/`Prd`/`PRD`; rename symbols + `git mv` the `prd-*` files with their tests; update each module's tests in the same batch.
>
> Done means: no live `prd` code identifier remains in `src` (only intentional provenance survivors), coupled tests updated, full gate green.
>
> FIRST check drift: confirm batches 1–3 landed; if a shared symbol is still `prd`, that batch has not landed and this one should wait.
