---
title: The C-audit conflated VALUE aliases with SYMBOL aliases — exported Spec* TS symbols have no alias and must be renamed atomically (4a re-scoped)
date: 2026-07-09
needsAnswers: true
---

## What happened

The `do` agent building `rename-spec-remaining-src-modules-a` STOPPED with a correct diagnosis that exposed a flaw in the C-audit (the "every remaining batch is independently green via the alias" audit). Batch 4a instructed an outright rename of EXPORTED `Spec*` symbols (`LedgerPrdPool`, `resolvePrdPool`, `taskablePrds`, `PrdCandidate`, `resolvePrdExistence`, `scorePrds`, …) and asserted it "additive-migrates, stays green in isolation." It cannot: these symbols have NO alias, and their importers span ~14 files owned by no single sub-batch (`index.ts` re-exports, `mirror-pool-scan.ts`, `slug-namespace.ts`, `lifecycle-gather.ts` (b), `do-autopick.ts`/`advance-drivers.ts` (c)). An outright rename of an exported symbol breaks `pnpm -r build` at every importer immediately.

## The lesson (the C-audit's blind spot)

The C-audit reasoned "the `spec` alias makes every migrate batch green." That is TRUE for VALUE aliases and FALSE for SYMBOL aliases:

- **VALUE aliases (what the expand tasks built):** `parseFrontmatter` populates both `fm.spec`/`fm.spec`; `SlugNamespace`/lock accept both `spec:`/`prd:`; config reads both `specsLandIn`/`prdsLandIn`; intake accepts both `'spec'`/`'spec'`. A consumer reading a VALUE (`namespace === 'spec'`) keeps working because BOTH values are valid — so a value-consumer switch can be widened `|| === 'spec'` in isolation, green.
- **SYMBOL aliases (never built, and correctly NOT built):** a renamed exported TS symbol (`LedgerPrdPool`) has no dual form — the old NAME simply stops existing, breaking every importer. Aliasing it (`export type LedgerPrdPool = LedgerSpecPool`) would (1) be an unratified new surface, (2) leak past the contract task's `spec` leak scan, (3) still not cover importers owned by no sub-batch.

So: value tokens migrate incrementally (alias covers the gap); exported symbols must be renamed ATOMICALLY (definition + all importers in one commit). The two are different migration mechanics, and the file-orthogonal a/b/c split only works for the value-consumer layer, not the exported-symbol layer.

## The fix (agent Option B, minimal)

Re-scoped 4a to be the ATOMIC exported-symbol rename: every `Spec*` export + all ~14 importers in one green shot, no alias. 4b (file-LOCAL `prdCandidates` const + `via:'brief'` sweep + doc-comments) and 4c (value-consumer switches + verb dispatch + the `spec-complete.ts → spec-complete.ts` FILE rename, which is atomic-by-file-move) are already safe and stay as-is. Serialized 4a → 4b → 4c because 4a's symbol edits share files (`tasking.ts`, `lifecycle-gather.ts`, `do-autopick.ts`, `advance-drivers.ts`) with 4b/4c's value-switch edits — driving 4a first lets b/c rebase cleanly.

## Why the review + audit missed it

The `review` skill and the C-audit both checked "does the batch stay green" but assumed a uniform alias mechanism. The missing lens: DISTINGUISH value-migration (incremental, alias-covered) from symbol/type/file-identity migration (atomic, no alias) — they have opposite green-in-isolation properties. For a rename cutover, classify each identifier: is it a VALUE (aliasable) or a NAME (must move atomically with its blast radius)?

## Provenance

Agent STOP diagnosis, verified @ 1d6047d9: `taskablePrds` in 8 files, `resolvePrdPool` in 6, `PrdCandidate` in 5; 14 distinct src files import a `Spec*` exported symbol (grep).
