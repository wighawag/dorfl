---
title: 'F3a — Apply resolves the item''s CURRENT folder by identity at write-time (folder-agnostic, like the sidecar)'
slug: f3a-apply-resolves-item-by-identity-at-write-time
brief: staging-surface-and-apply-promote-safety
blockedBy: [f1-pool-noun-todo-in-surface-and-apply-readers]
covers: [5]
---

## What to build

Stop `apply` from trusting a captured `ItemPath`. Instead, at the moment apply commits, it resolves the item's CURRENT folder by IDENTITY against the arbiter `main`, mirroring the sidecar's already-folder-agnostic resolution (`apply-persist.ts`: "sidecar path is derived from the identity, NOT from this path").

Concretely:

- Introduce / use an identity-keyed `(umbrella, slug) -> current path` lookup that is **`git mv`-aware against `main`** at write-time (not capture-time). The umbrella is whichever identity dimension the existing sidecar resolver uses (task vs brief); reuse that resolver's shape rather than inventing a new one.
- `apply` writes the rewrite to the CURRENT path returned by the resolver, regardless of what `ItemPath` was passed in earlier in the call chain. A concurrent `promote` that has just `git mv`'d the item from `tasks/backlog/<slug>.md` to `tasks/todo/<slug>.md` MUST result in apply writing the new path — never the stale one — or, if the item has vanished (cancelled/deleted), exit clean without committing a ghost file.
- Covers **briefs symmetrically**: a brief apply (`briefs/proposed → briefs/ready` motion racing an answer-apply) gets the same identity-keyed resolution. Only carve out a genuinely task-only specific if you find one during the build — and if so, name it explicitly in the done record.

This slice does NOT change the per-item lock semantics — that is F3b's job. The two together close the hole; this one alone leaves the lost-update race for F3b.

## Acceptance criteria

- [ ] `apply` no longer commits to a captured path: the write path is computed by the identity-keyed resolver against `main` at write-time.
- [ ] Throwaway-repo test (mirroring existing claim-cas / advance-apply test patterns): with the item moved `tasks/backlog/<slug>.md → tasks/todo/<slug>.md` AFTER apply captured the old path but BEFORE it writes, apply commits the rewrite at the CURRENT (post-move) path; no ghost file remains at the stale path.
- [ ] Equivalent test for the brief path (`briefs/proposed/<slug>.md → briefs/ready/<slug>.md`) — unless a task-only carve-out was discovered and recorded.
- [ ] If the item has been removed entirely between capture and write, apply exits clean (no commit, clear exit code/message) rather than recreating it.
- [ ] Existing advance-apply, sidecar, claim-cas, and slicing-lock tests do not regress.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `f1-pool-noun-todo-in-surface-and-apply-readers` — both slices touch the same readers; serialising avoids merge conflicts (per WORK-CONTRACT file-orthogonality guidance).

## Prompt

> Make the `apply` rung folder-agnostic. Today, `apply-persist.ts` takes an `ItemPath` and "rewrites THIS file" — a concurrent `promote` can `git mv` the item out from under it, producing a stale-path write (ghost file at the old path) or a failed commit. The sidecar is already identity-keyed and folder-agnostic; the item path must be too.
>
> Reuse the existing identity-keyed sidecar resolver's SHAPE for a `(umbrella, slug) -> current path` lookup that consults the arbiter `main` at write-time (not capture-time). `apply` writes the rewrite to whatever path the resolver returns at the moment it commits, regardless of what was passed in. If the item is gone, exit clean (no ghost commit).
>
> Cover briefs too (proposed↔ready motion + apply): include the brief apply path symmetrically. Only carve out a TASK-ONLY specific if you find one during the build; if you do, name it explicitly in your done record.
>
> Tests: use throwaway git repos (existing claim-cas / slicing-lock pattern). Simulate the concurrent promote happening AFTER capture and BEFORE write, and assert apply writes the post-move path. Add the brief-symmetric test. Confirm advance-apply / sidecar / claim-cas / slicing-lock tests still pass.
>
> Out of scope HERE: changing the per-item lock semantics — that is the sibling slice `f3b-promote-takes-per-item-advancing-lock`. This slice alone kills the stale-path write; the sibling kills the lost-update race; together they close the F3 hole.
>
> Per the task template, FIRST check this slice against current reality — has the sidecar resolver or apply pipeline changed since the brief was written? If so, route to needs-attention rather than building on a stale premise. RECORD non-obvious in-scope decisions (resolver reuse vs. extension, the gone-item exit code/message, any brief carve-out).
>
> Verify with `pnpm format && pnpm -r build && pnpm -r test && pnpm format:check`.
