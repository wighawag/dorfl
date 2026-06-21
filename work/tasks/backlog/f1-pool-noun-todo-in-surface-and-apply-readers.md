---
title: F1 — Rename `backlog`-means-pool to `todo` in the surface/apply readers (scoped STEP-B slice)
slug: f1-pool-noun-todo-in-surface-and-apply-readers
brief: staging-surface-and-apply-promote-safety
blockedBy: []
covers: [1]
---

## What to build

A scoped prefactor that finishes the half-completed `folder-taxonomy-reorg-and-rename` STEP-B for **only the readers that F2/F3 touch**, so one word (`backlog`) stops meaning two things in the touched paths.

In the new layout, `tasks/backlog` = STAGING (untrusted, awaiting promotion) and `tasks/todo` = the agent POOL. The folder layout already says so (`work-layout.ts`), but the **readers** in this brief's surface area still use `backlog` to mean THE POOL: `ledger-read.ts` ("Read `work/backlog/*.md`"), `lifecycle-gather.ts` (treats `state.backlog` as the surface/eligible set), `config.ts` doc-comments, and the `slicesLandIn` / `prdsLandIn` enum value space where `'backlog'` still names the POOL.

Bring those readers onto the new nouns end-to-end:

- ledger-read / lifecycle-gather / scan output (the surface and build/claim pool plumbing): the POOL is `todo`; staging is `backlog`. Field names, pool-keys exposed in `scan --json`, and internal `state.*` shapes follow.
- `config.ts` doc-comments stop saying `backlog` for "pool".
- `slicesLandIn` / `prdsLandIn` value space: if either still accepts `'backlog'` meaning "the eligible pool", rename the value to `'todo'` (with whatever migration shim the codebase's existing config-rename pattern uses) and update the env-schema enums. **Briefs symmetrically**: `prdsLandIn` is in scope alongside `slicesLandIn`.
- Mirror the same vocabulary fix into `work/protocol/` if any contract doc carries the old `backlog`-means-pool noun.
- Update `work/briefs/tasked/folder-taxonomy-reorg-and-rename.md` to record that this slice consumed the surface-pool-reader portion of its STEP-B, so the remainder is not orphaned and the two cannot silently overlap.

Do NOT pull in the rest of the mechanical STEP-B rename across the tree — this slice is the scoped piece F2/F3 actually need. Leave no `backlog`-means-pool reader behind in the paths this slice touches.

## Acceptance criteria

- [ ] In `ledger-read.ts`, `lifecycle-gather.ts`, `scan` output, and `config.ts` doc-comments, no symbol/field/doc-comment names the POOL as `backlog`; the pool is `todo` and staging is `backlog`.
- [ ] `slicesLandIn` / `prdsLandIn` value space and env-schema reflect the rename (`'todo'` for "the eligible pool"); any existing config-rename shim pattern is followed.
- [ ] `work/protocol/` contract docs touched by this rename match the source-of-truth at `skills/setup/protocol/` (per AGENTS.md: edit `skills/setup/protocol/` and mirror into `work/protocol/`).
- [ ] `work/briefs/tasked/folder-taxonomy-reorg-and-rename.md` records what was consumed here.
- [ ] A test asserts no touched reader treats `backlog` as the pool: the scan/lifecycle pools read `tasks/todo` for the pool and `tasks/backlog` for staging.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green; existing claim-cas / slicing-lock / advance-apply tests do not regress.

## Blocked by

- None — can start immediately.

## Prompt

> You are finishing the scoped, surface-area portion of the deferred STEP-B vocabulary rename from `folder-taxonomy-reorg-and-rename`. The new folder layout (`work-layout.ts`) already says `tasks/backlog` = staging and `tasks/todo` = the agent pool, but several readers still use `backlog` to mean "the pool". Find them in the surface area F2/F3 will touch — `packages/agent-runner/src/ledger-read.ts`, `lifecycle-gather.ts`, the `scan` output shape, `config.ts` doc-comments, and the `slicesLandIn` / `prdsLandIn` enum value space in `env-config.ts` — and rename the POOL noun to `todo` consistently. Keep `tasks/backlog` meaning STAGING.
>
> Briefs are symmetric: `prdsLandIn` is in scope alongside `slicesLandIn`.
>
> Mirror any protocol-doc rename into both `skills/setup/protocol/` (source of truth) and `work/protocol/` (propagated copy) — per `AGENTS.md`, edit the source and mirror the copy so `diff -r` stays clean.
>
> Update `work/briefs/tasked/folder-taxonomy-reorg-and-rename.md` with a short note saying this slice consumed its surface-pool-reader portion so the remainder is not orphaned.
>
> Do NOT pull in the rest of the mechanical tree-wide rename — this is the scoped slice F2/F3 need. Leave no `backlog`-means-pool reader behind in the touched paths.
>
> Tests: add or extend a focused test asserting the readers map `tasks/todo` to the pool and `tasks/backlog` to staging. Do not regress existing claim-cas / slicing-lock / advance-apply tests. Verify with `pnpm format && pnpm -r build && pnpm -r test && pnpm format:check`.
>
> RECORD non-obvious in-scope decisions (e.g. how an existing config-rename shim was reused, whether a `'backlog'` enum value was kept as a deprecated alias) per the task template's RECORD rule.
