---
entry: observation-advancing-lock-orthogonal-not-a-move-revisit
by: agent-runner[bot]
---

Advancing lock held for `observation-advancing-lock-orthogonal-not-a-move-revisit`. This is a TRANSIENT borrow — the
advance surface/apply/triage rung holds it and releases it; if it is here
after a run, a tick died mid-borrow and it can be removed.
