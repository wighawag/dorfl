---
title: 'F3b — `promote` takes the per-item `advancing` lock for its CAS window (serialises with apply)'
slug: f3b-promote-takes-per-item-advancing-lock
brief: staging-surface-and-apply-promote-safety
blockedBy: [f1-pool-noun-todo-in-surface-and-apply-readers]
covers: [6]
---

## What to build

Bring the `promote` position-CAS transition under the SAME per-item lock that `apply` runs under, so the two serialise BY CONSTRUCTION and can never interleave on a single item. The SPEC's q2 answer is decisive: the per-item two-axis lock exists precisely so that implement/slice/advance on one item are mutually exclusive — "refuse while an advance lock is held" is an advisory check-then-act and is rejected. Promote TAKES the lock.

Concretely:

- `promote` (both the task promote `tasks/backlog → tasks/todo` and the brief promote `briefs/proposed → briefs/ready` — symmetric per the SPEC q4 answer) acquires the item's per-item lock (`advancing` axis), performs its tree-less position CAS, then releases.
- **Action-value decision**: reuse the existing `advance` action value rather than introduce a distinct `'promote'` action axis, unless a concrete reason against reuse emerges during the build. If reuse turns out to be wrong (e.g. it breaks an existing invariant elsewhere), introduce `'promote'` and write an ADR for the choice.
- Loss is CLEAN: if an apply already holds the lock, promote loses cleanly (no partial state, clear exit code/message); if promote holds the lock, apply loses cleanly the same way. Mirror the existing claim-cas loss semantics.
- No change to the trust model and no change to BUILD/claim eligibility — only the lock discipline of the position transition itself changes.

This slice and `f3a-apply-resolves-item-by-identity-at-write-time` are FILE-ORTHOGONAL (apply path vs promote path) and together close the F3 hole; either alone is incomplete (folder-agnostic apply still lets two writers race on `main`; lock-only still risks a stale path if the lock is released between resolve and write).

## Acceptance criteria

- [ ] `promote` acquires the item's per-item `advancing` lock for the duration of its CAS window and releases it on success and failure (including crash-safe release, matching the existing advancing-lock-release-crash-safe behaviour).
- [ ] Throwaway-repo test: a `promote` and an `apply` on the SAME item cannot both commit — the lock serialises them; the loser exits clean with no partial state on `main` (no split-brain).
- [ ] Equivalent brief-symmetric test for the `briefs/proposed → briefs/ready` promote.
- [ ] Existing claim-cas, requeue, slicing-lock, and advancing-lock tests do not regress.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] Any decision (reuse `advance` action value vs introduce `'promote'`) is RECORDED per the task template — as an ADR if it meets the ADR gate, otherwise a `## Decisions` note in the done record.

## Blocked by

- `f1-pool-noun-todo-in-surface-and-apply-readers` — touches overlapping readers / config doc-comments; serialise to avoid merge conflicts.

## Prompt

> Bring `promote` under the per-item lock. Today `promote` is a tree-less position CAS modelled on `requeue`/`claim` that does NOT take the item's `advancing` lock; `apply` does. So they lock DIFFERENT things and can interleave on the same item (lost update / split brain). The two-axis per-item lock exists precisely to make implement/slice/advance on one item mutually exclusive BY CONSTRUCTION; "refuse while an advance lock is held" was rejected by the SPEC's q2 answer because it is an advisory check-then-act — the lock is atomic, not advisory. So `promote` TAKES the lock for its CAS window.
>
> Apply this to BOTH the task promote (`tasks/backlog → tasks/todo`) and the brief promote (`briefs/proposed → briefs/ready`) — they are symmetric per the SPEC q4 answer.
>
> Action-value choice: prefer reusing the existing `advance` action value rather than introducing `'promote'` (the SPEC answer flagged distinct action values as potential over-engineering). If you discover a concrete reason reuse is wrong, introduce `'promote'` and write an ADR. Either way, RECORD the decision.
>
> Loss semantics: mirror existing claim-cas — the loser exits clean with a clear exit code/message; no partial state on `main`. Crash-safe release must match the existing advancing-lock-release-crash-safe behaviour.
>
> Tests: throwaway git repos. Race a `promote` against an `apply` on the same item; assert exactly one commits, the other exits clean. Add the brief-symmetric test. Confirm existing claim-cas / requeue / slicing-lock / advancing-lock tests still pass.
>
> Out of scope HERE: the folder-agnostic apply resolution — that is the sibling slice `f3a-apply-resolves-item-by-identity-at-write-time`. This slice alone kills the lost-update race; the sibling kills the stale-path write; together they close the F3 hole.
>
> Per the task template, FIRST check this slice against current reality (has the per-item lock or promote path changed?). RECORD non-obvious in-scope decisions. Verify with `pnpm format && pnpm -r build && pnpm -r test && pnpm format:check`.
