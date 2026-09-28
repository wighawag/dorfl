---
'dorfl': patch
---

`requeue --reset` and `requeue --reconcile` now work on a surfaced task whose per-item lock the surface already released. When the task's body rests in the pool on `<arbiter>/main` and its `work/task-<slug>` branch is on the arbiter, requeue takes a short per-item lock for the operation (so no claim can continue from the branch while it is deleted or rebased), runs the usual reset or reconcile, and releases the lock on every outcome; the surfaced question sidecar is left untouched. Plain `requeue` on such an item stays a no-op, now with a hint naming `--reconcile` and `--reset`. The refusal for an unknown slug is unchanged.
