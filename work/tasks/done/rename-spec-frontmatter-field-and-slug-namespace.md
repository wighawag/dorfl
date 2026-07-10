---
title: spec→spec MIGRATE — move frontmatter reads + branch/lock EMIT onto spec (additive; NOT the do/advance verb, that is batch 4)
slug: rename-spec-frontmatter-field-and-slug-namespace
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [expand-spec-lock-and-sidecar-namespace]
covers: [1]
---

## What to build

The MIGRATE step for the identity layer (`TASKING-PROTOCOL.md` §3a), scoped to `tasking.ts` + `tasking-lock.ts` + `prompt.ts` + `frontmatter.ts`'s own helpers. The expand tasks already added `spec` beside `spec` (frontmatter key, `SlugNamespace`, config, intake, lock/sidecar — all compile). This task MOVES this batch's call sites onto the `spec` form — WITHOUT removing the `spec` form (the contract task removes it). No hard-cutover rejection here.

**NOT in this task (moved to batch 4):** the `do spec:` / `advance spec:` VERB dispatch. Those dispatchers live in `do.ts`/`advance.ts` (route on `resolved.namespace === 'spec'` at `do.ts:711`/`:1893`), which batch 4 (`rename-spec-remaining-src-modules`) explicitly owns. Making `do spec:` actually route requires editing those files, so it belongs with them (batch 4 adds `|| namespace === 'spec'` beside `'spec'`). Do NOT touch `do.ts`/`advance.ts` here.

What this task DOES:

- **Frontmatter reads (this batch's modules only):** migrate the direct `fm.spec`/`prdFm.spec`/`task.spec` reads in `frontmatter.ts`'s own helpers + `prompt.ts` + `tasking.ts` onto `fm.spec` (the expand task populates both, so this is a safe read-swap). Leave `do.ts`/`run.ts`/`spec-complete.ts` reads for batch 4.
- **Branch + lock EMIT:** flip the code that MINTS the tasking work-branch + lock from `prd:` to `spec:` — `workBranchRef('spec' → 'spec')` and the `releaseItemLock`/`acquire` lock-item `spec:${slug}` → `spec:${slug}` sites in `tasking.ts` + `tasking-lock.ts` (the expand-lock-sidecar task made `spec:` produce a correct `spec-<slug>` entry, so this is now safe). The resolver still ACCEPTS `prd:` (from expand) so nothing in-flight breaks. Update the coupled `tasking-lock.test.ts` / `tasking-acquires-unified-lock.test.ts` lock-entry assertions to the `spec-<slug>` form in THIS task.
- **`--specs-land-in`** is ALREADY the documented canonical flag (landed by the config expand task) — nothing to do here beyond confirming.
- Update the coupled tests for the migrated sites; assert `spec` is the primary emitted form. Do NOT add a "reject `prd:`" assertion (contract task).

This repo's live `work/tasks/*` `prd:` frontmatter is NOT hand-converted (the migration command's job); only code + test fixtures change.

## Acceptance criteria

- [ ] `frontmatter.ts` helpers + `prompt.ts` + `tasking.ts` read `fm.spec`; the tasking work-branch + lock EMIT `work/spec-<slug>` / `spec-<slug>` (via `workBranchRef('spec')` + `spec:${slug}` lock items in `tasking.ts`/`tasking-lock.ts`); coupled lock-entry tests updated to the `spec-<slug>` form.
- [ ] `do.ts`/`advance.ts` are UNTOUCHED (the `do spec:`/`advance spec:` verb dispatch is batch 4); the `spec` form is STILL ACCEPTED (alias) so everything compiles.
- [ ] NO hard-cutover rejection of `spec` added here (contract task); coupled tests assert `spec` is the primary emitted form + `spec` still accepted.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] This repo's live `work/tasks/*` `prd:` data is NOT hand-converted.

## Blocked by

- expand-spec-frontmatter-and-namespace-aliases (the `spec` form must exist beside `spec` before call sites can migrate onto it while staying green).

## Prompt

> Goal: the MIGRATE step of the identity-layer wide refactor (read `work/protocol/TASKING-PROTOCOL.md` §3a + the parent spec `work/specs/tasked/prd-to-spec-vocabulary-cutover-and-migration-command.md`). The expand tasks added `spec` beside `spec` everywhere (frontmatter key, `SlugNamespace`, config, intake, lock/sidecar — all compile). Move THIS batch's call sites onto `spec`: the `fm.spec`→`fm.spec` reads in `frontmatter.ts` helpers + `prompt.ts` + `tasking.ts`, and the tasking work-branch + lock EMIT (`workBranchRef('spec'→'spec')` + the `spec:${slug}`→`spec:${slug}` lock items in `tasking.ts`/`tasking-lock.ts`, with the coupled lock-entry tests updated to `spec-<slug>`). KEEP the `spec` form accepted (contract task removes it).
>
> EXPLICIT NON-SCOPE: do NOT touch `do.ts`/`advance.ts` — the `do spec:` / `advance spec:` VERB dispatch (routing on `resolved.namespace`) is batch 4's (`rename-spec-remaining-src-modules`), because those files are batch 4's and making the verb route requires editing them. `--specs-land-in` is already the canonical flag (config expand task). Do NOT hand-convert this repo's live `work/tasks/*` `prd:` data.
>
> Done means: this batch's reads use `fm.spec`, the tasking branch/lock EMIT `spec-<slug>`, `do.ts`/`advance.ts` untouched, the `spec` alias still works, coupled tests green, full gate green.
>
> FIRST check drift: confirm `expand-spec-lock-and-sidecar-namespace` landed (`lockEntryFor('spec:x') === 'spec-x'`) — the branch/lock EMIT depends on it. If not, route to needs-attention rather than emitting a colliding lock.

## Requeue 2026-07-09

Blocked on missing spec lock/sidecar namespace. Adding a follow-up expand task (expand-spec-lock-and-sidecar-namespace) before this batch; this batch's 'lock spec-<slug>' clause becomes satisfiable once that lands.

## Requeue 2026-07-09

Re-scoped (agent Option A): the 'do spec:' verb-dispatch clause belongs in batch 4 (owns do.ts/advance.ts), not here. Narrowing this task to frontmatter reads + work/spec-<slug> branch + spec-<slug> lock emit + fm.spec migration; verb-dispatch moves to batch 4.
