---
title: Fix resolveTask stale "backlog"-means-ready doc comments
slug: resolvetask-stale-backlog-vocab-doc-fix
prd: do-allow-backlog-drive-staged-tasks-without-promotion
blockedBy: [do-allow-backlog-flag-resolver-claim-and-done-move]
covers: [7]
humanOnly: true
---

## What to build

Correct the pre-rename "backlog" prose in and around `resolveTask` so "backlog"
is not used to mean two different folders in the same function — which becomes
genuinely confusing now that the function ALSO searches the real
`tasks/backlog/` (the keystone task).

End-to-end behaviour (comments/docs only, no behaviour change):

- `resolveTask`'s doc comment says "in-progress over backlog" while the code
  searches `tasks-ready`; `do.ts:~98` says "An item that is NOT in backlog on the
  arbiter" where "backlog" means the pool. These pre-date the backlog→ready
  rename. Reword them so the pool is called the pool (`tasks-ready`) and the
  staging folder (`tasks-backlog`) is named distinctly — so a reader after the
  keystone lands does not conflate the two.
- Pure prose; the acceptance gate must stay green.

## Acceptance criteria

- [ ] No comment in/around `resolveTask` (and `do.ts`) uses "backlog" to mean the
      pool; the pool is `tasks-ready`, the staging folder is `tasks-backlog`,
      named distinctly.
- [ ] No behavioural/code change (comments + docstrings only).
- [ ] Acceptance gate green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- `do-allow-backlog-flag-resolver-claim-and-done-move` — it edits `resolveTask`
  and `do.ts` (the same lines), so serialise this prose fix AFTER it to avoid a
  merge conflict (and so the comments describe the post-keystone behaviour).

## Prompt

> Goal: de-stale the "backlog"-means-ready doc comments around `resolveTask`, per
> the PRD `do-allow-backlog-drive-staged-tasks-without-promotion` (US #7). After
> the keystone, `resolveTask` genuinely searches `tasks-backlog`, so leaving the
> old prose that calls the POOL "backlog" creates a two-meanings-one-word hazard.
>
> Where to look: `prompt.ts` `resolveTask` doc comment ("in-progress over
> backlog"); `do.ts` (~the "NOT in backlog on the arbiter" comment). Reword so
> the pool is `tasks-ready` and staging is `tasks-backlog`, distinctly. Comments
> only — no code change; keep the gate green.
>
> FIRST check against current reality: the keystone (this task's blocker) may
> have already touched these comments — read what actually landed in
> `tasks/done/` and only fix what is still stale.
