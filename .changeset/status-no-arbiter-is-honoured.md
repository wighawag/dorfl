---
'dorfl': minor
---

`dorfl status --no-arbiter` now actually skips the current repo's arbiter section. Before, commander read `--no-arbiter` as the negation of `--arbiter <remote>`, so the section was always shown and `false` was passed on as the lock arbiter's remote name. `--arbiter <remote>` and the default are unchanged.

`dorfl scan --reconcile-locks` is now arbiter-scoped by default, like `status --reconcile-locks` and `gc`: it releases stale per-item locks only on the arbiter resolved from the current directory (its `--arbiter` remote, default the configured `defaultArbiter`). Pass the new `--all-arbiters` flag to release across every registered arbiter. Without a resolvable cwd arbiter and without `--all-arbiters`, `scan --reconcile-locks` now refuses instead of writing to every registered arbiter. `scan --here --reconcile-locks` is unaffected (it only ever reaches the current repo's arbiter).
