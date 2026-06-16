---
entry: slice-autonomous-path-auto-recovers-already-committed-stranded-branch
by: agent-runner[bot]
---

Advancing lock held for `slice-autonomous-path-auto-recovers-already-committed-stranded-branch`. This is a TRANSIENT borrow — the
advance surface/apply/triage rung holds it and releases it; if it is here
after a run, a tick died mid-borrow and it can be removed.
