---
entry: slice-continue-rebase-auto-resolves-protocol-bookkeeping-conflicts
by: agent-runner[bot]
---

Advancing lock held for `slice-continue-rebase-auto-resolves-protocol-bookkeeping-conflicts`. This is a TRANSIENT borrow — the
advance surface/apply/triage rung holds it and releases it; if it is here
after a run, a tick died mid-borrow and it can be removed.
