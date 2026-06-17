---
entry: observation-serialise-surface-treeless-moved-false-test-under-parallel-load
by: agent-runner[bot]
---

Advancing lock held for `observation-serialise-surface-treeless-moved-false-test-under-parallel-load`. This is a TRANSIENT borrow — the
advance surface/apply/triage rung holds it and releases it; if it is here
after a run, a tick died mid-borrow and it can be removed.
