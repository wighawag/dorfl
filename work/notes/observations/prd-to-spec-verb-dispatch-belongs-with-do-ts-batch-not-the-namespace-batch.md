---
title: The `do spec:`/`advance spec:` verb-dispatch belongs in the batch that owns do.ts/advance.ts (batch 4), not the namespace-migrate batch — a task-boundary miss
date: 2026-07-09
---

## What happened

The `do` agent building `rename-spec-frontmatter-field-and-slug-namespace` (batch 2, third attempt after the two expand tasks landed) STOPPED with a correct diagnosis: batch 2's acceptance said "make `do spec:` the documented verb", but the `do`/`advance` dispatchers route on `resolved.namespace === 'prd'` inside `do.ts` (L711, L1893) + `advance.ts`/`advance-drivers.ts`/`do-autopick.ts` — and batch 2's OWN scope note forbids touching `do.ts`/`advance.ts` (they are batch 4's). So the verb clause was unsatisfiable within the task's own boundary: documenting `do spec:` without editing the dispatcher would ship a BROKEN verb (it falls through to the task-build path and misroutes). Verified: `do.ts:711`/`:1893` route only on `'prd'`, and `do.ts`/`advance.ts` are in batch 4's file list.

## Why it matters

This is the THIRD scope/boundary miss on this cutover, all caught by `do` agents:
1. the identity layer needed expand-first (not per-batch hard-swap);
2. the first expand missed the lock/sidecar namespace surface;
3. this: a user-visible VERB clause placed in the wrong batch (the namespace-migrate batch) instead of the batch that owns the dispatcher file.

General lesson for wide-refactor tasking: **a clause belongs in the batch that owns the FILE it must edit.** The `do spec:` verb is minted where the dispatcher lives (`do.ts`), so it must ride with the batch that owns `do.ts` (batch 4), even though conceptually it feels like "namespace" work. Splitting by CONCEPT (namespace vs modules) instead of by FILE OWNERSHIP produced a clause with no home. Also: the `review` skill (run on the original set) did not catch any of the three, because none is a graph/claim/coverage defect — they are "can this batch physically edit only its own files and stay green" checks. That is a distinct review lens worth adding for wide-refactor chains: FOR EACH acceptance clause, WHICH file must change, and does THIS batch own it?

## The fix (conductor move, agent Option A)

Narrowed batch 2 to what it owns (frontmatter `fm.prd`→`fm.spec` reads in its modules; the tasking work-branch + lock EMIT `work/spec-<slug>`/`spec-<slug>` in `tasking.ts`/`tasking-lock.ts`, now safe because the expand-lock-sidecar task made `spec:` produce a correct `spec-<slug>` entry; `--specs-land-in` already done). Moved the `do spec:`/`advance spec:` verb-dispatch clause into batch 4 (`rename-spec-remaining-src-modules`), which owns `do.ts`/`advance.ts` and the `{namespace:'prd'}` consumer web.

## Provenance

Agent STOP diagnosis (with `do.ts:711`/`:1893` refs), verified against the live tree @ aece2d23.
