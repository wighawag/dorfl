---
title: Rename the LockAction token 'slice' to 'task' (the last live slice code identifier)
slug: rename-lock-action-token-slice-to-task
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: []
covers: []
---

> **AUTHORED 2026-06-23 (conductor + human, after the `drive-tasks` rename drive).** Closes the last live `slice` CODE identifier the original brief under-specified: the unified-lock ACTION token `'slice'`. Source signal: observation `residual-slice-code-identifiers-lock-action-and-slices-land-in-flag.md` (which also CORRECTED an earlier suspicion — the `--slices-land-in` flag is NOT a residual; the live flag was renamed in #210 and only comment references remain, owned by `rename-src-comment-prose-slicing-to-tasking`).

## What to build

Rename the `LockAction` token `'slice'` → `'task'` end-to-end, a CLEAN BREAK (no alias), per brief `code-identifier-slice-prd-to-task-brief-rename`. The tasking transition's per-item lock currently records `action: 'slice'` even though its module (`tasking-lock.ts`), its verb (`do brief:`), and the vocabulary are all `tasking`/`brief` now — the last code spot still saying `slice`.

`'task'` is the chosen token (matches the `task:`/`brief:` namespace tokens; the sibling actions are `'implement'` (the task BUILD claim) and `'advance'`). `'task'` denotes "the tasking-transition lock action" — i.e. the lock a `do brief:`/tasking run holds.

Concrete sites (verified 2026-06-23):

- `packages/dorfl/src/item-lock.ts:81` — `export type LockAction = 'implement' | 'slice' | 'advance';` → `'implement' | 'task' | 'advance'`.
- `packages/dorfl/src/tasking-lock.ts:191` — the writer `action: 'slice'` → `action: 'task'`.
- The serialisation is already generic (`item-lock.ts` `serialiseLockEntry` writes `action: ${e.action}`), so no format code changes — but the token VALUE persisted into the lock-ref body changes.
- Every test asserting `action: 'slice'` / the tasking lock action (grep the test tree: `branch-namespace-collision`, `complete-lock-crash-safe`, `gc-reap-stale-locks`, the `tasking-lock`/`intake` lock tests, etc.) — update in the SAME task.

## CLEAN-BREAK migration (mirror Decision 1's namespace-token cutover)

The action token is PERSISTED in the per-item lock-ref body (`action: slice`). Existing in-flight tasking locks on a live arbiter at cutover carry the old token; after the rename a reader expecting `'task'` will not match them. This is the SAME orphan-at-cutover situation Decision 1 handled for the namespace tokens: NO dual-read; clear any orphaned old-token tasking lock with the existing `gc --ledger` + `release-lock` reaper (which names refs by raw ref string, so it can clear an `action: slice` lock). Document the one-shot manual sweep in the done record. Do NOT add a long-lived back-compat reader.

## OUT OF SCOPE (do NOT touch)

- The **intake verdict outcome `'slice'`** (`intake.ts:822` `case 'slice':` → `dispatchSlice`) and the whole intake per-emitted-type `{slice, prd}` wire vocabulary — governed by brief Decision 2, a SEPARATE concern. This task is ONLY the `LockAction` token.
- The `--slices-land-in` comment references in `cli.ts` — owned by `rename-src-comment-prose-slicing-to-tasking`.
- Any prose in `WORK-CONTRACT.md`/`SURFACE-PROTOCOL.md` — owned by `rename-protocol-prose-workcontract-and-surface-slicing-to-tasking` (which is blockedBy THIS task, so it can write the settled `action: task` spelling).

## Acceptance criteria

- [ ] `LockAction` is `'implement' | 'task' | 'advance'`; no live code constructs or matches the lock action `'slice'` (the intake outcome `'slice'` is explicitly EXCLUDED and untouched).
- [ ] The tasking-lock writer records `action: 'task'`; acquire/release/status/scan/gc round-trip the new token.
- [ ] `gc --ledger` / `release-lock` can name and clear a lock ref written under the OLD `action: slice`; the cutover note documents the one-shot manual sweep.
- [ ] No back-compat alias / dual-read for the action token (clean break).
- [ ] Tests assert the new token (renamed in this task); `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] No shared/global write introduced; tests stay isolated to throwaway repos + local `--bare` arbiters.

## Blocked by

- None — startable immediately (the namespace-token and module/symbol renames it sits beside have all landed).

## Prompt

> Goal: rename the `LockAction` token `'slice'` → `'task'` as a CLEAN BREAK, per brief `code-identifier-slice-prd-to-task-brief-rename`. It is the LAST live `slice` code identifier; the sibling actions are `'implement'` (build) and `'advance'`.
>
> FIRST check reality (this is a launch snapshot): confirm `LockAction = 'implement' | 'slice' | 'advance'` (`item-lock.ts`) and the `tasking-lock.ts` writer still say `'slice'`. If already renamed, reconcile; if the lock model moved, route to needs-attention.
>
> Where to look: `src/item-lock.ts` (the `LockAction` type + the generic `serialiseLockEntry`), `src/tasking-lock.ts` (the writer), and the persisted lock-ref body. Search the test tree for `action: 'slice'` / `'slice'` lock assertions and rename them in this task. The `gc --ledger` / `release-lock` path already names refs by raw string — verify it can clear an old `action: slice` lock and document the one-shot sweep.
>
> EXPLICITLY OUT OF SCOPE: the intake verdict outcome `'slice'` (`intake.ts` `case 'slice'` → `dispatchSlice`) and the intake `{slice,prd}` wire vocabulary (Decision 2 owns those); the `--slices-land-in` comment refs (the prose-sweep task owns those). Do NOT touch them — distinguish the LockAction `'slice'` from the intake-outcome `'slice'` carefully.
>
> Done = build/test/format:check green, `LockAction` token is `'task'` everywhere live, the intake outcome `'slice'` untouched, the one-shot orphan-lock sweep documented.

---

### Claiming this task

```sh
dorfl claim rename-lock-action-token-slice-to-task --arbiter <remote>
git fetch <remote> && git switch -c work/rename-lock-action-token-slice-to-task <remote>/main
git mv work/tasks/todo/rename-lock-action-token-slice-to-task.md work/tasks/done/rename-lock-action-token-slice-to-task.md
```

## Requeue 2026-06-23

Gate-2 verdict JSON-parse crash (position 5879) AFTER green Gate-1 (2585 tests) and AFTER the rename was applied (verified LockAction='implement'|'task'|'advance' + action:'task' on the kept branch). Recurring infra/gate fault, not the work. Continue from the kept branch; re-run gate + Gate-2.
