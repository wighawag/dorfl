---
entry: observation-pi-yields-turn-early-with-work-pending
by: agent-runner[bot]
---

Advancing lock held for `observation-pi-yields-turn-early-with-work-pending`. This is a TRANSIENT borrow — the
advance surface/apply/triage rung holds it and releases it; if it is here
after a run, a tick died mid-borrow and it can be removed.
