---
title: "`advance` task FOLDERS_FOR_TYPE omits `tasks-backlog`, so staged `needsAnswers` tasks (surfaceStaging pool) mis-route to the build rung and fail claim"
type: observation
date: 2026-06-24
status: spotted
needsAnswers: true
---

# `advance` mis-routes a staged `needsAnswers` task to the build rung

Verified by reading the code while investigating CI `advance-lifecycle`
propose-matrix failures (not yet a fix; this is the durable home for triage).

## What was seen

Three CI propose legs failed identically:

- `task:apply-rung-merge-disposition`
- `task:cross-job-ref-based-land-lock`
- `task:merge-questions-gate-axis`

each with:

```
'work/tasks/todo/<slug>.md' not found on origin/main (already done/removed, or wrong slug).
Error: Process completed with exit code 2.
```

The message is misleading: all three are alive in **`work/tasks/backlog/`**
(staging), have never been promoted to `work/tasks/todo/`, and carry
`needsAnswers: true` with **no sidecar yet** — i.e. they are legitimate
**surface** candidates, not build candidates. (They were born in `backlog/` via
`slicing`, commit `0f40355`; confirmed `git ls-tree origin/main` shows them only
under `tasks/backlog/`.)

## Root cause (the inconsistency)

The CI `enumerate` job's `jq` emits lifecycle surface/apply items as explicit
`task:<slug>` (`.namespace + ":" + .slug`). Staged backlog tasks reach that pool
because **`surfaceStaging` defaults to `true`**: `gatherLifecycleInPlace` /
`gatherLifecycleMirror` (`packages/dorfl/src/lifecycle-gather.ts`) widen
the surface candidate set to `tasks/backlog/` + `prds/proposed/` when the gate is
on (prd `staging-surface-and-apply-promote-safety` F2).

But the advance classifier's folder set does NOT include staging:

```
// packages/dorfl/src/advance.ts:377
const FOLDERS_FOR_TYPE: Record<SidecarType, readonly WorkFolderKey[]> = {
	task: ['tasks-todo', 'in-progress', 'done'],   // <-- no 'tasks-backlog'
	prd: ['prds-ready', 'prds-tasked'],            // <-- no 'prds-proposed'
	observation: ['observations'],
};
```

`readNeedsAnswers()` (advance.ts:383) and `findItemPath()` (advance.ts:756) both
iterate exactly this set. For a staged task the body is invisible, so
`readNeedsAnswers` returns `undefined` (NOT `true`). The classifier therefore
does not pick the `surface` rung; it falls through to **build-task**, which runs
`orchestrateDo` → `performDo` → claim. Claim requires the body in `tasks/todo/`
(`const backlog = workItemRel('tasks-todo', ...)`, `claim-cas.ts:250`) and dies
with the `claim-cas.ts:270/332` "not found on origin/main" message above.

So the surface gather and the advance classifier disagree about which folders a
`task:`/`prd:` item may rest in. The gather says "staging counts"; the classifier
says "it doesn't" — and the gap routes the item to the wrong rung.

## Why it matters

With `surfaceStaging` on by default, EVERY staged `needsAnswers` task/prd that
the CI matrix enumerates will hit this and fail its leg (exit 2) instead of
surfacing its questions. It is not a benign cross-tick race — it is a
deterministic mis-route that recurs every tick until the item is promoted or
answered out of band.

## Suggested fix direction (for triage, not yet decided)

Make the classifier's folder set consistent with the surface gather:

- `task: ['tasks-backlog', 'tasks-todo', 'in-progress', 'done']`
- `prd: ['prds-proposed', 'prds-ready', 'prds-tasked']`

`apply-persist.ts:36` (`APPLY_LIFECYCLE_FOLDERS`) ALREADY uses exactly the
staging-inclusive set — so `advance.ts` `FOLDERS_FOR_TYPE` looks like it drifted
from that sibling. Folding both onto one shared constant (or pointing
`FOLDERS_FOR_TYPE` at the same source) would prevent the two from desyncing
again. Add a regression test: seed a staged `needsAnswers` task in
`tasks/backlog/`, run the advance tick on `task:<slug>`, assert it classifies
`surface` (mints the sidecar) and does NOT attempt a claim.

Gate the fix on the build/claim eligibility staying POOL-only (staging items must
remain non-claimable — only the surface/apply polarity widens, per
`lifecycle-gather.ts` `BUILD/claim still reads POOL-only`). The change is to the
folder set the rung-CLASSIFIER reads, not to what is build-eligible.

## Refs

- `packages/dorfl/src/advance.ts:377` (`FOLDERS_FOR_TYPE`), `:383`
  (`readNeedsAnswers`), `:756` (`findItemPath`)
- `packages/dorfl/src/apply-persist.ts:36` (`APPLY_LIFECYCLE_FOLDERS`, the
  staging-inclusive sibling)
- `packages/dorfl/src/lifecycle-gather.ts:84-95` (surfaceStaging widening,
  in-place) and `:204-211` (mirror)
- `packages/dorfl/src/claim-cas.ts:250,270,332` (the failing claim + message)
- `.github/workflows/advance-lifecycle.yml` (the `enumerate` `jq` that emits
  `task:<slug>` for `lifecycle.surface[]`)
- prd `staging-surface-and-apply-promote-safety` (F2, the surfaceStaging design)
