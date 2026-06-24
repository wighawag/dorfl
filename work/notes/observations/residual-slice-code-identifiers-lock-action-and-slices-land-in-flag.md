---
title: Residual `slice` CODE identifiers the rename brief under-specified — the lock action token `'slice'` and the `--slices-land-in` CLI flag
date: 2026-06-23
status: open
triaged: keep
---

## Signal (verified, found during the drive-tasks rename drive)

The brief `code-identifier-slice-prd-to-task-brief-rename` and its emitted tasks renamed the namespace tokens (already done pre-brief in #179), config keys, CLI verb/flags, source modules/symbols, and the protocol doc filename — but TWO live `slice` CODE identifiers were NOT enumerated by any task and are still live on `main` after tasks 4-7 landed:

1. **The unified-lock ACTION token `'slice'`.** `packages/dorfl/src/item-lock.ts`: `export type LockAction = 'implement' | 'slice' | 'advance';` and `packages/dorfl/src/tasking-lock.ts` writes `action: 'slice'`. The TASKING transition's lock action is still spelled `slice` even though the module, the verb (`do brief:`), and the vocabulary are all `tasking`/`brief` now. The coherent name would be `'task'` or `'tasking'` (decide which — `'tasking'` matches the verb noun; `'task'` matches the other namespace tokens).

2. ~~The `--slices-land-in` CLI flag still exists alongside `--tasks-land-in`.~~ **CORRECTED 2026-06-23 (review pass):** the LIVE `--slices-land-in` flag WAS fully renamed to `--tasks-land-in` by task `rename-cli-verb-and-flags-do-prd-to-do-brief` (#210). The 4 remaining `--slices-land-in` occurrences in `cli.ts` are all in COMMENTS (lines 2109/2259/2549/2684), not a live flag — and those comment references are owned by the src-comment-prose sweep task (`rename-src-comment-prose-slicing-to-tasking`), NOT a code rename. So there is NO residual live flag to remove. The ONLY genuine residual `slice` CODE identifier is finding 1 (the `LockAction` token).

## Why it matters

- These are the LAST live `slice` code identifiers; leaving them is the exact coherence violation (CONTEXT.md "Coherence") the whole brief set out to close — a reader sees `task`/`brief` everywhere except the lock action and one stray flag.
- They are LOAD-BEARING for the WORK-CONTRACT.md / SURFACE-PROTOCOL.md prose sweep: that prose currently describes `action: slice` and `--slices-land-in` and so correctly MATCHES live code. The prose sweep (`rename-protocol-prose-workcontract-and-surface-slicing-to-tasking`) is therefore blocked on these code renames — rewriting the prose first would get ahead of the code and make the docs lie.

## Suggested resolution

Author a small code-rename task (clean break, no alias): rename the `LockAction` token `'slice'` → `'task'` end-to-end (the type, every writer/reader incl. `tasking-lock.ts`, lock-entry persisted strings, status/scan/gc surfaces, and asserting tests). `'task'` is chosen over `'tasking'` to match the `task:`/`brief:` namespace tokens and the build action's noun-ish sibling pattern; the verb-style siblings are `'implement'`/`'advance'`. This is a DECIDED rename, not a `needsAnswers` (the token choice is settled here). NOTE the `--slices-land-in` flag is NOT in scope (see finding 2 correction — it is comment-only, owned by the prose-sweep task).

Filed by the conductor during the rename drive; created as the task `rename-lock-action-token-slice-to-task` (backlog/), and the prose-sweep task `rename-protocol-prose-workcontract-and-surface-slicing-to-tasking` is `blockedBy` it.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `task:rename-lock-action-token-slice-to-task` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: The observation explicitly states it was filed and the task `rename-lock-action-token-slice-to-task` was created from it; that task in work/tasks/todo/ already captures the sole residual signal (the `LockAction` 'slice' token rename), and the observation itself corrects away the second finding (--slices-land-in flag) as already done. Unambiguous 1:1 mapping to that existing task.
