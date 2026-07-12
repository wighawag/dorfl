---
title: The lock/sidecar identity (SidecarType, typeForNamespace, item-lock) is a SEPARATE spec-namespace surface the first expand task missed — added a second expand task
date: 2026-07-09
needsAnswers: true
---

## What happened

The `do` agent building batch 2 (`rename-spec-frontmatter-field-and-slug-namespace`, additive-migrate) STOPPED with a correct diagnosis: batch 2's "emit `spec-<slug>` lock" clause has no `spec` lock-namespace to migrate onto. `SidecarType` in `sidecar.ts` is `'spec' | 'task' | 'observation'` (no `'spec'`), and `typeForNamespace` maps a `spec:` prefix to the `task` fall-through, so `lockEntryFor('spec:foo') === 'task-foo'` — a silent collision with same-slug task-build locks, breaking the per-item lock's isolation invariant. Verified: `sidecar.ts:72` + `typeForNamespace` (no spec case) @ commit 1d0b43fc.

## Why it matters

The first expand task (`expand-spec-frontmatter-and-namespace-aliases`) enumerated FOUR identity surfaces (frontmatter key, `SlugNamespace`, config key, intake type) but MISSED a fifth: the lock/sidecar identity (`sidecar.ts` `SidecarType`/`TYPE_TO_NAMESPACE`/`typeForNamespace`, `item-lock.ts`). This is the SECOND under-scoping of the expand surface caught by a `do` agent (the first was the whole identity layer needing expand-first at all). The general lesson: for a coined-token rename, the "definitional" surfaces where the token is MINTED/MAPPED (unions, prefix maps, namespace resolvers) are easy to under-enumerate; the CONSUMERS that merely switch on the value (`namespace === 'spec'` across ~11 modules) are safe on the widened union and are migrate-batch territory, but every DEFINITIONAL site must be in an expand task or the migrate batch that flips the emit side has nothing valid to emit.

Definitional identity surfaces for the `spec` namespace token, now fully covered by the two expand tasks:
- `SlugNamespace` + `PRD_PREFIX` + `workBranchRef`/parse (`slug-namespace.ts`) — expand 1.
- `SidecarType` + `TYPE_TO_NAMESPACE` + `typeForNamespace` (`sidecar.ts`); the `spec` cases/loops in `item-lock.ts` — expand 2 (this fix).

Consumers (safe on the widened union, migrated by batches 2/4): `advance*.ts`, `cli.ts`, `do*.ts`, `scan.ts`, `tasking.ts`, `triage-persist.ts` — all `item.namespace === 'spec'` reads.

## The fix (conductor move, no human re-decision needed)

Added `expand-spec-lock-and-sidecar-namespace` (blockedBy the first expand), re-pointed batch 2's `blockedBy` at it, and extended the contract task's alias-removal list to include the lock/sidecar `'spec'` member. Chain: … → expand-frontmatter → expand-lock-sidecar → frontmatter-migrate → …

## Provenance

Agent STOP diagnosis (with file/line refs), verified against the live tree @ 1d0b43fc (`sidecar.ts` SidecarType + typeForNamespace; the ~11 consumer sites via grep of `namespace === 'spec'`).
