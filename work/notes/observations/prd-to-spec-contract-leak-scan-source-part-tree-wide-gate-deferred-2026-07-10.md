# spec→spec contract: source-part leak scan landed; tree-wide bi-word gate DEFERRED to the final run-on-dorfl task

2026-07-10 — task `contract-spec-hard-cutover-rejection-and-leak-scan` (spec `prd-to-spec-vocabulary-cutover-and-migration-command`, US #1/#8).

The SOURCE-part cutover is complete and gated: the code `spec` aliases are removed (`SlugNamespace`/`PRD_PREFIX`, `SidecarType`/`TYPE_TO_NAMESPACE`/item-lock `spec` cases, `IntakeArtifactType`/`IntakeOutcome` `spec`, repo-config `prdsLandIn`/`--specs-land-in`/`DORFL_PRDS_LAND_IN`, `config.PrdsLandIn`), the dead `prd:`/`spec-`/`work/spec-` token is rejected (the hard-cutover tests flipped so `spec:` is live and `prd:` is a bare literal), and the new bi-word forward+reverse leak scan (`packages/dorfl/test/spec-to-spec-leak-scan.test.ts`) gates the whole cutover green.

Per option A (the source/data split, ADR §7e), this scan is IDENTIFIER-SCOPED forward + reverse over `packages/dorfl/src`, `skills/`, `docs/`, `CONTEXT.md`, `AGENTS.md`, and CATEGORICALLY EXEMPTS the migration COMMAND's DATA territory:

- the `work/specs/…` folder-path literals + bare `specs/`,
- the `prd:` frontmatter-FIELD token + the `<spec>` prompt-template placeholder + the `Frontmatter.spec` field and the `spec`-named plumbing carrying that field's value (CARVE-OUT #2 — dorfl's ledger has 199 live `prd:` fields / 0 `spec:`, so `parseFrontmatter` keeps reading BOTH keys until the command converts the data),
- the sidecar `prd-<slug>.md` file-path fallback (CARVE-OUT #1), and
- domain-PROSE `spec`/`SPEC`/`brief` (the artifact word) in doc-comments, `--help`/log/error strings, and agent-prompt/CI-template text.

**DEFERRED:** the EXHAUSTIVE tree-wide bi-word gate over ALL of `work/` DATA + the folder/field literals + all prose is the FINAL `run-prd-to-spec-on-dorfl-acceptance` task's — it is green on dorfl only AFTER the `dorfl spec-to-spec` command converts dorfl's own on-disk data (`work/specs/* → work/specs/*`, the 199 `prd:` frontmatter fields, config values, refs). Do NOT widen this source-part scan to a blanket `spec`-grep over `src`/`work`: ~2000 legitimate data/prose occurrences remain until the command runs.

## Decisions (ratify or reverse)

- **CI-template producer flip `"spec:" + .slug` → `"spec:" + .slug` (forced by the cutover, in-scope here).** The `advance` propose-matrix `jq` producer in `advance-lifecycle-template.ts`, the shipped `docs/ci/advance-loop.yml.template`, and the `require()` self-checks in `advance-ci-template.ts`/`advance-lifecycle-template.ts` emitted `prd:<slug>` legs from the taskable-SPEC pool (`repos[].specs[]`). Since `advance prd:<slug>` now resolves to a bare literal TASK slug (not the parent-spec tasking rung), that CI would MISROUTE a taskable spec. This is a live dead-token PRODUCER the migrate batches did not reach (a string-embedded producer, not caught by TS narrowing) — the exact parallel of the `intake.ts` `switchToWorkBranch(cwd, arbiter, 'spec', slug)` producer flip the task explicitly authorized. Flipped the producer + its coupled tests + the scan.ts doc-comment leg-format prose to `spec:`. **What it touches:** the `advance` CI matrix / `scan --json` leg format (user-visible CI), the two `advance-*-template` modules + their tests, `docs/ci/advance-loop.yml.template`. Alternative considered: STOP and route a new migrate batch — rejected because this contract task is defined as the trust signal that the source cutover is COMPLETE, and the producer flip is the same sanctioned class as the intake.ts flip.
