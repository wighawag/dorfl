---
title: prd→spec batch 4 — remaining src modules (ledger, tasking, scan, close-job, prd-complete rename, prompts)
slug: rename-spec-remaining-src-modules
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-config-and-intake]
covers: [1]
---

## What to build

The BULK migrate batch: rename the REMAINING `prd` identifiers across `packages/dorfl/src` that earlier batches did not own, plus the coupled tests. This is the largest single batch; if it proves too big for one context window, SPLIT it at file/module boundaries into `rename-spec-remaining-src-modules-a/-b/…` each `blockedBy` batch 3, keeping each green — that split is itself the §3a batch discipline.

**SCOPE (what this batch OWNS), crisp so nothing is orphaned or double-owned (audit, 2026-07-09):** this batch owns (1) the `namespace === 'prd'` / `outcome === 'prd'` CONSUMER sites — `advance.ts`, `advance-drivers.ts`, `advance-isolated.ts`, `advance-loop-driver.ts`, `do.ts`, `do-autopick.ts`, `do-remote-auto.ts`, `scan.ts`, `select-priority.ts`, `lifecycle-gather.ts`, `needs-attention.ts`, `triage-persist.ts`, `integration-core.ts`, `ledger-read.ts`, `cli.ts`; (2) the `do spec:`/`advance spec:` VERB DISPATCH (below); (3) the `brief` remnants (below); (4) the `prd-complete.ts → spec-complete.ts` FILE rename + its `Prd*` symbols; (5) any remaining `Prd*`/`*Prd*` symbol NOT already renamed. It does NOT re-touch the occurrences earlier batches already migrated: batch 2 owns the `fm.spec` reads + branch/lock EMIT in `frontmatter.ts`/`prompt.ts`/`tasking.ts`/`tasking-lock.ts`; batch 3 owns `repo-config.ts`/`intake.ts`/`intake-trigger-template.ts`. Where this batch and an earlier batch both appear in one file (e.g. `tasking.ts`, `intake.ts`), touch ONLY the occurrences the earlier batch left (its consumer switch, its `Prd*` symbol) — not the ones it already flipped. This batch stays green in isolation because the `prd` alias (from the expand tasks) still resolves for anything not yet migrated.

**Includes the `do spec:` / `advance spec:` VERB DISPATCH (moved here from batch 2).** The `do`/`advance` dispatchers route on `resolved.namespace === 'prd'` (`do.ts:711`, `do.ts:1893`, plus the parallel `advance.ts`/`advance-drivers.ts`/`do-autopick.ts` sites). Migrate these onto `spec`: since the expand tasks made `resolveSlug('spec:x')` return `{namespace:'spec'}`, add `|| resolved.namespace === 'spec'` beside the `=== 'prd'` dispatch (or switch to `=== 'spec'` as primary with `'prd'` still handled) so `do spec:<slug>` / `advance spec:<slug>` actually route to tasking, and update the `cli.ts` help text + task-only-command rejection message ("not PRDs" → "not specs") + `human-face-verbs.test.ts`. Keep `prd:` routing working (contract task removes it).

High-density modules to cover (from the blast-radius scan): `intake.ts` residuals, `ledger-read.ts`, `tasking.ts`, `scan.ts`, `do.ts`, `advance.ts`, `close-job.ts`, `needs-attention.ts`, `lifecycle-gather.ts`, `prompt.ts`, `select-priority.ts`, `tasking-lock.ts`, `integration-core.ts`, `triage-persist.ts`, `item-lock.ts`, `do-autopick.ts`, `advance-drivers.ts`, `prd-complete.ts` (rename the FILE `prd-complete.ts → spec-complete.ts` + its symbols `renderPrdBody`, `PrdTask`, etc.), and every remaining `Prd*`/`*Prd*` symbol.

**ALSO SWEEP THE DOUBLY-RETIRED `brief` REMNANTS TO `spec` (scope-widened per review, ADR §7a).** The prior `brief → prd` revert left 22 live `brief` occurrences meaning the SAME artifact; leaving them while everything else says `spec` is an incoherence. This task owns renaming ALL of them to `spec` (not `prd`):
- **Live code identifiers (8):** the `via: 'brief'` discriminated-union tag — `via: 'issue' | 'brief'` → `via: 'issue' | 'spec'` — across `close-job.ts` (type decls, `prdCandidates`, the `closeComment` param + branch + the user-facing string `every task of brief \`${slug}\`` → `every task of spec \`${slug}\``) and `frontmatter.ts` (`{via: 'brief', prd}` → `{via: 'spec', spec}` — the `prd` field on that object is renamed by batch 2's frontmatter work, so coordinate: this batch is `blockedBy` batch 3 which is `blockedBy` batch 2). Rename `prdCandidates` → `specCandidates` in the same pass.
- **Stale doc-comment prose (14):** `config.ts` (“the brief-side”), `install-ci-branch-protection.ts` (×9 “the brief…”), `merge-question-surfacer.ts`, `verify-workflow-template.ts` — JSDoc/comments that say “the brief” meaning the source spec doc; rewrite to “the spec”.

(Context on why this is real, not hypothetical: `via: 'brief'` is a LIVE union tag today — the exact leftover-word failure mode the whole cutover exists to prevent. The forward leak scan in the contract task is widened to bi-word so a stray `brief` also fails the gate.)

FILE renames (git mv, with their test siblings): `prd-complete.ts → spec-complete.ts`, `prd-complete.test.ts → spec-complete.test.ts`, `pre-prd-staging-and-promote.test.ts → pre-spec-…`, `tasked-prd-needsanswers-lifecycle.test.ts → tasked-spec-…`.

Keep the gate green; update each module's coupled tests in the SAME batch as the module. Because batches 1–3 already renamed the shared identity (layout, frontmatter, namespace, config), most of these are mechanical symbol renames with no cross-batch conflict.

## Acceptance criteria

- [ ] Every remaining `prd`/`Prd`/`PRD` identifier in `packages/dorfl/src` renamed to the `spec` spelling; `prd-complete.ts` + test siblings `git mv`'d and their symbols renamed.
- [ ] The 22 doubly-retired `brief` remnants (8 live identifiers incl. `via: 'brief'` + `prdCandidates`; 14 doc-comment refs) renamed to `spec`; the `closeComment` user-facing string updated; coupled `close-job`/`frontmatter` tests updated in this batch.
- [ ] The coupled tests for each renamed module updated in this batch (or its sub-batches).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] Every `prd`/`Prd`/`PRD` code identifier in this batch's modules is MIGRATED onto `spec`, EXCEPT the deliberate `prd`-alias surface the expand task added (the `prd:` frontmatter-key acceptance, the `prd:` namespace-prefix acceptance, the `prdsLandIn` config alias, the `'prd'` artifact-type) which STAYS until the contract task removes it. The exhaustive bi-word leak scan (forward `prd`+`brief`) is the CONTRACT task's gate, run AFTER the aliases are removed — not this batch. This batch leaves only those intentional aliases + provenance survivors.

> **May exceed one context window** (~85 src + ~100 test files + the brief sweep). If so, SPLIT at module boundaries — suggested cut: (a) ledger/tasking/scan/select-priority, (b) close-job/frontmatter/lifecycle-gather + the `brief` sweep, (c) do/advance/prompt/integration/triage + `prd-complete.ts` file rename — each `blockedBy` batch 3, each green. Pre-splitting keeps the frontier deterministic rather than relying on the builder to decide mid-flight.

## Blocked by

- rename-spec-config-and-intake (shared identity — layout/frontmatter/namespace/config — is already renamed, so these are conflict-free symbol renames).

## Prompt

> Goal: rename all remaining `prd` identifiers across `packages/dorfl/src` (and their coupled tests) to `spec`, after batches 1–3 renamed the shared identity. Migrate-batch 4 (the bulk) of the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command` (read it + `TASKING-PROTOCOL.md` §3a). If too large for one context window, SPLIT at module boundaries into sub-batches each `blockedBy` batch 3 and keep each green — that IS the batch discipline.
>
> Domain vocabulary: after batches 1–3, `spec` is already the folder/frontmatter/namespace/config word; this batch propagates it through the remaining modules (ledger, tasking, scan, do, advance, close-job, prompts, `prd-complete.ts → spec-complete.ts`, etc.). It ALSO owns the doubly-retired `brief → spec` remnants (scope `{prd, brief} → spec`): the LIVE `via: 'brief'` discriminated-union tag in `close-job.ts`/`frontmatter.ts` (+ `prdCandidates → specCandidates`, the `closeComment` string) and ~14 “the brief” doc-comments — both become `spec`, NOT `prd`. See the What-to-build section for the exact list.
>
> Where to look: grep `packages/dorfl/src` for `prd`/`Prd`/`PRD`; rename symbols + `git mv` the `prd-*` files with their tests; update each module's tests in the same batch.
>
> Done means: this batch's modules read/emit `spec`, the ONLY `prd` left is the deliberate alias surface (frontmatter-key/namespace-prefix/config/artifact-type acceptance) that the CONTRACT task removes, coupled tests updated, full gate green.
>
> FIRST check drift: confirm batches 1–3 landed; if a shared symbol is still `prd`, that batch has not landed and this one should wait.

## Requeue 2026-07-09

Splitting into -a/-b/-c per §3a (oversized). This task is superseded by the three sub-tasks.
