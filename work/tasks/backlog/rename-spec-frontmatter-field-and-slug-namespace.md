---
title: prd→spec batch 2 — frontmatter prd:/taskedAfter + slug-namespace token + CLI verb/flags
slug: rename-spec-frontmatter-field-and-slug-namespace
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-work-layout-and-folders]
covers: [1]
---

## What to build

Rename the IDENTITY layer of the artifact: the frontmatter field, the CLI namespace token, and the user-facing verb/flags — together, because they are one coherent identity and their tests are coupled.

- `frontmatter.ts`: the parsed `prd:` field → `spec:` (and any `prdAfter`/`taskedAfter` prose the parser reads); update `frontmatter.test.ts` including the HARD-CUTOVER assertion so the now-dead `prd:` key is rejected and `spec:` is the live key.
- `slug-namespace.ts`: `SlugNamespace` `'prd' → 'spec'`, `PRD_PREFIX` → the `spec:` prefix, `workBranchRef`/parse for `work/prd-<slug> → work/spec-<slug>`; the lock-ref entry token `prd- → spec-`.
- `cli.ts`: the verb `do prd:<slug> → do spec:<slug>` and flags `--prds-land-in → --specs-land-in`; the task-only-command rejection message ("operates on tasks, not PRDs" → "…not specs") + its tests (`human-face-verbs.test.ts`).

The `prd:` frontmatter field on this repo's own LIVE tasks is NOT flipped here (that data conversion is the migration command's job, run later on dorfl). This batch changes the CODE that reads/writes the field, not the on-disk task data. Verify the build stays green with the code expecting `spec:` while live tasks still say `prd:` — if the test suite reads real `work/` fixtures, point them at `spec:` fixtures in this task; do NOT convert the live ledger by hand.

## Acceptance criteria

- [ ] `frontmatter.ts` reads/writes `spec:` (+ `taskedAfter`); the hard-cutover test rejects `prd:` and accepts `spec:`.
- [ ] `slug-namespace.ts` token/prefix/branch-ref/lock-entry all say `spec`; parse round-trips `work/spec-<slug>`.
- [ ] `cli.ts` verb + flags + rejection message renamed; `human-face-verbs.test.ts` updated in this task.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] This repo's live `work/tasks/*` `prd:` frontmatter is NOT hand-converted (migration command's job); only code + test fixtures change.

## Blocked by

- rename-spec-work-layout-and-folders (branch-ref/lock-entry spellings and any folder-key references resolve against the renamed layout).

## Prompt

> Goal: rename the artifact IDENTITY — the frontmatter field `prd: → spec:`, the CLI namespace token/prefix in `slug-namespace.ts` (`SlugNamespace`, `PRD_PREFIX`, `workBranchRef`, lock-entry `prd- → spec-`), and the user-facing verb/flags in `cli.ts` (`do prd: → do spec:`, `--prds-land-in → --specs-land-in`, the "not PRDs" rejection message) — with their coupled tests (`frontmatter.test.ts` hard-cutover, `human-face-verbs.test.ts`) updated in the SAME task. Migrate-batch 2 of the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command` (read it + `TASKING-PROTOCOL.md` §3a).
>
> Domain vocabulary: a task's `prd:` frontmatter points at its parent spec; `slug-namespace.ts` is the ONE construction of the `<type>-<slug>` lock-entry / work-branch identity (`work/prd-<slug>`), and `do prd:<slug>` is the tasking verb. The hard-cutover tests assert the OLD token is rejected (clean break, no alias).
>
> Where to look: `frontmatter.ts` + `frontmatter.test.ts`; `slug-namespace.ts`; `cli.ts` + `human-face-verbs.test.ts`. Do NOT convert this repo's live `work/tasks/*` `prd:` data by hand — that is the migration command's job; only change code and, if needed, test fixtures.
>
> Done means: code reads/writes `spec`, old `prd:` token rejected, full gate green, live ledger untouched.
>
> FIRST check drift: confirm `rename-spec-work-layout-and-folders` landed and the namespace/frontmatter still use the `prd` spelling this task renames.

## Requeue 2026-07-09

Re-scoped per review: batch 2 hard-swap could not land green in isolation. Adopting expand-first (§3a): a new expand task adds spec beside prd; this task becomes additive-migrate; hard-cutover rejection moves to the contract task.
