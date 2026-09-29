---
'dorfl': patch
---

A CI phase run (`advance <item> --phase` for the build, tasking and tree-less paths, and `intake <N> --phase`) now exits 0 for an outcome it handled, so the run is green: a rejected handoff (for example a protected path) whose item was surfaced to needs-attention, a lock phase that backs off because another run holds the item's lock, and an agent or apply phase whose lock is no longer this run's (such as a "Re-run failed jobs" of a finished run), which writes nothing. The result is printed as a `>> ` line. A surface that could not be written, a refused or failed publish or release, and any unexpected error still exit non-zero.
