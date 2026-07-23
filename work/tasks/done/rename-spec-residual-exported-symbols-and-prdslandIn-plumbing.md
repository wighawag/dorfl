---
title: 'spec→spec batch 4e — atomic rename of the residual exported Spec* symbols + complete the PrdsLandIn internal plumbing migration'
slug: rename-spec-residual-exported-symbols-and-prdslandIn-plumbing
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-namespace-emit-sites-and-local-unions]
covers: [1]
---

## What to build

The SECOND missing migrate sub-batch the C-audit dropped (see `work/notes/observations/contract-spec-blocked-by-untasked-residual-prd-exported-symbols-2026-07-10.md`). Batch 4a curated an EXPLICIT exported-symbol list and 4c owned `renderPrdBody`/`PrdTask`, but ~5 exported `Spec*` symbols were on NEITHER list, and batch 3 left the `PrdsLandIn` INTERNAL plumbing un-migrated (it only added the `specsLandIn` config KEY + `SpecsLandIn` type alias beside the still-primary `spec*` internals). These are genuine exported CODE IDENTIFIERS the contract task's forward leak scan MUST flag, so they must migrate BEFORE the contract task.

Two pieces, both value-migration-safe / atomic-by-symbol per §3a.

### Piece 1 — ATOMIC exported-symbol rename (like 4a: definition + every importer + re-export + coupled tests, ONE green commit, NO alias)

Exported symbols have no dual-form alias — rename each definition AND all importers AND any `index.ts` re-export atomically:

- `renderPrd` (`intake.ts:1659`) → `renderSpec` (distinct from the 4c-renamed `renderPrdBody`; ~4 importers).
- `buildIntakeDecisionPrd` (`intake.ts:2319`) → `buildIntakeDecisionSpec` — **also update the `index.ts:408` re-export** (public package surface; ~3 importers).
- `findPrdPath` (`prompt.ts:695`) → `findSpecPath` (~2 importers).
- `promoteFromPrePrd` / `PromoteFromPrePrdOptions` / `PromoteFromPrePrdResult` (`needs-attention.ts:877/890/899`) → `promoteFromPreSpec` / `PromoteFromPreSpecOptions` / `PromoteFromPreSpecResult` (~6 importers).

Update every coupled test that imports/asserts these names. (Grep each symbol across `src` + `test` first; rename all in one commit so `pnpm -r build` never breaks.)

### Piece 2 — complete the `PrdsLandIn` INTERNAL plumbing migration (value-migration; keep the user-facing flags for the contract task)

Batch 3 added `SpecsLandIn = PrdsLandIn` (alias) + optional `specsLandIn?` config key + `explicitSpecsLandInFromFlags`, but left `PrdsLandIn` primary and `config.prdsLandIn` the primary internal field. Make `spec` the primary INTERNAL spelling:

- `config.ts`: make `SpecsLandIn` the OWN type (`'pre-proposed' | 'ready'`) and `PrdsLandIn = SpecsLandIn` the alias (INVERT the current `SpecsLandIn = PrdsLandIn`); make `specsLandIn` the primary `Config` field with `prdsLandIn?` the readable alias (INVERT the current primary/optional), and the `DEFAULT_CONFIG` default keyed `specsLandIn: 'pre-proposed'`. Keep the resolver reading `config.specsLandIn ?? config.prdsLandIn` so an existing `prdsLandIn`-only config still works (the fallback stays until the CONTRACT task removes `prdsLandIn`).
- `intake.ts`: `PerformIntakeOptions.prdsLandIn`/`explicitPrdsLandIn` fields (219/301/311) → `specsLandIn`/`explicitSpecsLandIn`; `prdLandingToSide` (371) → `specLandingToSide`; the `PlacementInputs`-ish `prdsLandIn`/`explicitPrdsLandIn` (1245/1247/1265/1293/1295) + the `options.*` passes (880/881) → `spec*`.
- `env-config.ts:115` `prdsLandIn` schema entry → `specsLandIn` (keep `prdsLandIn` readable if the env-coerce needs it for the legacy env var, else the contract task re-adds nothing — check `DORFL_PRDS_LAND_IN` handling).
- `cli.ts`: the INTERNAL `explicitPrdsLandIn` local (3806) + the `prdsLandIn:`/`explicitPrdsLandIn:` field passes (3831/3832) → `spec*`. LEAVE the user-facing `--specs-land-in` flag + `DORFL_PRDS_LAND_IN` env + the `flags.prdsLandIn` CLI-input plumbing (703/733/805/3709/3810) — those are the INPUT alias the CONTRACT task removes.

Green-in-isolation: the `prdsLandIn` config-field alias + `--specs-land-in` input flag STAY (readable), so an existing config / invocation still resolves; only the INTERNAL primary spelling flips. Update coupled config/intake/env/cli tests.

### Do NOT touch (other batches / command own these)

- The `--merge-spec`/`--propose-spec`/`--specs-land-in` user-facing CLI FLAGS + `DORFL_PRDS_LAND_IN` env (contract task removes the input aliases).
- The `SlugNamespace`/`SidecarType` `'spec'` TYPE member, the `prd:` frontmatter field, `work/specs/` folder literals, the sidecar `prd-<slug>.md` file-path fallback (4d added it; command removes it), domain-prose.
- The `prdSlug`/`prdTitle`/`prdBody` verdict CONTENT field names (4d note §4 kept them, analogous to the `prd:` field).

## Acceptance criteria

- [ ] The ~5 exported symbols renamed atomically (`renderPrd→renderSpec`, `buildIntakeDecisionPrd→buildIntakeDecisionSpec` incl. `index.ts` re-export, `findPrdPath→findSpecPath`, `promoteFromPrePrd*→promoteFromPreSpec*`) + all importers + coupled tests; no `Spec*` twin remains for them.
- [ ] `PrdsLandIn` internal plumbing migrated: `SpecsLandIn` primary (`PrdsLandIn` the alias), `config.specsLandIn` primary field (`prdsLandIn?` readable alias, resolver keeps `?? prdsLandIn`), `specLandingToSide`, `PerformIntakeOptions.specsLandIn`/`explicitSpecsLandIn`, `env-config` `specsLandIn`, `cli.ts` internal `explicitSpecsLandIn`. User-facing `--specs-land-in`/`DORFL_PRDS_LAND_IN`/`--merge-spec`/`--propose-spec` flags LEFT (contract task).
- [ ] `SlugNamespace`/`SidecarType` `'spec'` type member, `prd:` field, `work/specs/` literals, sidecar `prd-<slug>.md` fallback, verdict `spec*` content keys UNTOUCHED.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] After this, `grep -rnE "\b(renderPrd|buildIntakeDecisionPrd|findPrdPath|promoteFromPrePrd|PrdsLandIn)\b" packages/dorfl/src` returns only the deliberate `PrdsLandIn`/`prdsLandIn` readable-alias survivors (contract task's remaining scope) — no other exported `Spec*` symbol.

## Blocked by

- rename-spec-namespace-emit-sites-and-local-unions (the producer-value migrate; this batch is the exported-SYMBOL migrate — file-orthogonal, but shares the "before contract" ordering).

## Prompt

> Goal: complete the exported-SYMBOL migrate the C-audit dropped. Read `work/notes/observations/contract-spec-blocked-by-untasked-residual-prd-exported-symbols-2026-07-10.md` (full file:line list) + the parent spec + `TASKING-PROTOCOL.md` §3a + the batch-4a symbol-vs-value observation (`prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename.md`). TWO pieces: (1) ATOMIC rename of ~5 exported `Spec*` symbols (`renderPrd`, `buildIntakeDecisionPrd` + its `index.ts` re-export, `findPrdPath`, `promoteFromPrePrd*`) — definition + all importers + coupled tests in ONE green commit, no alias (exported symbols have no dual form); (2) complete the `PrdsLandIn` INTERNAL plumbing migration onto `spec` (invert the `SpecsLandIn = PrdsLandIn` alias + the `config.prdsLandIn` primary field so `spec` is primary, `specLandingToSide`, `PerformIntakeOptions.specsLandIn`, env-config, the cli INTERNAL var) — value-migration, green because the `prdsLandIn` config-field + `--specs-land-in` input-flag ALIASES stay readable.
>
> Scope boundary: LEAVE the user-facing `--specs-land-in`/`--merge-spec`/`--propose-spec` FLAGS + `DORFL_PRDS_LAND_IN` (contract task removes the input aliases), the `SlugNamespace`/`SidecarType` `'spec'` type member, the `prd:` field, `work/specs/` literals, the sidecar `prd-<slug>.md` fallback, and the `spec*` verdict content keys. Over-renaming into those breaks the contract task's/command's scope; under-renaming a symbol leaves the contract scan red.
>
> Done means: no residual exported `Spec*` symbol (only the deliberate `prdsLandIn` readable-alias survivors), full gate green. FIRST check drift: confirm 4d landed and grep the 5 symbols to confirm they are still live + un-twinned.
