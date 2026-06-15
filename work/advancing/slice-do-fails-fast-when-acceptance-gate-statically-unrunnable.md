---
entry: slice-do-fails-fast-when-acceptance-gate-statically-unrunnable
by: agent-runner[bot]
---

Advancing lock held for `slice-do-fails-fast-when-acceptance-gate-statically-unrunnable`. This is a TRANSIENT borrow — the
advance surface/apply/triage rung holds it and releases it; if it is here
after a run, a tick died mid-borrow and it can be removed.
