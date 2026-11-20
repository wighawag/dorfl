---
'dorfl': patch
---

Recovery messages for a surfaced item name the recovery that works. A red gate, a blocking review or a continue failure used to say "marked stuck on its per-item lock (`requeue` once resolved)" and, on `--isolated`, suggest `complete --isolated`; but the surface had released the lock (plain `requeue` is a no-op) and `complete --isolated` re-runs the integrate the gate refused. They now say the item is surfaced, where its question is, and to run `dorfl requeue <slug> -m "<instruction>"` then `dorfl do task:<slug>`. A conflict dorfl cannot resolve says to rebase the kept branch first. `complete --isolated` is only suggested for an item that was not surfaced.
