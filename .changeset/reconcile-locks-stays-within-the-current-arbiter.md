---
'dorfl': minor
---

`dorfl status --reconcile-locks` is now arbiter-scoped by default, like `gc`: it releases stale per-item locks only on the arbiter resolved from the current directory (its `--arbiter` remote, default the configured `defaultArbiter`), so a drain run in one repository no longer releases locks on another repository's arbiter. Other repositories' stale locks are still reported. Pass the new `--all-arbiters` flag to release across every registered arbiter (announced with a loud banner). Without a resolvable cwd arbiter and without `--all-arbiters`, `status --reconcile-locks` now refuses instead of widening the write.
