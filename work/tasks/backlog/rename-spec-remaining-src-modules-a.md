---
title: prd→spec batch 4a — ledger/tasking/scan/select-priority Prd* symbols + pool identifiers
slug: rename-spec-remaining-src-modules-a
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-config-and-intake]
covers: [1]
---

## What to build

Sub-batch (a) of the split bulk migrate (§3a): migrate the `Prd*` symbols + `prd` identifiers in the LEDGER/TASKING/SELECTION modules onto `spec`. Additive-migrate — the `prd` alias (from the expand tasks) still resolves for anything not touched here, so this stays green in isolation.

Scope (this batch's files ONLY): `ledger-read.ts`, `tasking.ts` (the residual `Prd*` symbols NOT already migrated by batch 2's fm-read/branch/lock work), `scan.ts`, `select-priority.ts`, and their coupled tests. Rename the `Prd*` symbols: `LedgerPrdItem → LedgerSpecItem`, `LedgerPrdPool → LedgerSpecPool`, `resolvePrdPool → resolveSpecPool`, `resolveMirrorPrdPool → resolveMirrorSpecPool`, `PrdExistence`/`resolvePrdExistence → Spec…`, `taskablePrds → taskableSpecs`, `scorePrds → scoreSpecs`, `prdCandidate(s) → specCandidate(s)` where they live in these files, the `.prds` pool field, `prdsFirst`, `prdPool`, etc. Migrate `namespace === 'prd'` CONSUMER switches in `scan.ts`/`select-priority.ts` to also match `'spec'` (add `|| === 'spec'` beside `'prd'`, keeping `'prd'` working).

Do NOT touch the deliberate alias surface (`PrdsLandIn`/`prdsLandIn`/`--prds-land-in` config, the `'prd'` namespace/artifact-type acceptance, `PRD_PREFIX`) — the contract task removes those. Do NOT touch files owned by sub-batches (b)/(c) (close-job, do*, advance*, prompt, prd-complete). Where a file is shared, touch only this batch's symbols.

## Acceptance criteria

- [ ] `Prd*` symbols in `ledger-read.ts`/`tasking.ts`/`scan.ts`/`select-priority.ts` renamed to `Spec*`; `namespace === 'prd'` consumer switches in these files also match `'spec'`.
- [ ] Coupled tests for these modules updated in this batch.
- [ ] The deliberate `prd` alias surface is UNTOUCHED (contract task owns removal); files owned by sub-batches (b)/(c) untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green (the `prd` alias covers un-migrated occurrences elsewhere).

## Blocked by

- rename-spec-config-and-intake (the shared identity — layout/frontmatter/namespace/config — is renamed; the `prd` alias is present so this stays green).

## Prompt

> Goal: sub-batch (a) of the split bulk migrate (read `work/protocol/TASKING-PROTOCOL.md` §3a + the parent spec `work/specs/tasked/prd-to-spec-vocabulary-cutover-and-migration-command.md`). Rename the `Prd*` symbols + `prd` identifiers in the LEDGER/TASKING/SELECTION modules (`ledger-read.ts`, `tasking.ts` residuals, `scan.ts`, `select-priority.ts`) onto `spec`, plus their coupled tests. Additive-migrate: the `prd` alias from the expand tasks still resolves elsewhere, so this stays green in isolation.
>
> Scope: rename `LedgerPrdItem`/`LedgerPrdPool`/`resolvePrdPool`/`resolveMirrorPrdPool`/`PrdExistence`/`resolvePrdExistence`/`taskablePrds`/`scorePrds`/`.prds`/`prdsFirst`/`prdPool` and peers in THESE files; add `|| === 'spec'` beside `namespace === 'prd'` switches in scan/select-priority. Do NOT touch the alias surface (`prdsLandIn`, `'prd'` namespace/artifact-type acceptance, `PRD_PREFIX` — contract task removes them) or sub-batch (b)/(c) files (close-job, do*, advance*, prompt, prd-complete).
>
> Done means: these four modules' `Prd*` symbols are `Spec*`, consumers match `spec`, coupled tests green, full gate green. FIRST check drift: confirm `rename-spec-config-and-intake` landed and the expand aliases are present (a `prd` symbol you rename must still resolve elsewhere via the alias).
