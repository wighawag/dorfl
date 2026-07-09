---
title: prd→spec MIGRATE — move frontmatter + slug-namespace + CLI-verb call sites onto spec (additive, no rejection)
slug: rename-spec-frontmatter-field-and-slug-namespace
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [expand-spec-frontmatter-and-namespace-aliases]
covers: [1]
---

## What to build

The MIGRATE step for the identity layer (`TASKING-PROTOCOL.md` §3a). The expand task has already added `spec` beside `prd` (both forms compile). This task MOVES the call sites in this batch's territory onto the `spec` form and makes `spec` the primary user-facing spelling — WITHOUT removing the `prd` form (downstream batches 3/4 still read it until the contract task removes it). No hard-cutover rejection here — that moved to the contract task.

- **Frontmatter reads in this batch's modules:** migrate the direct `fm.prd`/`taskFm.prd`/`prdFm.prd`/`task.prd` reads in `frontmatter.ts`'s own helpers + `prompt.ts` + `tasking.ts` onto `fm.spec` (the expand task populates both, so this is a safe read-swap). Leave `do.ts`/`run.ts`/`prd-complete.ts` reads for batch 4 (they are that batch's territory) — they keep compiling on the still-present `prd` alias.
- **slug-namespace primary spelling:** make `spec` the canonical namespace/prefix the CODE emits (`workBranchRef` produces `work/spec-<slug>`, the lock entry is `spec-<slug>`, new locks/branches use `spec:`), while the resolver still ACCEPTS `prd:` (from expand) so nothing in-flight breaks. Do NOT delete the `prd` acceptance — the contract task does.
- **CLI verb + flags:** make `do spec:<slug>` the documented verb and `--specs-land-in` the documented flag, keeping `do prd:` / `--prds-land-in` as still-accepted aliases (removed by the contract task). Update the task-only-command rejection MESSAGE wording ("operates on tasks, not PRDs" → "…not specs") and `human-face-verbs.test.ts` to assert the `spec:` behaviour (the `prd:`-rejection-by-task-only-commands assertion still holds because both resolve to the spec namespace).
- Update the coupled tests for the migrated sites in THIS task; assert `spec` is the primary form. Do NOT add a "reject `prd:`" assertion (contract task).

This repo's live `work/tasks/*` `prd:` frontmatter is NOT hand-converted (the migration command's job); only code + test fixtures change.

## Acceptance criteria

- [ ] `frontmatter.ts` helpers + `prompt.ts` + `tasking.ts` read `fm.spec`; `spec` is the canonical namespace/prefix the code EMITS (`work/spec-<slug>`, lock `spec-<slug>`); `do spec:` + `--specs-land-in` are the documented forms.
- [ ] The `prd` form is STILL ACCEPTED (alias from the expand task) — nothing removed; `do.ts`/`run.ts`/`prd-complete.ts` still compile on the alias (batch 4 migrates them).
- [ ] NO hard-cutover rejection of `prd` added here (that is the contract task); coupled tests updated to assert `spec` is primary + both forms still accepted.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] This repo's live `work/tasks/*` `prd:` data is NOT hand-converted.

## Blocked by

- expand-spec-frontmatter-and-namespace-aliases (the `spec` form must exist beside `prd` before call sites can migrate onto it while staying green).

## Prompt

> Goal: the MIGRATE step of the identity-layer wide refactor (read `work/protocol/TASKING-PROTOCOL.md` §3a + the parent spec `work/specs/tasked/prd-to-spec-vocabulary-cutover-and-migration-command.md`). The expand task added `spec` beside `prd` (both compile). Move THIS batch's call sites onto the `spec` form and make `spec` the canonical spelling the code emits (`work/spec-<slug>`, lock `spec-<slug>`, `do spec:`, `--specs-land-in`), while KEEPING the `prd` form accepted so downstream batches 3/4 keep compiling. Do NOT reject `prd` and do NOT remove the alias — that is the CONTRACT task's job.
>
> Scope boundary: migrate `frontmatter.ts` helpers + `prompt.ts` + `tasking.ts` reads onto `fm.spec`; leave `do.ts`/`run.ts`/`prd-complete.ts` for batch 4 (they compile on the alias). Update `human-face-verbs.test.ts` for `spec:` behaviour but do NOT add a `prd:`-rejection assertion. Do NOT hand-convert this repo's live `work/tasks/*` `prd:` data (the migration command owns that).
>
> Done means: `spec` is the primary emitted form, the `prd` alias still works, coupled tests assert both, the full gate is green.
>
> FIRST check drift: confirm `expand-spec-frontmatter-and-namespace-aliases` landed (both `fm.spec` and `fm.prd` populate; `spec:`/`prd:` both resolve). If the alias is not there yet, this task cannot stay green — route to needs-attention rather than hard-swapping.

## Requeue 2026-07-09

Blocked on missing spec lock/sidecar namespace. Adding a follow-up expand task (expand-spec-lock-and-sidecar-namespace) before this batch; this batch's 'lock spec-<slug>' clause becomes satisfiable once that lands.
