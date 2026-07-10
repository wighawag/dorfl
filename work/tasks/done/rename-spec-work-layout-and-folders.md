---
title: prd→spec batch 1 — work-layout keys/values + folder git-mv + self-renaming guard
slug: rename-spec-work-layout-and-folders
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [preisolate-spec-false-positive-words]
covers: [1]
---

## What to build

The FOUNDATION migrate batch: rename the folder-name source of truth so every later batch resolves against `spec` folders. Touch `packages/dorfl/src/work-layout.ts` and the `work/specs/*` folders together, in lockstep, keeping the self-renaming-folder guard green.

- `work-layout.ts`: rename the folder KEYS and VALUES `prds-proposed/prds-ready/prds-tasked/prds-dropped → specs-proposed/…`, values `work/specs/* → work/specs/*`; rename `PRD_FOLDERS`/`PrdFolder`/any `PrdsLandIn`-adjacent symbol to the `spec` spelling.
- On-disk folders: `git mv work/specs/{proposed,ready,tasked,dropped}/ → work/specs/…` (this repo's own live data). The parent spec itself moves `work/specs/ready/prd-to-spec-*.md → work/specs/ready/` as part of this — fitting, it is one of the last artifacts named `prd`.
- Keep the self-renaming-folder guard (the test asserting the layout registry matches the on-disk folders) green in THIS task — it is the coupled test for this rename.

This batch deliberately does the folder layer only; the frontmatter `prd:` field, the namespace token, config, and the remaining modules are separate batches that block on this one where they read folder names.

## Acceptance criteria

- [ ] `work-layout.ts` keys/values + `PRD_FOLDERS`/`PrdFolder` renamed to `spec`; on-disk `work/specs/* → work/specs/*` moved via `git mv`.
- [ ] The self-renaming-folder guard test is updated in THIS task and passes.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green (later-batch modules still referencing `prd:` frontmatter keep compiling because this batch changes only folder identity, not the frontmatter field — verify no build break; if a call site breaks, it belongs to a later batch and should be `blockedBy`-serialized, not fixed here).
- [ ] No `prd:` FRONTMATTER field renamed here (that is the frontmatter batch).

## Blocked by

- preisolate-spec-false-positive-words (the field must be cleared of false-positive `spec` words first).

## Prompt

> Goal: rename the folder-name source of truth from `prd` to `spec` — `packages/dorfl/src/work-layout.ts` (keys, values, `PRD_FOLDERS`, `PrdFolder`) and the on-disk `work/specs/* → work/specs/*` folders — in lockstep, keeping the self-renaming-folder guard green. This is migrate-batch 1 of the wide refactor in the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command` (read it + `work/protocol/TASKING-PROTOCOL.md` §3a).
>
> Domain vocabulary: `work-layout.ts` is the SINGLE registry mapping symbolic folder keys (`prds-ready`, …) to on-disk paths (`work/specs/ready`, …); every call site references keys, never raw strings, so renaming a folder should not re-touch call sites. The self-renaming-folder guard is the test that asserts registry ↔ on-disk agreement.
>
> Where to look: `work-layout.ts` (the `WorkFolderKey` union, the path map, `PRD_FOLDERS`, `PrdFolder`), and the guard test. Move folders with `git mv` so history follows.
>
> Done means: registry + folders both say `spec`, the guard passes, and the full gate is green. Because this batch changes folder IDENTITY only (not the `prd:` frontmatter field, not the ref token), the rest of the code should still compile; if a site genuinely breaks, it belongs to a later batch — record it, do not absorb it here.
>
> FIRST check drift: confirm `preisolate-spec-false-positive-words` has landed (this task assumes the field is clear) and that `work-layout.ts` still has the `prds-*` keys this task renames.
