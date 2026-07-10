---
title: spec→spec batch 4f — clean-break rename the intake integration-mode CLI flags + FULLY PURGE all residual internal spec code identifiers
slug: rename-spec-intake-cli-flags-and-residual-prd-identifiers
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-residual-exported-symbols-and-prdslandIn-plumbing]
covers: [1]
---

## What to build

The THIRD (and final) missing migrate sub-batch the C-audit dropped (see the agent STOP diagnosis captured this session). Two pieces, both ratified with the human (2026-07-10): (A) a CLEAN-BREAK rename of the intake integration-mode CLI flags, and (B) a FULL PURGE of every residual internal `spec` code identifier so the contract task's forward scan can be maximally strict (catch even private names) and dorfl's source is genuinely `spec`-free except the deliberate alias/field/folder-literal/prose.

### Piece A — intake integration-mode CLI flags: CLEAN BREAK to `spec` (no back-compat alias)

The `--merge-spec`/`--propose-spec` family was a DOCUMENTED deferral (`intake.ts:425`, observation `intake-trigger-template-prd-flag-surface-stays-prd-in-batch-3.md`) that no batch owned. Human decision: CLEAN BREAK (matching the cutover's hard-cutover spirit; NO `--merge-spec` deprecated alias).

- **CLI flag definitions** (`cli.ts:3688/3692`): `--merge-spec` → `--merge-spec`, `--propose-spec` → `--propose-spec` (+ the `--merge-spec`/`--propose-spec` help strings + the `intake` command description at `cli.ts:3664` that lists them).
- **`IntakeIntegrationFlags` fields** (`intake.ts:409/411`, `cli.ts:792/793`): `mergePrd`/`proposePrd` → `mergeSpec`/`proposeSpec`; the consumers (`intake.ts:494` `prdGranular`/`granularFromFlags`, `:496/:497` `flags.mergePrd`/`flags.proposePrd`) → `spec*`.
- **CI trigger-template** (`intake-trigger-template.ts`): the emitted shell `prd_flag="--propose-spec"/"--merge-spec"` (`:345/:347`), the `prd_flag` output var (`:380/:383/:396`), and the doc-comments/policy prose (`:33/:103/:129-130/:142-145/:161/:208/:244/:330-332`) → `spec_flag` / `--propose-spec`/`--merge-spec`. Update the coupled trigger-template test assertions (`:512-519` `derives-merge-spec`/`--merge-spec\b` → `--merge-spec`).
- NOTE the compiled `.github/workflows/*.yml` are NOT edited here (a human regenerates them via `install-ci`, exactly as the `403a5be9` `brief→spec` cutover excluded compiled workflows). Flag this regeneration as a manual follow-up in the done note.

### Piece B — FULL PURGE of residual internal `spec` identifiers → `spec`

Rename every remaining `spec`-spelled CODE identifier (exported OR internal: consts, functions, methods, local vars, import aliases) to its `spec` spelling. These are file-local or small-blast so each is safe; do them so `pnpm -r build` stays green. Known set (grep to confirm + catch any this list misses — the acceptance criterion is a clean grep, not this list):

- **Exported** (atomic, incl. importers): `STAGED_PRDS_DIR` (`intake.ts:348`) → `STAGED_SPECS_DIR`.
- **Interface method** (rename on the interface + impl + call sites): `advance.ts` `RungExecutor.taskPrd` (`:156` decl, `:533` impl, `:1556` call) → `taskSpec`.
- **Private consts:** `intake.ts` `POOL_PRDS_DIR` (`:356`) → `POOL_SPECS_DIR`, `PRD_PLACEMENT_SLOTS` (`:359`) → `SPEC_PLACEMENT_SLOTS`; `close-job.ts` the `SPEC_FOLDERS as WORK_LAYOUT_PRD_FOLDERS` import alias (`:42`) + `const PRD_FOLDERS = …` (`:60`) → drop the alias, use `SPEC_FOLDERS`/`SPEC_FOLDERS` naming.
- **Private functions:** `slug-namespace.ts` `prdExists` (`:248`) → `specExists`; `tasking.ts` `heldPrdIsStale` (`:920`, called `:616`) → `heldSpecIsStale`; `intake.ts` `resolvePrdSlug` (`:1583`, called `:1275`) → `resolveSpecSlug`; `buildTaskingPrd` (if still present) → `buildTaskingSpec`.
- **Local variables** (file-local, rename freely): `prdCandidates`→`specCandidates`, `eligiblePrds`→`eligibleSpecs`, `specs`→`specs`, `prdPool`→`specPool`, `prdContent`→`specContent`, `prdPath`→`specPath`, `prdRel`→`specRel`, `prdFile`/`prdTaskedFile`→`specFile`/`specTaskedFile`, `prdBase`→`specBase`, `prdGranular`→`specGranular`, `prdTasked`→`specTasked`, `spec` loop vars → `spec`, etc., across `advance-drivers.ts`, `do-autopick.ts`, `ledger-read.ts`, `lifecycle-gather.ts`, `mirror-pool-scan.ts`, `needs-attention.ts`, `prompt.ts`, `scan.ts`, `tasking.ts`, `tasking-lock.ts`, `intake.ts`.

### Do NOT touch (the deliberate alias/field/folder/prose the CONTRACT task or the COMMAND owns)

- The `SlugNamespace`/`SidecarType`/`IntakeArtifactType`/`IntakeOutcome` `'spec'` TYPE MEMBERS + `PRD_PREFIX='spec:'` + `parseFrontmatter`'s `prd:` key read + `item-lock`'s `'spec'` cases + `config`'s `prdsLandIn`/`PrdsLandIn` readable alias — the CONTRACT task removes these (this batch's grep-clean target EXCLUDES the type-member/alias surface).
- The `prd:` frontmatter FIELD name, the `.spec` frontmatter reads, `work/specs/` string literals, the sidecar `prd-<slug>.md` fallback (4d), the `prdSlug`/`prdTitle`/`prdBody` verdict CONTENT keys (4d §4), and domain-PROSE — DATA/command territory.
- `DORFL_PRDS_LAND_IN` env var + `--specs-land-in` flag + `explicitPrdsLandInFromFlag`/`flags.prdsLandIn` INPUT plumbing — the config INPUT alias the CONTRACT task removes (piece B does NOT touch the `prdsLandIn` input surface; 4e already made `specsLandIn` primary internally).

## Acceptance criteria

- [ ] Piece A: `--merge-spec`/`--propose-spec` → `--merge-spec`/`--propose-spec` (clean break, NO alias); `mergePrd`/`proposePrd` fields → `mergeSpec`/`proposeSpec`; the trigger-template `prd_flag`/`--*-spec` → `spec_flag`/`--*-spec` + its test. `.github/workflows/*` regeneration flagged as manual follow-up.
- [ ] Piece B: every residual `spec`-spelled CODE identifier (exported `STAGED_PRDS_DIR`, the `taskPrd` method, private consts/functions, local vars) renamed to `spec`. `grep -rniE "\bprd[A-Za-z_]*\b" packages/dorfl/src | grep -vE "prdsLandIn|PrdsLandIn|spec:|'spec'|prd-<slug>|work/specs|prdSlug|prdTitle|prdBody|PRD_PREFIX|SlugNamespace|SidecarType|IntakeArtifact|IntakeOutcome"` returns ONLY comment/prose + the deliberate contract-owned alias survivors — no live `spec` CODE identifier.
- [ ] The contract-owned survivors UNTOUCHED: `'spec'` type members, `PRD_PREFIX`, `parseFrontmatter` `prd:` key, `item-lock` `'spec'`, `prdsLandIn`/`--specs-land-in` input alias, sidecar `prd-<slug>.md` fallback, `spec*` verdict content keys, `prd:` field / `work/specs/` literals / prose.
- [ ] Coupled tests updated; `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- rename-spec-residual-exported-symbols-and-prdslandIn-plumbing (the prior exported-symbol/PrdsLandIn migrate; this is the last identifier sweep before contract).

## Prompt

> Goal: the FINAL migrate sweep before the contract task — (A) CLEAN-BREAK rename the intake integration-mode CLI flags `--merge-spec`/`--propose-spec` → `--merge-spec`/`--propose-spec` (+ `mergePrd`/`proposePrd` fields + the CI trigger-template `prd_flag` + tests; NO back-compat alias — human decision), and (B) FULLY PURGE every residual internal `spec` code identifier (exported `STAGED_PRDS_DIR`, the `taskPrd` interface method, private consts `POOL_PRDS_DIR`/`PRD_PLACEMENT_SLOTS`/`PRD_FOLDERS`, private fns `prdExists`/`heldPrdIsStale`/`resolvePrdSlug`/`buildTaskingPrd`, and ~all `spec*` local vars across ~15 files) → `spec`. Read the parent spec + `TASKING-PROTOCOL.md` §3a + the 4d/4e/4f STOP observation notes.
>
> Scope boundary — do NOT touch the CONTRACT-owned alias/type-member surface (`'spec'` members in SlugNamespace/SidecarType/IntakeArtifactType/IntakeOutcome, `PRD_PREFIX`, `parseFrontmatter` `prd:` key, `item-lock` `'spec'`, the `prdsLandIn`/`--specs-land-in` INPUT alias, the sidecar `prd-<slug>.md` fallback), the `prd:` FIELD / `work/specs/` literals / `spec*` verdict-content keys / domain-prose (command/data territory). Over-renaming into those breaks the contract task / command; the acceptance grep tells you exactly what must remain vs go.
>
> Done means: the CLI flags are `spec` (clean break), no live `spec` CODE identifier remains (only the enumerated contract-owned alias survivors + prose), `.github/workflows` regeneration flagged for the human, full gate green. FIRST check drift: confirm 4e landed; grep the flag family + `STAGED_PRDS_DIR` to confirm they are still `spec`-spelled + un-twinned.
