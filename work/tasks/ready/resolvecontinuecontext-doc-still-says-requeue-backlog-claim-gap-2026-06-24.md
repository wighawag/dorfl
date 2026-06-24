---
title: resolvecontinuecontext-doc-still-says-requeue-backlog-claim-gap-2026-06-24
slug: resolvecontinuecontext-doc-still-says-requeue-backlog-claim-gap-2026-06-24
needsAnswers: false
blockedBy: []
---

## What to build

# `resolveContinueContext` doc still says "requeue → backlog → claim gap" (backlog=pool)

2026-06-24. While fixing the `resolveTask`/`do.ts` stale "backlog"-means-pool
comments (task `resolvetask-stale-backlog-vocab-doc-fix`), I noticed
`packages/dorfl/src/prompt.ts:~335` (in `resolveContinueContext`, a different
function) still reads "they survive the requeue → backlog → claim gap". Here
"backlog" means the POOL (`tasks-ready`) — a requeued body now rests in the pool
(`tasks/ready/`), not staging (WORK-CONTRACT.md L111; `item-lock.ts:~821` and
`needs-attention.ts:~657` say "body still in pool"). It is the same
two-meanings-one-word hazard, but outside this task's named scope
(`resolveTask` + `do.ts`), so left untouched. A one-line reword (`backlog` →
`tasks-ready`/`the pool`) would de-stale it.
