---
'dorfl': patch
---

Hold the spec lock across the propose PR so CI stops re-tasking a spec (and force-pushing its open PR) on every tick.

In propose mode `performTask` released the `spec:<slug>` per-item lock as soon as the tasking PR opened, but the durable `specs/ready → specs/tasked` move lives only on the pushed PR branch — `main` still holds the spec in `ready/`. So the next in-place scan saw the spec eligible again (ready + not-tasked + lock free) and re-tasked it, force-recreating the `work/spec-<slug>` branch (`git switch -C`) and force-pushing the SAME PR, which regenerated its review every scheduled tick until a human merged or closed it.

The tasking path now mirrors the already-correct build path (`propose-keep-lock-until-pr-merge`): the `spec:<slug>` lock is released only when the work is durably on `main` (merge mode); on propose it stays HELD across the open PR — the held lock is the in-flight-tasking marker. `scoreSpecs`/`scanRepoPaths` and the local autopick driver now subtract held-spec slugs from the taskable pool (a new `heldSpecSlugs`/`heldSpecSlugsStrict`, the spec analogue of the existing held-task-slug subtraction), so an in-flight spec never leaks back into the propose matrix. The lock is reaped when the PR merges (or via `release-lock` if a human closes it unmerged).
