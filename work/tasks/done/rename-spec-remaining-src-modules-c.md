---
title: prd→spec batch 4c — do/advance/prompt consumers + the do spec:/advance spec: verb dispatch + prd-complete.ts file rename
slug: rename-spec-remaining-src-modules-c
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-remaining-src-modules-b]
covers: [1]
---

## What to build

Sub-batch (c) of the split bulk migrate (§3a): the `do`/`advance` family consumers, the `do spec:`/`advance spec:` VERB DISPATCH, and the `prd-complete.ts → spec-complete.ts` FILE rename. Additive-migrate; `prd` alias covers the rest, green in isolation.

Scope (this batch's files ONLY): `do.ts`, `do-autopick.ts`, `do-remote-auto.ts`, `advance.ts`, `advance-drivers.ts`, `advance-isolated.ts`, `advance-loop-driver.ts`, `prompt.ts` (residual `Prd*` NOT already done by batch 2), `integration-core.ts`, `triage-persist.ts`, `needs-attention.ts`, `cli.ts` (help text + reject message), `prd-complete.ts`, and their coupled tests.

- **VERB DISPATCH:** `do`/`advance` route on `resolved.namespace === 'prd'` (`do.ts:711`, `do.ts:1893`, + `advance.ts`/`advance-drivers.ts`/`do-autopick.ts` peers). Add `|| resolved.namespace === 'spec'` beside the `=== 'prd'` dispatch so `do spec:<slug>` / `advance spec:<slug>` actually route to tasking; keep `'prd'` routing (contract task removes it). Update `cli.ts` help text to present `do spec:<slug>` and the task-only-command rejection message “operates on tasks, not PRDs” → “…not specs”; update `human-face-verbs.test.ts`.
- **Consumer switches** `namespace === 'prd'` in these files → also match `'spec'`.
- **FILE rename (git mv, with test siblings):** `prd-complete.ts → spec-complete.ts` (+ symbols `renderPrdBody → renderSpecBody`, `PrdTask → SpecTask`, etc.), `prd-complete.test.ts → spec-complete.test.ts`, `pre-prd-staging-and-promote.test.ts → pre-spec-staging-and-promote.test.ts`, `tasked-prd-needsanswers-lifecycle.test.ts → tasked-spec-needsanswers-lifecycle.test.ts`. Update every importer of `prd-complete`.

Do NOT touch the deliberate `prd` alias surface (contract task) or sub-batch (a)/(b) symbols (ledger/scan/select-priority/close-job/brief remnants).

## Acceptance criteria

- [ ] `do spec:<slug>` / `advance spec:<slug>` ROUTE to tasking (dispatch matches `'spec'` beside `'prd'`); `cli.ts` help + reject message say `spec`; `human-face-verbs.test.ts` updated.
- [ ] `namespace === 'prd'` consumers in do/advance/prompt/integration-core/triage-persist/needs-attention also match `'spec'`.
- [ ] `prd-complete.ts → spec-complete.ts` (+ symbols) and the 3 test files `git mv`'d; all importers updated.
- [ ] The deliberate `prd` alias surface + sub-batch (a)/(b) symbols UNTOUCHED.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- rename-spec-config-and-intake (shared identity renamed; `prd` alias present so this stays green). (File-orthogonal to sub-batches (a)/(b); if driven in parallel they do not conflict, but they share `blockedBy` so ordering is free.)

## Prompt

> Goal: sub-batch (c) of the split bulk migrate (read `work/protocol/TASKING-PROTOCOL.md` §3a + the parent spec). Migrate the `do`/`advance` family consumers onto `spec`, wire the `do spec:`/`advance spec:` VERB DISPATCH (add `|| resolved.namespace === 'spec'` beside the `=== 'prd'` routes in `do.ts:711`/`:1893` + `advance.ts`/`advance-drivers.ts`/`do-autopick.ts`, so the verb actually routes; update `cli.ts` help + the “not PRDs”→“not specs” reject message + `human-face-verbs.test.ts`), and `git mv prd-complete.ts → spec-complete.ts` (+ symbols `renderPrdBody`/`PrdTask`, + the 3 test-file renames, + all importers). Keep `prd:` routing (contract task removes it).
>
> Scope boundary: touch only the do/advance/prompt/integration/triage/needs-attention/cli files + prd-complete. Do NOT touch the `prd` alias surface (contract task) or sub-batch (a)/(b) symbols (ledger/scan/select-priority/close-job/the brief remnants).
>
> Done means: `do spec:`/`advance spec:` route correctly, the consumers match `spec`, `spec-complete.ts` is renamed with importers updated, coupled tests green, full gate green. FIRST check drift: confirm `rename-spec-config-and-intake` landed and the expand aliases (esp. `SlugNamespace 'spec'`) are present — the verb dispatch depends on `resolveSlug('spec:x')` returning `{namespace:'spec'}`.

## Requeue 2026-07-09

Lock released: the previous do run was killed by a wrapper 25-min timeout during isolated build (before any work-branch push); no progress lost. Re-driving with a longer window.
