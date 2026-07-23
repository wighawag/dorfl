---
title: 'Fix stale "backlog"-means-pool comment in resolveContinueContext'
slug: resolvecontinuecontext-doc-still-says-requeue-backlog-claim-gap-2026-06-24
needsAnswers: false
blockedBy: []
---

## What to build

Reword the stale "backlog"-means-pool doc comment in `resolveContinueContext`
(`packages/dorfl/src/prompt.ts` ~L335), which still reads "they survive the
requeue → backlog → claim gap". Here "backlog" means the POOL (`tasks-ready`) —
a requeued body now rests in the pool (`tasks/ready/`), not staging
(WORK-CONTRACT.md L111; `item-lock.ts` ~L821 and `needs-attention.ts` ~L657 both
say "body still in pool"). This is the same two-meanings-one-word hazard the
sibling task `resolvetask-stale-backlog-vocab-doc-fix` already fixed for
`resolveTask`/`do.ts`, but in a different function that was outside that task's
named scope. A one-line reword (`backlog` → `tasks-ready` / "the pool")
de-stales it. Comments only; no behaviour change.

## Acceptance criteria

- [ ] The `resolveContinueContext` comment no longer uses "backlog" to mean the
      pool; it says `tasks-ready` / "the pool" distinctly.
- [ ] No code/behaviour change (comment only).
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: de-stale the "backlog"-means-pool comment in `resolveContinueContext`,
> mirroring the already-landed `resolvetask-stale-backlog-vocab-doc-fix`. After
> the backlog→ready rename, calling the POOL "backlog" is a two-meanings-one-word
> hazard.
>
> Where to look: `packages/dorfl/src/prompt.ts` ~L335, `resolveContinueContext`
> (NOT `resolveTask` — that one is already fixed). The phrase "requeue → backlog
> → claim gap" where "backlog" = the pool. Reword to `tasks-ready` / "the pool".
> Cross-check WORK-CONTRACT.md L111 and the "body still in pool" comments in
> `item-lock.ts`/`needs-attention.ts` for the correct vocabulary.
>
> FIRST check current reality: this comment may already have been touched — read
> what is there and only fix what is still stale. Comments only; keep the gate
> green.
