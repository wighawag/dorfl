---
title: Residual `slice` CODE identifiers the rename brief under-specified — the lock action token `'slice'` and the `--slices-land-in` CLI flag
date: 2026-06-23
status: open
---

## Signal (verified, found during the drive-tasks rename drive)

The brief `code-identifier-slice-prd-to-task-brief-rename` and its emitted tasks renamed the namespace tokens (already done pre-brief in #179), config keys, CLI verb/flags, source modules/symbols, and the protocol doc filename — but TWO live `slice` CODE identifiers were NOT enumerated by any task and are still live on `main` after tasks 4-7 landed:

1. **The unified-lock ACTION token `'slice'`.** `packages/agent-runner/src/item-lock.ts`: `export type LockAction = 'implement' | 'slice' | 'advance';` and `packages/agent-runner/src/tasking-lock.ts` writes `action: 'slice'`. The TASKING transition's lock action is still spelled `slice` even though the module, the verb (`do brief:`), and the vocabulary are all `tasking`/`brief` now. The coherent name would be `'task'` or `'tasking'` (decide which — `'tasking'` matches the verb noun; `'task'` matches the other namespace tokens).

2. **The `--slices-land-in` CLI flag still exists alongside `--tasks-land-in`.** `grep -c 'slices-land-in\|tasks-land-in' cli.ts` returns 9. Task `rename-cli-verb-and-flags-do-prd-to-do-brief` (#210) was scoped to rename the flag NAMES (`--slices-land-in` → `--tasks-land-in`), and `--tasks-land-in` IS present — but `--slices-land-in` was apparently left in too (verify whether as a live duplicate, a deprecated alias, or only in comments). If it is a live second flag, that is a clean-break violation (Decision 2/3 = no alias) and a leftover to remove.

## Why it matters

- These are the LAST live `slice` code identifiers; leaving them is the exact coherence violation (CONTEXT.md "Coherence") the whole brief set out to close — a reader sees `task`/`brief` everywhere except the lock action and one stray flag.
- They are LOAD-BEARING for the WORK-CONTRACT.md / SURFACE-PROTOCOL.md prose sweep: that prose currently describes `action: slice` and `--slices-land-in` and so correctly MATCHES live code. The prose sweep (`rename-protocol-prose-workcontract-and-surface-slicing-to-tasking`) is therefore blocked on these code renames — rewriting the prose first would get ahead of the code and make the docs lie.

## Suggested resolution

Author a small code-rename task (clean break, no alias): rename the `LockAction` token `'slice'` → `'tasking'` (or `'task'`) end-to-end (the type, every writer/reader, lock-entry strings, status/scan/gc surfaces, and asserting tests), and remove the residual `--slices-land-in` flag if it is a live duplicate. Sequence the WORK-CONTRACT/SURFACE prose sweep AFTER it. (A `needsAnswers` may be warranted only for the `'task'` vs `'tasking'` token choice; everything else is mechanical.)

Filed by the conductor during the rename drive; the two prose files were carved into `rename-protocol-prose-workcontract-and-surface-slicing-to-tasking` (in backlog/) which depends on this code rename.
