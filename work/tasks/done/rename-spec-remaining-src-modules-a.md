---
title: spec→spec batch 4a — ATOMIC rename of every exported Spec* symbol + all its importers (one green shot, no alias)
slug: rename-spec-remaining-src-modules-a
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-config-and-intake]
covers: [1]
---

## What to build

Rename every EXPORTED `Spec*` TypeScript symbol to `Spec*`, together with EVERY importer, in ONE atomic change. Unlike the value tokens (frontmatter field, namespace, config key, artifact type — which the expand tasks dual-aliased so `prd:`/`spec:` both work during migration), these are INTERNAL TS exports with NO external contract and NO alias: an exported symbol must be renamed at its definition AND every import site in the same commit or the build breaks. There is nothing to alias and no reason to — just flip them all at once.

Rename these exported symbols (definition + all importers): `LedgerPrdItem → LedgerSpecItem`, `LedgerPrdPool → LedgerSpecPool`, `resolvePrdPool → resolveSpecPool`, `resolveMirrorPrdPool → resolveMirrorSpecPool`, `PrdExistence → SpecExistence`, `resolvePrdExistence → resolveSpecExistence`, `taskablePrds → taskableSpecs`, `TaskablePrdsInput → TaskableSpecsInput`, `scorePrds → scoreSpecs`, `PrdCandidate → SpecCandidate`, `ScannedPrd → ScannedSpec`. `renderPrdBody`/`PrdTask` are OWNED BY 4c (they ride the `spec-complete.ts → spec-complete.ts` file rename) — do NOT touch them here. Grep `packages/dorfl/src` for each symbol and rename every occurrence, including re-exports in `index.ts` and the importers `ledger-read.ts`, `scan.ts`, `select-priority.ts`, `mirror-pool-scan.ts`, `slug-namespace.ts` (`resolvePrdExistence`), `tasking.ts`, `lifecycle-gather.ts`, `do-autopick.ts`, `advance-drivers.ts`, and any others grep finds. Update every coupled test that references a renamed symbol.

This is ONE atomic task (not file-orthogonal) BECAUSE the exported symbols' blast radius crosses ~14 files with no per-file alias — the only way it lands green is to fix every site together. Do NOT introduce a symbol-level alias (`export type LedgerPrdPool = LedgerSpecPool`) — that would leak past the contract task's `spec` leak scan and is unnecessary; just rename atomically.

Do NOT touch: the deliberate VALUE alias surface (`prdsLandIn`/`--specs-land-in`, the `'spec'` namespace/artifact-type acceptance, `PRD_PREFIX` — contract task removes those); the `namespace === 'spec'` value-consumer switches owned by 4b/4c; the `brief` remnants (4b); the `spec-complete.ts` file + `renderPrdBody`/`PrdTask` (4c).

## Acceptance criteria

- [ ] Every exported `Spec*` symbol listed above renamed to `Spec*` at its definition AND every importer (incl. `index.ts` re-exports, `mirror-pool-scan.ts`, `slug-namespace.ts`); grep confirms no importer still references the old name.
- [ ] `renderPrdBody`/`PrdTask`/`spec-complete.ts` NOT touched (4c owns them); the value alias surface NOT touched (contract task); `brief` remnants NOT touched (4b).
- [ ] NO symbol-level alias introduced (atomic rename, not expand-beside).
- [ ] Coupled tests referencing renamed symbols updated.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- rename-spec-config-and-intake (shared value identity renamed; this is the exported-SYMBOL rename layer, atomic). NOTE: file-overlaps 4b/4c on `tasking.ts`/`lifecycle-gather.ts`/`do-autopick.ts`/`advance-drivers.ts` (this touches the SYMBOL import there; 4b/4c touch the value-consumer switch), so 4b and 4c are `blockedBy` THIS task to serialize the shared-file edits. (Sequence: 4a → 4b → 4c.)

## Prompt

> Goal: rename EVERY exported `Spec*` TypeScript symbol to `Spec*` — definition AND all importers — in ONE atomic change (read `work/protocol/TASKING-PROTOCOL.md` §3a + the parent spec `work/specs/tasked/prd-to-spec-vocabulary-cutover-and-migration-command.md`). These are internal exports with NO alias (unlike the value tokens the expand tasks dual-aliased), so they must flip at the definition and every import site together or the build breaks. Do NOT introduce a symbol alias; just rename atomically.
>
> Symbols: `LedgerPrdItem`, `LedgerPrdPool`, `resolvePrdPool`, `resolveMirrorPrdPool`, `PrdExistence`, `resolvePrdExistence`, `taskablePrds`, `TaskablePrdsInput`, `scorePrds`, `PrdCandidate`, `ScannedPrd` (→ `Spec*`). NOT `renderPrdBody`/`PrdTask` (4c owns them via the `spec-complete.ts → spec-complete.ts` file rename). Grep `packages/dorfl/src` for each; fix `index.ts` re-exports + importers (`ledger-read`, `scan`, `select-priority`, `mirror-pool-scan`, `slug-namespace`, `tasking`, `lifecycle-gather`, `do-autopick`, `advance-drivers`, …). Update coupled tests.
>
> Do NOT touch: the value alias surface (`prdsLandIn`, `'spec'` namespace/artifact-type, `PRD_PREFIX` — contract task); the `namespace === 'spec'` value-consumer switches (4b/4c); the `brief` remnants (4b); `spec-complete.ts` (4c).
>
> Done means: every `Spec*` export is `Spec*` with no dangling importer, coupled tests green, full gate green. This is driven BEFORE 4b/4c. FIRST check drift: confirm `rename-spec-config-and-intake` landed.
