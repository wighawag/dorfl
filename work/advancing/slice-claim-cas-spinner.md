---
entry: slice-claim-cas-spinner
by: agent-runner[bot]
---

Advancing lock held for `slice-claim-cas-spinner`. This is a TRANSIENT borrow — the
advance surface/apply/triage rung holds it and releases it; if it is here
after a run, a tick died mid-borrow and it can be removed.
