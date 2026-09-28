---
title: 'Remove the dead item-lock helpers amendHeldEntry and requeueItemLock, and fix phase.ts's stale test pointer'
slug: remove-dead-lock-helpers-and-a-stale-test-pointer
blockedBy: []
---

## What to build

Two small cleanups found during the CI-split drive:

- `amendHeldEntry` in `item-lock.ts` has no caller since the `stuck` lock state was retired, and `requeueItemLock` has no production caller (only its own tests) (observation `item-lock-amend-held-entry-is-dead-code`). Both still carry write sites: `amendHeldEntry` goes through `refWrite.amendLockRef`, and `requeueItemLock` is listed as a WRITE-SEAM EXEMPT site in `test/write-sites-through-seams.test.ts`. Delete them (and `refWrite.amendLockRef` if nothing else uses it), with their tests and the guard's allow-list entry, after confirming again that nothing calls them.
- `phase.ts`'s doc comment on `AGENT_SPAWNING_VERBS` says `phase-verbs.test.ts` enforces the verb classification; the test is `phase-cli.test.ts`.

## Acceptance criteria

- [ ] `amendHeldEntry` and `requeueItemLock` (and any seam method left unused) are gone, together with their tests, and the write-site guard's `ALLOWED` list has no stale entry (its own stale-entry test stays green).
- [ ] `phase.ts` names the right test file.
- [ ] No behaviour changes.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: delete dead lock helpers and fix a stale pointer. Grep (bounded) for `amendHeldEntry`, `requeueItemLock` and `amendLockRef` across `packages/dorfl/src` and `packages/dorfl/test` first; if anything real still calls one, keep it and record why.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
